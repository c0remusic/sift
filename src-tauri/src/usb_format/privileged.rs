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
//! **Une seule invite UAC.** Le partitionnement (cmdlets de stockage, plus `diskpart` depuis le
//! 2026-10-07) et l'écriture brute ont tous deux besoin de l'élévation ; les faire depuis le même
//! processus élevé évite d'en demander deux fois.

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

/// Fichier où le processus élevé dépose la durée de chaque étape, que le parent relit à la fin et
/// journalise. Même raison que `step_file` : la sortie d'un processus lancé par `-Verb RunAs` est
/// perdue. Sans ces durées, « le formatage est encore long » (Antoine, 2026-10-07) ne dit pas
/// quelle étape coûte — `diskpart`, l'attente de la lettre, le verrou ou l'écriture.
/// Le chronométrage ne sert que le chemin Windows (macOS formate par `diskutil`) : d'où les
/// `allow(dead_code)` hors Windows sur les trois éléments.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn timings_file() -> std::path::PathBuf {
    std::env::temp_dir().join("sift-format-timings.txt")
}

/// Une ligne de chronométrage : l'étape, sa durée, le cumul depuis le début. Pure.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn timing_line(etape: &str, duree_ms: u128, cumul_ms: u128) -> String {
    format!("{etape} : {duree_ms} ms (cumul {cumul_ms} ms)")
}

