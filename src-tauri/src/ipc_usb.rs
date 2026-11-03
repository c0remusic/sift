//! IPC surface for the M7 "Formater une clé USB" utility. Selects the platform backend via
//! `#[cfg(target_os = ...)]` at this single call site — the two backends themselves never
//! branch on OS internally (see `usb_format::windows`/`usb_format::macos`).

use crate::usb_format::{self, RemovableDrive, RemovableDriveBackend, TargetFs};

use usb_format::backend_for_this_os as backend;

/// List drives Sift is confident are removable (conservative filter — see backend docs).
#[tauri::command]
pub fn list_removable_drives() -> Result<Vec<RemovableDrive>, String> {
    backend().list().map_err(|e| e.to_string())
}

/// Étape courante du formatage privilégié, pour que l'écran montre ce qui se passe.
///
/// Lu depuis un fichier parce que le travail se fait dans un AUTRE processus, élevé, dont la
/// sortie ne peut pas être redirigée. Une chaîne vide veut dire « rien en cours ».
#[tauri::command]
pub fn format_step() -> String {
    #[cfg(target_os = "windows")]
    {
        std::fs::read_to_string(usb_format::privileged::step_file()).unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::new()
    }
}

/// Démonte `drive_id` pour qu'il puisse être débranché sans risque.
///
/// Pas de garde anti-course ici, contrairement au formatage : éjecter le mauvais disque est
/// contrariant, pas destructeur, et exiger une identité rendrait l'action impossible juste après
/// un formatage — qui change précisément cette identité.
///
/// `"EJECT_BUSY"` quand le système refuse : rien n'a été démonté, donc débrancher reste risqué.
#[tauri::command]
pub fn eject_drive(drive_id: String) -> Result<(), String> {
    let b = backend();
    let fresh = b.list().map_err(|e| e.to_string())?;
    let drive = fresh
        .into_iter()
        .find(|d| d.id == drive_id)
        // Déjà absent : c'est le résultat voulu, pas une erreur à afficher.
        .ok_or_else(|| usb_format::DRIVE_VANISHED.to_string())?;
    b.eject(&drive).map_err(|e| e.to_string())
}

/// Ouvre la racine du volume de `drive_id` dans l'explorateur (le Finder sur macOS) — le « Ouvrir
/// dans l'explorateur » du clic droit de Clé USB (spec `cle-usb.md` § Interactions).
///
/// Prend un identifiant de disque, jamais un chemin, pour la même raison que `reveal_track` : le
/// chemin vient d'une énumération fraîche du backend, et le frontend ne peut pas pointer
/// l'explorateur ailleurs. Un disque débranché entre-temps rend `DRIVE_VANISHED` ; un disque sans
/// volume monté, une erreur qui le dit.
///
/// ⚠️ `explorer.exe` sort en code NON nul même quand il réussit (même piège que `reveal_track`) :
/// seul l'échec du lancement est remonté.
#[tauri::command]
pub fn open_drive(drive_id: String) -> Result<(), String> {
    let drive = backend()
        .list()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|d| d.id == drive_id)
        .ok_or_else(|| usb_format::DRIVE_VANISHED.to_string())?;
    let target = volume_root(&drive.mount).ok_or_else(|| {
        crate::tr!(
            "Aucun volume monté sur ce disque — rien à ouvrir.",
            "No volume is mounted on this drive — nothing to open."
        )
    })?;
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(target_os = "windows"))]
    let program = "open";
    std::process::Command::new(program)
        .arg(&target)
        .spawn()
        .map_err(|e| {
            crate::tr!(
                "ouverture de l'explorateur impossible : {e}",
                "couldn't open the file manager: {e}"
            )
        })?;
    Ok(())
}

/// Racine à ouvrir pour `mount` (`RemovableDrive::mount`) : la PREMIÈRE lettre d'une liste
/// « E:, F: », suffixée de `\` (`explorer E:` sans barre ouvre le dossier courant de ce lecteur,
/// pas sa racine), ou un point de montage macOS absolu. Tout le reste est refusé plutôt que passé
/// à un processus : `mount` vient de notre énumération, une forme inattendue signale un problème
/// en amont.
fn volume_root(mount: &str) -> Option<String> {
    let first = mount.split(',').next()?.trim();
    let b = first.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return Some(format!("{first}\\"));
    }
    if first.starts_with("/Volumes/") && !first.contains("..") {
        return Some(first.to_string());
    }
    None
}

