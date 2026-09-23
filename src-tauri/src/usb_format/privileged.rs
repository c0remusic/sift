//! Mode privilégié : Sift relancé en administrateur pour faire **une seule chose**, puis rendre
//! la main.
//!
//! Écrire un FAT32 au-delà de 32 Go demande d'ouvrir un volume brut en écriture, réservé à
//! l'administrateur. Trois façons de s'y prendre, et une seule tient :
//!
//! - faire tourner Sift entier en élevé : une app de préparation musicale qui réclame
//!   l'administrateur à chaque lancement est hostile, et élève tout le reste du code avec elle ;
//! - embarquer un binaire tiers élevé : c'est la route GPL qu'on a écartée ;
//! - se relancer soi-même, élevé, sur un drapeau dédié, pour cette opération et rien d'autre.
//!
//! C'est la troisième. Le processus élevé ne démarre aucune interface, ne touche pas la base, ne
//! lit aucun réglage : il partitionne, écrit le système de fichiers, et sort avec un code.
//!
//! **Une seule invite UAC.** `diskpart` et l'écriture brute ont tous deux besoin de l'élévation ;
//! les faire depuis le même processus élevé évite d'en demander deux fois.

use super::{fat32, raw_volume::RawVolume, sector_io::SectorIo, TargetFs};
use std::io::Write;

/// Fichier où le processus élevé dépose son étape courante, et que le parent relit.
///
/// Un fichier plutôt qu'un canal : le processus élevé est un AUTRE processus, lancé par
/// `Start-Process -Verb RunAs`, dont la sortie standard ne peut pas être redirigée. Sans ça,
/// l'interface n'a rien a montrer entre le clic et la fin — c'est le reproche exact fait a la
/// première version.
pub fn step_file() -> std::path::PathBuf {
    std::env::temp_dir().join("sift-format-step.txt")
}

/// Dépose l'étape courante. Rédigée ici et pas côté frontend : c'est le backend qui sait ce
/// qu'il fait, et une table de correspondance en TS dériverait au premier changement. Le texte
/// suit la langue de l'interface (`crate::tr!`) — le processus élevé la reçoit par `LANG_FLAG`.
pub fn write_step(step: &str) {
    if let Ok(mut f) = std::fs::File::create(step_file()) {
        let _ = f.write_all(step.as_bytes());
    }
}

/// Dépose un état terminal d'ÉCHEC : `STEP_FAILED_PREFIX` suivi du message, qui porte la cause
/// dans la langue de l'interface. Le seul chemin par lequel un échec entre dans le fichier.
pub fn write_failed(message: &str) {
    write_step(&format!("{STEP_FAILED_PREFIX}{message}"));
}

/// Le drapeau qui bascule `main` en mode privilégié. Préfixé `--sift-` pour qu'il ne puisse pas
/// entrer en collision avec un argument de Tauri ou de WebView2.
pub const PRIVILEGED_FLAG: &str = "--sift-privileged-format";

/// Codes de sortie du processus élevé. Distincts pour que l'appelant explique la panne plutôt que
/// de dire « échec ».
pub const EXIT_OK: i32 = 0;

/// Marqueur terminal de succès dans le fichier d'étape. Le frontend interroge jusqu'à le voir, ou
/// jusqu'à une ligne commençant par `STEP_FAILED_PREFIX`. Miroir de `shared/contracts.ts`.
///
/// ⚠️ UN MARQUEUR, PAS UN MOT. Il valait « Terminé » jusqu'au 2026-09-23, et le frontend le
/// comparait par `===` : traduire l'étape aurait laissé la fenêtre de formatage interroger pour
/// toujours, bouton Annuler grisé — en anglais seulement, sans une erreur ni un test rouge. Même
/// défaut pour l'échec, reconnu par `startsWith("Échec")` et par `startsWith("Volume
/// inaccessible")`. Les deux marqueurs sont désormais neutres, et le TEXTE vient après.
pub const STEP_DONE: &str = "DONE";

/// Préfixe de tout état terminal d'échec, immédiatement suivi du message (`write_failed`). Un
/// préfixe plutôt qu'une valeur exacte : le message porte la cause, et le frontend la montre sans
/// table de correspondance. Miroir de `shared/contracts.ts`.
pub const STEP_FAILED_PREFIX: &str = "FAILED:";