/// Chronomètre les étapes d'un formatage : chaque appel à `etape` clôt l'étape en cours, la
/// journalise, et l'ajoute au fichier de durées quand il y en a un (le processus élevé, qui n'a
/// pas de journal). Un échec d'écriture du fichier ne fait rien échouer : c'est une mesure.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct Chrono {
    debut: std::time::Instant,
    dernier: std::time::Instant,
    fichier: Option<std::path::PathBuf>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl Chrono {
    /// Démarre le chronomètre. Avec un fichier, le vide d'abord : des durées laissées par un
    /// formatage précédent passeraient pour celles de celui-ci.
    pub fn new(fichier: Option<std::path::PathBuf>) -> Self {
        if let Some(f) = &fichier {
            let _ = std::fs::File::create(f);
        }
        let maintenant = std::time::Instant::now();
        Self {
            debut: maintenant,
            dernier: maintenant,
            fichier,
        }
    }

    /// Clôt l'étape `etape`.
    pub fn etape(&mut self, etape: &str) {
        let maintenant = std::time::Instant::now();
        let ligne = timing_line(
            etape,
            (maintenant - self.dernier).as_millis(),
            (maintenant - self.debut).as_millis(),
        );
        self.dernier = maintenant;
        log::info!("format — {ligne}");
        if let Some(f) = &self.fichier {
            if let Ok(mut out) = std::fs::OpenOptions::new().append(true).open(f) {
                let _ = writeln!(out, "{ligne}");
            }
        }
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
/// asynchrone : la partition peut exister avant sa lettre.
const LETTER_POLL_ATTEMPTS: u32 = 20;
const LETTER_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(400);

/// Script PowerShell qui prépare le disque, par les cmdlets de stockage.
///
/// `Clear-Disk` efface la table de partition (sauté sur un disque vierge, où il échouerait),
/// `Initialize-Disk` pose une table MBR, `New-Partition` une partition qui couvre tout le disque,
/// avec sa lettre. Ensuite :
/// - **FAT32** : RIEN de plus — le formatage, c'est nous (`write_fat32`). Pas de `Format-Volume` :
///   c'est précisément ce que Windows refuse au-delà de 32 Go, et toute la raison de ce module.
/// - **exFAT** : `Format-Volume`, que Windows sait faire à toute taille, avec le nom de volume —
///   que l'ancien `diskpart` (`format fs=exfat quick`, sans `label=`) ignorait.
///
/// **Ce n'est plus `diskpart`** (2026-10-07). Chronométré sur le SSD de 500 Go d'Antoine :
/// `diskpart` prenait 36,5 s des 39,6 s d'un formatage, dont ~26,5 s pour son seul démarrage —
/// `list disk` seul, sans rien écrire, mesurait 26,8 s puis 26,4 s. Les cmdlets de stockage font
/// le même travail en 4,6 s (`Clear-Disk` 2,7 s, `Initialize-Disk` 0,7 s, `New-Partition` 1,2 s)
/// et rendent la même partition : 500 105 740 288 octets, type MBR 0x0C.
pub fn storage_script(disk_index: u32, fs: TargetFs, label: &str) -> String {
    let tete = format!(
        "$ErrorActionPreference = 'Stop'\n\
         $d = Get-Disk -Number {disk_index}\n\
         if ($d.PartitionStyle -ne 'RAW') {{ Clear-Disk -Number {disk_index} -RemoveData -RemoveOEM -Confirm:$false }}\n\
         Initialize-Disk -Number {disk_index} -PartitionStyle MBR\n"
    );
    match fs {
        // `-MbrType FAT32` n'est PAS cosmétique : c'est le type 0x0C (FAT32 avec adressage LBA), le
        // seul correct au-delà de 8 Go — mesuré `MbrType 12` sur la partition rendue. Un FAT32
        // écrit dans une partition typée 0x06 (FAT16, plafond 2 Go) finit déclaré « endommagé et
        // illisible » par Windows (os error 1392, SSD d'Antoine, 2026-08-03 — c'était alors le
        // `id=0c` manquant de `diskpart`).
        TargetFs::Fat32 => format!(
            "{tete}New-Partition -DiskNumber {disk_index} -UseMaximumSize -MbrType FAT32 -AssignDriveLetter | Out-Null\n"
        ),
        // `-MbrType IFS` = 0x07, le type des volumes exFAT (et NTFS).
        TargetFs::ExFat => format!(
            "{tete}New-Partition -DiskNumber {disk_index} -UseMaximumSize -MbrType IFS -AssignDriveLetter \
             | Format-Volume -FileSystem exFAT -NewFileSystemLabel '{}' -Confirm:$false | Out-Null\n",
            nom_de_volume_sur(label)
        ),
    }
}

/// Le nom de volume tel qu'il peut entrer, entre guillemets simples, dans un script élevé : lettres
/// et chiffres ASCII, `_` et `-`, 11 au plus — la règle de `windows::sanitize_label_for_command`,
/// déjà appliquée par le parent, réappliquée ici parce que CE texte part dans un script exécuté en
/// administrateur. Vide après filtrage : `SIFT`.
fn nom_de_volume_sur(label: &str) -> String {
    let nom: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(11)
        .collect();
    if nom.is_empty() {
        "SIFT".to_string()
    } else {
        nom
    }
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

    let mut chrono = Chrono::new(Some(timings_file()));

    // exFAT : Windows sait le créer à toute taille. Partition et `Format-Volume` dans le même
    // script, et le travail est fini — ni attente de lettre, ni écriture brute.
    if job.fs == TargetFs::ExFat {
        write_step(&crate::tr!(
            "Partitionnement et formatage exFAT…",
            "Partitioning and formatting as exFAT…"
        ));
        let fait = win::run_powershell_script(&storage_script(
            job.disk_index,
            TargetFs::ExFat,
            &job.label,
        ));
        chrono.etape("partitionnement et formatage exFAT (cmdlets)");
        return match fait {
            Ok(()) => {
                write_step(STEP_DONE);
                eprintln!("sift: exFAT écrit sur le disque {}", job.disk_index);
                EXIT_OK
            }
            Err(e) => {
                write_failed(&crate::tr!(
                    "Échec du formatage exFAT : {e}",
                    "exFAT formatting failed: {e}"
                ));
                eprintln!("sift: formatage exFAT impossible: {e}");
                EXIT_PARTITION_FAILED
            }
        };
    }

    write_step(&crate::tr!(
        "Partitionnement du disque…",
        "Partitioning the disk…"
    ));
    let script = storage_script(job.disk_index, TargetFs::Fat32, &job.label);
    let partition = win::run_powershell_script(&script);
    chrono.etape("partitionnement (Clear-Disk, Initialize-Disk, New-Partition)");
    match partition {
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
    let monte = wait_for_letter(job.disk_index);
    chrono.etape("attente de la lettre");
    let Some(letter) = monte else {
        eprintln!(
            "sift: aucune lettre montée pour le disque {}",
            job.disk_index
        );
        return EXIT_NO_LETTER;
    };
    eprintln!("sift: volume monté sur {letter}");

    let taille = win::volume_size_bytes(&letter);
    chrono.etape("taille du volume (WMI)");
    let total_bytes = match taille {
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
    let ouvert = RawVolume::open(&letter);
    chrono.etape("verrouillage du volume");
    let mut volume = match ouvert {
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
        // Traité et rendu plus haut, avant l'attente de la lettre. Refuser vaut mieux qu'écrire un
        // FAT32 à sa place si ce match redevenait atteignable.
        TargetFs::ExFat => {
            eprintln!("sift: exFAT atteint l'écriture FAT32 — refusé");
            return EXIT_BAD_ARGS;
        }
    };
    chrono.etape("écriture FAT32");

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
    fn une_ligne_de_duree_dit_l_etape_sa_duree_et_le_cumul() {
        assert_eq!(
            timing_line("écriture FAT32", 1234, 5678),
            "écriture FAT32 : 1234 ms (cumul 5678 ms)"
        );
    }

    /// Le fichier de durées repart vide à chaque formatage, puis reçoit une ligne par étape, dans
    /// l'ordre : sans la remise à zéro, les durées d'un formatage précédent passeraient pour
    /// celles du suivant.
    #[test]
    fn le_chrono_vide_le_fichier_puis_ajoute_une_ligne_par_etape() {
        let dir = tempfile::tempdir().expect("tempdir");
        let f = dir.path().join("durees.txt");
        std::fs::write(&f, "reste d'un formatage précédent\n").expect("write");
        let mut chrono = Chrono::new(Some(f.clone()));
        chrono.etape("diskpart");
        chrono.etape("écriture FAT32");
        let lignes: Vec<String> = std::fs::read_to_string(&f)
            .expect("read")
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(lignes.len(), 2, "{lignes:?}");
        assert!(lignes[0].starts_with("diskpart : "), "{lignes:?}");
        assert!(lignes[1].starts_with("écriture FAT32 : "), "{lignes:?}");
    }

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

    /// Les numéros de disque visés par un script : chaque `-Number` / `-DiskNumber`.
    fn disques_vises(s: &str) -> Vec<String> {
        s.split(|c: char| c.is_whitespace())
            .collect::<Vec<_>>()
            .windows(2)
            .filter(|w| w[0] == "-Number" || w[0] == "-DiskNumber")
            .map(|w| w[1].to_string())
            .collect()
    }

    /// En exFAT, Windows formate — à toute taille — et le NOM du volume part avec : l'ancien
    /// `diskpart` (`format fs=exfat quick`, sans `label=`) l'ignorait. Le type de partition est
    /// IFS (0x07), jamais FAT32 ; et le nom, qui entre dans un script ADMINISTRATEUR entre
    /// guillemets simples, ne garde que des caractères sûrs.
    #[test]
    fn storage_script_exfat_formate_avec_le_nom_et_ne_vise_que_ce_disque() {
        let s = storage_script(5, TargetFs::ExFat, "DJ-KEY_1");
        assert!(s.starts_with("$ErrorActionPreference = 'Stop'\n"), "{s}");
        assert!(
            s.contains("\nInitialize-Disk -Number 5 -PartitionStyle MBR\n"),
            "{s}"
        );
        assert!(
            s.contains(
                "New-Partition -DiskNumber 5 -UseMaximumSize -MbrType IFS -AssignDriveLetter"
            ),
            "{s}"
        );
        assert!(
            s.contains(
                "| Format-Volume -FileSystem exFAT -NewFileSystemLabel 'DJ-KEY_1' -Confirm:$false"
            ),
            "{s}"
        );
        assert!(
            !s.contains("MbrType FAT32") && !s.contains("FileSystem FAT32"),
            "{s}"
        );
        assert_eq!(disques_vises(&s), vec!["5", "5", "5", "5"], "{s}");

        let piege = storage_script(5, TargetFs::ExFat, "A'; Clear-Disk -Number 0 #");
        assert!(
            piege.contains("-NewFileSystemLabel 'AClear-Disk'"),
            "le nom ne doit garder que lettres, chiffres, _ et -, 11 au plus : {piege}"
        );
        assert_eq!(disques_vises(&piege), vec!["5", "5", "5", "5"], "{piege}");
        assert!(
            storage_script(5, TargetFs::ExFat, "'''").contains("-NewFileSystemLabel 'SIFT'"),
            "nom vide après filtrage : SIFT"
        );
    }

    /// Le script FAT32 ne doit JAMAIS formater : c'est ce que Windows refuse au-delà de 32 Go, et
    /// le laisser passer ramènerait le bug que ce module existe pour contourner. Chaque commande
    /// vise le disque demandé, et AUCUN autre.
    #[test]
    fn storage_script_fat32_creates_but_never_formats() {
        let s = storage_script(2, TargetFs::Fat32, "SIFT");
        assert!(s.starts_with("$ErrorActionPreference = 'Stop'\n"), "{s}");
        // Effacer seulement un disque déjà initialisé : `Clear-Disk` échoue sur un disque vierge.
        assert!(
            s.contains("if ($d.PartitionStyle -ne 'RAW') { Clear-Disk -Number 2 -RemoveData -RemoveOEM -Confirm:$false }"),
            "{s}"
        );
        assert!(
            s.contains("\nInitialize-Disk -Number 2 -PartitionStyle MBR\n"),
            "{s}"
        );
        // `-MbrType FAT32` (0x0C) est la seule chose que le script dit du système de fichiers.
        // Sans lui, un FAT32 écrit dans une partition d'un autre type devient illisible (os error
        // 1392, constaté le 2026-08-03). Le contenu, lui, reste notre travail.
        assert!(
            s.contains(
                "\nNew-Partition -DiskNumber 2 -UseMaximumSize -MbrType FAT32 -AssignDriveLetter"
            ),
            "{s}"
        );
        assert_eq!(disques_vises(&s), vec!["2", "2", "2", "2"], "{s}");
        assert!(
            !s.to_lowercase().contains("format-volume"),
            "le formatage est notre travail, pas celui de Windows: {s}"
        );
    }
}