/// Format `drive_id` to `fs`. `identity` must match what the frontend last saw for this drive —
/// re-checked against a fresh listing immediately before formatting (anti-race guard); fails with
/// `"IDENTITY_MISMATCH"` or `"DRIVE_VANISHED"` if a different drive now answers to the same id
/// (e.g. a USB stick was swapped between listing and confirmation).
///
/// The disk actually formatted is `confirmed` — the entry from the **fresh** listing, never the
/// caller's. `drive_id` only selects; every field `format` acts on is backend-produced.
#[tauri::command]
pub fn format_drive(
    drive_id: String,
    identity: String,
    fs: TargetFs,
    label: String,
) -> Result<(), String> {
    // Le fichier d'étape se réinitialise AVANT l'énumération, pas après. Il garde l'état terminal
    // du formatage précédent (`STEP_DONE`), et le frontend commence à le sonder 400 ms après le
    // clic, pendant que l'énumération WMI prend plusieurs secondes : un ancien `DONE` lu là
    // annonçait comme réussi un formatage qui n'avait pas commencé (trouvé le 2026-11-03, en
    // posant le rapport de fin). Tenu par `l_etape_est_reinitialisee_avant_l_enumeration`.
    #[cfg(target_os = "windows")]
    usb_format::privileged::write_step(&crate::tr!(
        "Autorisation Windows demandée…",
        "Asking Windows for permission…"
    ));
    let b = backend();
    // Durée de l'énumération : elle se fait ICI, sur le fil de la commande, avant tout formatage —
    // une énumération WMI lente se lirait comme un formatage lent (chronométrage du 2026-10-07).
    let debut = std::time::Instant::now();
    let fresh = b.list().map_err(|e| e.to_string())?;
    log::info!(
        "format {drive_id}: énumération des disques {} ms",
        debut.elapsed().as_millis()
    );
    usb_format::verify_identity_unchanged(&drive_id, &identity, &fresh)
        .map_err(|e| e.to_string())?;
    let confirmed = fresh
        .into_iter()
        .find(|d| d.id == drive_id)
        .ok_or_else(|| usb_format::UsbFormatError::DriveVanished.to_string())?;
    // An enumerated-but-empty card reader is listable (so the UI can say why it is useless) but
    // never formattable — `diskpart` would fail on it anyway, and failing here says why.
    if !confirmed.has_media {
        return Err(crate::tr!(
            "Aucun média dans ce lecteur — rien à formater.",
            "No media in this drive — nothing to format."
        ));
    }

    // Tout ce qui précède est instantané et doit échouer AVANT qu'on parte : garde anti-course,
    // disque introuvable, lecteur vide. Ce qui suit dure — attente de l'invite UAC, partitionnement,
    // écriture — et part donc sur son propre fil.
    //
    // Une commande Tauri synchrone qui attend bloque le service des AUTRES commandes : tant que
    // `format_drive` attendait la fin du processus élevé, `format_step` ne pouvait pas être servie
    // et l'interface entière était figée. L'affichage des étapes ne pouvait pas fonctionner par
    // construction — c'est le gel constaté au premier formatage réel, pas une lenteur.
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            let debut = std::time::Instant::now();
            let outcome = backend().format(&confirmed, fs, &label);
            log::info!(
                "format {}: formatage terminé en {} ms ({})",
                confirmed.id,
                debut.elapsed().as_millis(),
                if outcome.is_ok() { "succès" } else { "échec" }
            );
            // L'état terminal passe par le fichier d'étape, seul canal que le frontend interroge :
            // ce fil n'a personne à qui répondre, la commande a déjà rendu la main.
            match outcome {
                Ok(()) => usb_format::privileged::write_step(usb_format::privileged::STEP_DONE),
                Err(e) => usb_format::privileged::write_failed(&e.to_string()),
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        b.format(&confirmed, fs, &label).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::volume_root;

    #[test]
    fn la_racine_ouverte_est_celle_de_la_premiere_lettre() {
        assert_eq!(volume_root("E:").as_deref(), Some("E:\\"));
        assert_eq!(volume_root("E:, F:").as_deref(), Some("E:\\"));
        assert_eq!(volume_root("/Volumes/DJ").as_deref(), Some("/Volumes/DJ"));
    }

    /// Test de source, même forme que les `…_reste_hors_du_fil_de_la_fenetre` : l'ordre se lit
    /// dans le corps de `format_drive`, qu'aucun test ne peut exécuter sans WMI. Remonter
    /// l'écriture d'étape APRÈS `.list()` rouvre la course décrite dans la commande.
    #[test]
    fn l_etape_est_reinitialisee_avant_l_enumeration() {
        let src = include_str!("ipc_usb.rs");
        let start = src.find("pub fn format_drive(").expect("format_drive");
        let body = &src[start..];
        let step = body
            .find("write_step(")
            .expect("write_step dans format_drive");
        let list = body.find(".list()").expect(".list() dans format_drive");
        assert!(
            step < list,
            "le fichier d'étape doit être réinitialisé avant l'énumération"
        );
    }

    #[test]
    fn une_forme_inattendue_n_atteint_jamais_un_processus() {
        for bad in [
            "",
            "E",
            "EE:",
            "E:\\..",
            "C:\\Windows",
            "/Volumes/../etc",
            "/etc",
            "\"E:\"",
        ] {
            assert_eq!(volume_root(bad), None, "{bad:?}");
        }
    }
}