/// Drapeau qui porte la langue de l'interface au processus élevé, suivi de `fr` ou `en`. Sans
/// lui, ce processus — lancé à neuf, sans base ni interface — écrirait ses étapes en français
/// sous une interface anglaise.
pub const LANG_FLAG: &str = "--sift-lang";
pub const EXIT_BAD_ARGS: i32 = 2;
pub const EXIT_PARTITION_FAILED: i32 = 3;
pub const EXIT_NO_LETTER: i32 = 4;
pub const EXIT_VOLUME_LOCKED: i32 = 5;
pub const EXIT_WRITE_FAILED: i32 = 6;

/// Combien de temps attendre que Windows monte la partition fraîchement créée. Le montage est
/// asynchrone : `diskpart` rend la main avant que la lettre existe.
const LETTER_POLL_ATTEMPTS: u32 = 20;
const LETTER_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(400);

/// Script `diskpart` qui prépare le disque SANS le formater — le formatage, c'est nous.
///
/// `clean` efface la table de partition, `create partition primary` en pose une neuve qui couvre
/// tout le disque, `assign` lui donne une lettre. Pas de `format fs=...` : c'est précisément ce
/// que Windows refuse au-delà de 32 Go, et toute la raison de ce module.
pub fn partition_script(disk_index: u32) -> String {
    // `id=0c` n'est PAS cosmétique. Sans lui, `diskpart` pose son type par défaut — 0x06, FAT16 —
    // et nous écrivons ensuite du FAT32 dedans. Or FAT16 plafonne à 2 Go : une partition de
    // 465 Go typée 0x06 est hors spécification, et Windows finit par la déclarer « endommagée et
    // illisible » (os error 1392, constaté sur le SSD d'Antoine le 2026-08-03). 0x0C est le type
    // FAT32 avec adressage LBA, le seul correct au-delà de 8 Go.
    format!("select disk {disk_index}\nclean\ncreate partition primary id=0c\nassign\nexit\n")
}

/// Analyse les arguments du mode privilégié.
///
/// Rend `None` si le drapeau est absent — le cas normal, celui du lancement de l'interface.
/// Fonction pure : c'est elle qui décide quel disque sera effacé, elle se teste seule.
pub fn parse_args(args: &[String]) -> Option<Result<PrivilegedJob, String>> {
    let pos = args.iter().position(|a| a == PRIVILEGED_FLAG)?;
    let rest = &args[pos + 1..];
    if rest.len() < 3 {
        return Some(Err(format!(
            "{PRIVILEGED_FLAG} attend <index disque> <fat32|exfat> <nom de volume>"
        )));
    }
    let Ok(disk_index) = rest[0].parse::<u32>() else {
        return Some(Err(format!("index de disque illisible: {}", rest[0])));
    };
    let fs = match rest[1].as_str() {
        "fat32" => TargetFs::Fat32,
        "exfat" => TargetFs::ExFat,
        other => return Some(Err(format!("système de fichiers inconnu: {other}"))),
    };
    // Langue : facultative (absente = français), mais une valeur INCONNUE arrête tout plutôt que
    // de retomber en silence sur une autre — les deux bouts sont le même exécutable, donc une
    // valeur illisible est un défaut de construction de la ligne de commande, pas une saisie.
    let lang = match rest[3..].iter().position(|a| a == LANG_FLAG) {
        None => crate::i18n::Lang::Fr,
        Some(i) => match rest.get(3 + i + 1).map(|v| crate::i18n::parse(v)) {
            Some(Some(l)) => l,
            _ => return Some(Err(format!("{LANG_FLAG} attend fr ou en"))),
        },
    };
    Some(Ok(PrivilegedJob {
        disk_index,
        fs,
        label: rest[2].clone(),
        lang,
    }))
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrivilegedJob {
    pub disk_index: u32,
    pub fs: TargetFs,
    pub label: String,
    pub lang: crate::i18n::Lang,
}

/// Exécute le travail privilégié. Rend le code de sortie du processus.
///
/// Aucune interface, aucune base de données, aucun réglage : partitionner, écrire, sortir.
#[cfg(target_os = "windows")]
pub fn run(job: &PrivilegedJob) -> i32 {
    use super::windows as win;

    crate::i18n::set_lang(job.lang);
    eprintln!(
        "sift: mode privilégié, disque {} -> {:?} « {} »",
        job.disk_index, job.fs, job.label
    );

    write_step(&crate::tr!(
        "Partitionnement du disque…",
        "Partitioning the disk…"
    ));
    let script = partition_script(job.disk_index);
    match win::run_diskpart_script(&script) {
        Ok(()) => {}
        Err(e) => {
            write_failed(&crate::tr!(
                "Échec du partitionnement : {e}",
                "Partitioning failed: {e}"
            ));
            eprintln!("sift: partitionnement impossible: {e}");
            return EXIT_PARTITION_FAILED;
        }
    }

    write_step(&crate::tr!(
        "Attente du montage par Windows…",
        "Waiting for Windows to mount the drive…"
    ));
    // Le montage est asynchrone : `diskpart` a rendu la main, la lettre n'existe pas encore.
    let Some(letter) = wait_for_letter(job.disk_index) else {
        eprintln!(
            "sift: aucune lettre montée pour le disque {}",
            job.disk_index
        );
        return EXIT_NO_LETTER;
    };
    eprintln!("sift: volume monté sur {letter}");

    let total_bytes = match win::volume_size_bytes(&letter) {
        Some(b) => b,
        None => {
            eprintln!("sift: taille du volume {letter} illisible");
            return EXIT_NO_LETTER;
        }
    };

    write_step(&crate::tr!(
        "Verrouillage du volume…",
        "Locking the volume…"
    ));
    let mut volume = match RawVolume::open(&letter) {
        Ok(v) => v,
        Err(e) => {
            write_failed(&crate::tr!(
                "Volume inaccessible : {e}",
                "Volume unavailable: {e}"
            ));
            eprintln!("sift: {e}");
            return EXIT_VOLUME_LOCKED;
        }
    };

    write_step(&crate::tr!(
        "Écriture du système de fichiers FAT32…",
        "Writing the FAT32 file system…"
    ));
    let written = match job.fs {
        TargetFs::Fat32 => {
            // A travers l'adaptateur d'alignement : un handle de volume refuse les E/S qui ne
            // tombent pas sur des multiples entiers de secteur, et `fatfs` écrit comme dans un
            // fichier. C'est ce qui a fait échouer le premier formatage réel.
            // Même mot de progression que le chemin sans élévation (`windows.rs`) : tous les
            // 16 Mio, ce processus est le seul à pouvoir dire au parent que ça avance.
            let mut last_reported: u64 = 0;
            let aligned = SectorIo::new(volume.as_file_mut(), u64::from(fat32::BYTES_PER_SECTOR))
                .with_progress(Box::new(move |written| {
                    if written - last_reported >= 16 << 20 {
                        last_reported = written;
                        let mo = written / 1_000_000;
                        write_step(&crate::tr!(
                            "Écriture du système de fichiers FAT32… {mo} Mo écrits",
                            "Writing the FAT32 file system… {mo} MB written"
                        ));
                    }
                }));
            fat32::write_fat32(aligned, total_bytes, &job.label)
        }
        // exFAT passe par diskpart, qui le sait faire sans plafond — ce mode ne devrait pas être
        // sollicité pour lui, mais refuser vaut mieux qu'écrire un FAT32 à sa place.
        TargetFs::ExFat => {
            eprintln!("sift: exFAT ne passe pas par le mode privilégié");
            return EXIT_BAD_ARGS;
        }
    };

    match written {
        Ok(()) => {
            write_step(STEP_DONE);
            eprintln!("sift: FAT32 écrit sur {letter} ({total_bytes} octets)");
            EXIT_OK
        }
        Err(e) => {
            // Dans le fichier d'étape, pas seulement sur stderr : `Start-Process -Verb RunAs` ne
            // permet pas de rediriger la sortie d'un processus eleve, donc stderr est perdu et
            // l'échec serait muet — ce qu'il a été au premier essai réel.
            write_failed(&crate::tr!(
                "Échec de l'écriture : {e}",
                "Write failed: {e}"
            ));
            eprintln!("sift: écriture FAT32 impossible: {e}");
            EXIT_WRITE_FAILED
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_letter(disk_index: u32) -> Option<String> {
    use super::windows as win;
    for _ in 0..LETTER_POLL_ATTEMPTS {
        std::thread::sleep(LETTER_POLL_INTERVAL);
        if let Some(l) = win::first_letter_of_disk(disk_index) {
            return Some(l);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_flag_means_normal_launch() {
        let args = vec!["sift.exe".to_string(), "--other".to_string()];
        assert!(parse_args(&args).is_none());
    }

    #[test]
    fn parses_a_complete_job() {
        let args = vec![
            "sift.exe".to_string(),
            PRIVILEGED_FLAG.to_string(),
            "2".to_string(),
            "fat32".to_string(),
            "DJERMUSIQUE".to_string(),
        ];
        assert_eq!(
            parse_args(&args).expect("drapeau present").expect("valide"),
            PrivilegedJob {
                disk_index: 2,
                fs: TargetFs::Fat32,
                label: "DJERMUSIQUE".to_string(),
                lang: crate::i18n::Lang::Fr,
            }
        );
    }

    #[test]
    fn la_langue_de_l_interface_passe_au_processus_eleve() {
        let args: Vec<String> = [
            "sift.exe",
            PRIVILEGED_FLAG,
            "2",
            "fat32",
            "X",
            LANG_FLAG,
            "en",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let job = parse_args(&args).expect("drapeau present").expect("valide");
        assert_eq!(job.lang, crate::i18n::Lang::En);
    }

    /// Une langue illisible arrête le processus : il ne formate pas un disque sur une ligne de
    /// commande que ses deux bouts ne comprennent pas de la même façon.
    #[test]
    fn une_langue_inconnue_ou_absente_apres_le_drapeau_est_refusee() {
        for bad in [vec![LANG_FLAG, "de"], vec![LANG_FLAG]] {
            let mut args: Vec<String> = ["sift.exe", PRIVILEGED_FLAG, "2", "fat32", "X"]
                .iter()
                .map(|s| s.to_string())
                .collect();
            args.extend(bad.iter().map(|s| s.to_string()));
            assert!(
                parse_args(&args).expect("drapeau present").is_err(),
                "{args:?}"
            );
        }
    }

    /// Le frontend reconnaît ces deux marqueurs (`usb-format-modal.ts`) : ils sont recopiés dans
    /// `shared/contracts.ts`, et ce test lie chaque valeur à SON nom — pas seulement à sa présence
    /// quelque part dans le fichier, où `"DONE"` pourrait apparaître pour une autre raison.
    #[test]
    fn step_markers_match_contracts_ts() {
        const CONTRACTS_TS: &str = include_str!("../../../shared/contracts.ts");
        for (name, value) in [
            ("STEP_DONE", STEP_DONE),
            ("STEP_FAILED_PREFIX", STEP_FAILED_PREFIX),
        ] {
            let expected = format!("export const {name} = \"{value}\";");
            assert!(
                CONTRACTS_TS.contains(&expected),
                "shared/contracts.ts must contain {expected}"
            );
        }
    }

    /// Les marqueurs terminaux ne sont PAS du texte : aucune langue ne les change, et le message
    /// d'échec les suit sans espace. Le frontend lit `startsWith(STEP_FAILED_PREFIX)` puis coupe.
    #[test]
    fn les_marqueurs_d_etape_sont_neutres_et_l_echec_les_precede() {
        assert!(STEP_DONE.is_ascii() && STEP_FAILED_PREFIX.is_ascii());
        for l in [crate::i18n::Lang::Fr, crate::i18n::Lang::En] {
            let msg = crate::i18n::with_lang(l, || {
                crate::tr!("Échec de l'écriture : {}", "Write failed: {}", "x")
            });
            let line = format!("{STEP_FAILED_PREFIX}{msg}");
            assert!(line.starts_with(STEP_FAILED_PREFIX));
            assert_eq!(&line[STEP_FAILED_PREFIX.len()..], msg);
        }
    }

    /// Un index illisible doit ARRÊTER le processus, jamais retomber sur une valeur par défaut :
    /// le disque 0 est le premier de la machine.
    #[test]
    fn an_unreadable_index_is_refused_not_defaulted() {
        let args = vec![
            "sift.exe".to_string(),
            PRIVILEGED_FLAG.to_string(),
            "pas-un-nombre".to_string(),
            "fat32".to_string(),
            "X".to_string(),
        ];
        assert!(parse_args(&args).expect("drapeau present").is_err());
    }

    #[test]
    fn missing_arguments_are_refused() {
        let args = vec![
            "sift.exe".to_string(),
            PRIVILEGED_FLAG.to_string(),
            "2".to_string(),
        ];
        assert!(parse_args(&args).expect("drapeau present").is_err());
    }

    /// Le script ne doit JAMAIS contenir `format` : c'est ce que Windows refuse au-delà de 32 Go,
    /// et le laisser passer ramènerait le bug que ce module existe pour contourner.
    #[test]
    fn partition_script_creates_but_never_formats() {
        let s = partition_script(2);
        assert!(s.starts_with("select disk 2\n"), "{s}");
        assert!(s.contains("\nclean\n"), "{s}");
        // `id=0c` est la seule chose que diskpart doit dire du système de fichiers : le type MBR.
        // Sans lui il pose 0x06 (FAT16), et le FAT32 qu'on écrit ensuite devient illisible
        // (os error 1392, constate le 2026-08-03). Le contenu, lui, reste notre travail.
        assert!(s.contains("\ncreate partition primary id=0c\n"), "{s}");
        assert!(s.contains("\nassign\n"), "{s}");
        assert!(
            !s.contains("format"),
            "le formatage est notre travail, pas celui de diskpart: {s}"
        );
    }
}
