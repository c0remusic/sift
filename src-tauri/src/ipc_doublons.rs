//! Les commandes de l'écran Doublons (`docs/ui-specs/doublons.md`).
//!
//! `list_duplicate_groups` et `apply_duplicate_plan` sont les troisième et quatrième commandes
//! dont le corps part hors du fil de la fenêtre, après `ipc::analyze_path` et
//! `ipc_identify::identify` — décision actée avec la spec, le 2026-10-05 (`CLAUDE.md` § Backend).
//! La première lit 3 400 pistes puis des fichiers sur le disque (échantillons de contenu,
//! existence de chaque copie) ; la seconde déplace N fichiers. Synchrones, elles gèleraient
//! l'interface comme `analyze_path` et `identify` le faisaient avant d'y passer.

use crate::db;
use crate::doublons::{self, DupScreenGroup, Faits, RekordboxDoubt, RekordboxUse};
use crate::filing;
use crate::rekordbox_presence::{self, Presence, PresenceSource};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};

/// Tous les groupes de la bibliothèque (file et Rangés), dans l'ordre de l'écran. Le corps
/// synchrone part sur `spawn_blocking`. Gardé par `list_duplicate_groups_reste_hors_du_fil_de_la_fenetre`.
#[tauri::command]
pub async fn list_duplicate_groups(app: AppHandle) -> Result<Vec<DupScreenGroup>, String> {
    tauri::async_runtime::spawn_blocking(move || lister_bloquant(app))
        .await
        // Le fil a paniqué ou été annulé : l'échec se rend en Err, jamais un `unwrap`.
        .map_err(|e| {
            crate::tr!(
                "doublons : le fil de calcul n'a pas rendu : {e}",
                "duplicates: the computing thread didn't return: {e}"
            )
        })?
}

/// Le corps de `list_duplicate_groups`, SYNCHRONE. Deux sections de verrou courtes — les
/// lignes et le réglage Rekordbox, puis les fréquences des seuls membres —, et entre elles le
/// calcul et les lectures de fichiers (échantillons, existence, collection Rekordbox), verrou
/// relâché.
fn lister_bloquant(app: AppHandle) -> Result<Vec<DupScreenGroup>, String> {
    let state = app.state::<Mutex<Connection>>();
    let (lignes, aretes, refus, sources) = {
        let conn = db::lock_conn(&state)?;
        (
            doublons::charger_lignes(&conn).map_err(|e| e.to_string())?,
            doublons::charger_aretes_son(&conn).map_err(|e| e.to_string())?,
            doublons::charger_refus(&conn).map_err(|e| e.to_string())?,
            rekordbox_presence::presence_sources(&conn).map_err(|e| e.to_string())?,
        )
    };
    let cles: Vec<String> = lignes
        .iter()
        .map(|l| doublons::cle_de_nom(&l.path))
        .collect();
    let sommes = doublons::echantillonner(&lignes);
    let bruts = doublons::former_groupes(&lignes, &cles, &sommes, &aretes, &refus);
    let membres: Vec<usize> = bruts
        .iter()
        .flat_map(|b| b.membres.iter().copied())
        .collect();
    let ids: Vec<i64> = membres.iter().map(|&i| lignes[i].id).collect();
    let frequences = {
        let conn = db::lock_conn(&state)?;
        doublons::charger_frequences(&conn, &ids).map_err(|e| e.to_string())?
    };
    let absentes: HashSet<i64> = membres
        .iter()
        .filter(|&&i| !Path::new(&lignes[i].path).is_file())
        .map(|&i| lignes[i].id)
        .collect();
    // Une passe sur toute la collection (≈ 0,2 s à froid, `rekordbox_presence`), puis une
    // recherche par membre. Les seuls membres : une piste hors groupe n'a pas de case Garder.
    let presence = rekordbox_presence::rekordbox_presence(&sources);
    let doute = doute_rekordbox(presence.source());
    let rekordbox: HashMap<i64, RekordboxUse> = membres
        .iter()
        .map(|&i| {
            let p = presence.of(&lignes[i].path);
            (lignes[i].id, usage_rekordbox(p, doute))
        })
        .collect();
    let faits = Faits {
        frequences,
        absentes,
        rekordbox,
        rekordbox_connu: presence.source().is_some(),
    };
    let mut groupes: Vec<DupScreenGroup> = bruts
        .iter()
        .map(|b| doublons::assembler(&lignes, &cles, b, &faits))
        .collect();
    doublons::trier(&mut groupes);
    Ok(groupes)
}

/// Pourquoi la source lue ne peut pas affirmer qu'une copie est absente de Rekordbox ; `None`
/// quand elle le peut — un `master.db` sans journal en attente — ou quand rien n'a été lu (la
/// présence est alors inconnue de toute façon).
fn doute_rekordbox(source: Option<&PresenceSource>) -> Option<RekordboxDoubt> {
    match source {
        Some(PresenceSource::MasterDb { wal_pending: true }) => Some(RekordboxDoubt::RekordboxOpen),
        Some(PresenceSource::LinkedXml { .. }) => Some(RekordboxDoubt::XmlSnapshot),
        Some(PresenceSource::MasterDb { wal_pending: false }) | None => None,
    }
}

/// La présence lue (`rekordbox_presence`) dans la forme du contrat de l'écran. « Absente » ne se
/// dit que si la source peut l'affirmer (`doute` vide) : un `master.db` sans journal en attente.
/// Le XML lié est un instantané d'export, et un `master.db` dont Rekordbox tient encore le journal
/// (`wal_pending`) ignore ses derniers imports : l'un comme l'autre peut taire une piste que
/// Rekordbox joue — 239 des 536 pistes de `master.db` manquaient au XML lié, mesuré le 2026-10-05
/// (`rekordbox_presence`). Leur « absente » devient « non vérifiée », avec la raison, que la
/// confirmation dit avant d'envoyer ; leur « présente » reste.
fn usage_rekordbox(p: Presence, doute: Option<RekordboxDoubt>) -> RekordboxUse {
    match (p, doute) {
        (Presence::Present { playlists }, _) => RekordboxUse::Present { playlists },
        (Presence::Absent, None) => RekordboxUse::Absent,
        (Presence::Absent, Some(reason)) => RekordboxUse::Unverified { reason },
        (Presence::Unknown, _) => RekordboxUse::Unknown,
    }
}

/// « Ce ne sont pas des doublons », sur un groupe : ses paires ne relient plus. Une écriture
/// courte en base, sans fichier : reste synchrone.
#[tauri::command]
pub fn refuse_duplicate_group(
    conn: State<'_, Mutex<Connection>>,
    ids: Vec<i64>,
) -> Result<usize, String> {
    let conn = db::lock_conn(&conn)?;
    doublons::refuser(&conn, &ids).map_err(|e| e.to_string())
}

/// « Arrêter » : lu ENTRE deux copies, jamais au milieu d'un déplacement — rien n'est défait.
static ARRET: AtomicBool = AtomicBool::new(false);

/// Une copie que l'application n'a pas pu envoyer. Miroir : `DupApplyFailure` de
/// `shared/contracts.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupApplyFailure {
    pub id: i64,
    pub error: String,
}

/// Le résultat d'une application. Miroir : `DupApplyResult` de `shared/contracts.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupApplyResult {
    /// Le lot du journal : un seul Ctrl+Z annule toute l'application. `None` si rien n'est parti.
    pub batch_id: Option<String>,
    pub trashed: Vec<i64>,
    pub failed: Vec<DupApplyFailure>,
    pub stopped: bool,
}

/// L'événement `duplicates:progress`, émis après chaque copie traitée. Miroir :
/// `DupApplyProgress` de `shared/contracts.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct DupApplyProgress {
    pub done: usize,
    pub total: usize,
    pub id: i64,
}

/// Applique un plan de l'écran Doublons : les copies `ids` partent dans la corbeille de leur
/// disque (`filing::trash_file_fs`, un renommage instantané sur le même volume), en UN lot du
/// journal. Le corps synchrone part sur `spawn_blocking` : N déplacements, dont le secours par
/// copie peut coûter des secondes chacun. Gardé par
/// `apply_duplicate_plan_reste_hors_du_fil_de_la_fenetre`.
#[tauri::command]
pub async fn apply_duplicate_plan(app: AppHandle, ids: Vec<i64>) -> Result<DupApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || appliquer_bloquant(app, ids))
        .await
        .map_err(|e| {
            crate::tr!(
                "doublons : le fil d'application n'a pas rendu : {e}",
                "duplicates: the apply thread didn't return: {e}"
            )
        })?
}

/// Le corps d'`apply_duplicate_plan`, SYNCHRONE : la boucle `appliquer`, branchée sur la vraie
/// base, la vraie corbeille et les événements de la fenêtre.
fn appliquer_bloquant(app: AppHandle, ids: Vec<i64>) -> Result<DupApplyResult, String> {
    let state = app.state::<Mutex<Connection>>();
    let res = appliquer(
        || db::lock_conn(&state),
        |id, source| filing::trash_file_fs(id, source).map_err(|e| e.to_string()),
        &ids,
        &ARRET,
        |p| {
            app.emit("duplicates:progress", p).ok();
        },
    );
    app.emit("queue:changed", ()).ok();
    res
}

/// « Arrêter » sur la feuille de progression.
#[tauri::command]
pub fn stop_duplicate_plan() {
    ARRET.store(true, Ordering::SeqCst);
}

/// Le chemin d'une copie qui peut encore partir : présente en base, `pending` ou `filed`. Une
/// copie déjà à la corbeille, écartée ou purgée entre le plan et l'application ne se rejoue pas.
fn copie_envoyable(conn: &Connection, id: i64) -> Result<String, String> {
    let ligne: Option<(String, String)> = conn
        .query_row(
            "SELECT path, status FROM tracks WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match ligne {
        Some((path, status)) if status == "pending" || status == "filed" => Ok(path),
        _ => Err(crate::tr!(
            "cette copie n'est plus dans la bibliothèque",
            "this copy is no longer in the library"
        )),
    }
}

/// Le cœur de l'application, sans Tauri : la base derrière `verrou`, le déplacement derrière
/// `deplacer` (la corbeille par disque en production, un dossier temporaire en test — jamais le
/// vrai dossier Documents). Pour chaque copie, trois temps, comme `ipc_filing::trash_track` : le
/// chemin sous un verrou COURT, le déplacement verrou relâché, puis le journal et le statut sous
/// verrou, dans le lot COMMUN — un seul Ctrl+Z (`actions::undo_last`) remet tout en place. Une
/// copie qui échoue est dite et la boucle continue ; « Arrêter » est lu entre deux copies.
pub(crate) fn appliquer<'a>(
    verrou: impl Fn() -> Result<MutexGuard<'a, Connection>, String>,
    deplacer: impl Fn(i64, &str) -> Result<String, String>,
    ids: &[i64],
    arret: &AtomicBool,
    mut progres: impl FnMut(DupApplyProgress),
) -> Result<DupApplyResult, String> {
    arret.store(false, Ordering::SeqCst);
    let mut res = DupApplyResult {
        batch_id: None,
        trashed: Vec::new(),
        failed: Vec::new(),
        stopped: false,
    };
    let Some(&premier) = ids.first() else {
        return Ok(res);
    };
    let lot = filing::new_batch_id(premier);
    for (i, &id) in ids.iter().enumerate() {
        if arret.load(Ordering::SeqCst) {
            res.stopped = true;
            break;
        }
        let envoi = (|| -> Result<(), String> {
            let source = {
                let conn = verrou()?;
                copie_envoyable(&conn, id)?
            };
            let dest = deplacer(id, &source)?;
            let conn = verrou()?;
            let journal = filing::commit_trash_in_batch(&conn, &lot, id, &source, &dest);
            drop(conn);
            journal.map_err(|e| {
                // Le fichier est parti et rien ne le journalise : hors de portée de Ctrl+Z comme de
                // Restaurer, il dormirait dans la corbeille. Il revient à sa place.
                match filing::move_cross_disk_safe(Path::new(&dest), Path::new(&source)) {
                    Ok(()) => e.to_string(),
                    Err(retour) => crate::tr!(
                        "{e} — et le fichier n'a pas pu revenir de {dest} : {retour}",
                        "{e} — and the file could not come back from {dest}: {retour}"
                    ),
                }
            })
        })();
        match envoi {
            Ok(()) => res.trashed.push(id),
            Err(error) => res.failed.push(DupApplyFailure { id, error }),
        }
        progres(DupApplyProgress {
            done: i + 1,
            total: ids.len(),
            id,
        });
    }
    if !res.trashed.is_empty() {
        res.batch_id = Some(lot);
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        Mutex::new(conn)
    }

    fn piste(conn: &Connection, id: i64, path: &Path, status: &str) {
        conn.execute(
            "INSERT INTO tracks (id, path, status) VALUES (?1, ?2, ?3)",
            params![id, path.to_string_lossy(), status],
        )
        .unwrap();
    }

    /// La corbeille par disque, dans un dossier temporaire : jamais le vrai dossier Documents.
    fn deplacer_vers(corbeille: &Path) -> impl Fn(i64, &str) -> Result<String, String> + '_ {
        move |id, src| {
            filing::move_to_trash(Path::new(src), id, corbeille)
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        }
    }

    #[test]
    fn une_application_est_un_seul_lot_que_l_annulation_defait_en_entier() {
        let dir = tempfile::tempdir().unwrap();
        let corbeille = dir.path().join("corbeille");
        let a = dir.path().join("A - B.mp3");
        let b = dir.path().join("A - B (copie).mp3");
        std::fs::write(&a, b"aaa").unwrap();
        std::fs::write(&b, b"bbb").unwrap();
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, &a, "pending");
            piste(&c, 2, &b, "filed");
            c.execute("UPDATE tracks SET folder='House' WHERE id=2", [])
                .unwrap();
        }
        let arret = AtomicBool::new(false);
        let mut vus = Vec::new();
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            deplacer_vers(&corbeille),
            &[1, 2],
            &arret,
            |p| vus.push((p.done, p.total, p.id)),
        )
        .unwrap();
        assert_eq!(res.trashed, vec![1, 2]);
        assert!(res.failed.is_empty() && !res.stopped);
        assert_eq!(vus, vec![(1, 2, 1), (2, 2, 2)]);
        assert!(!a.exists() && !b.exists());
        let lot = res.batch_id.clone().unwrap();
        let c = m.lock().unwrap();
        let n: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM actions WHERE batch_id=?1 AND type='trash'",
                params![lot],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2, "un seul lot pour toute l'application");
        let statuts: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM tracks WHERE status='trash'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(statuts, 2);
        crate::actions::revert_batch(&c, &lot).unwrap();
        assert!(
            a.exists() && b.exists(),
            "un seul Ctrl+Z remet tout en place"
        );
        let statut = |id: i64| -> (String, Option<String>) {
            c.query_row(
                "SELECT status, folder FROM tracks WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(
            statut(1),
            ("pending".into(), None),
            "la copie de la file y revient"
        );
        assert_eq!(
            statut(2),
            ("filed".into(), Some("House".into())),
            "la copie rangée retourne à Rangés, dossier compris — pas à la file"
        );
    }

    /// La garde LIFO vaut pour CHAQUE piste du lot, pas seulement celle de sa dernière ligne : un
    /// geste plus récent sur la première copie envoyée doit être défait d'abord.
    #[test]
    fn l_annulation_attend_un_geste_plus_recent_sur_n_importe_quelle_copie() {
        let dir = tempfile::tempdir().unwrap();
        let corbeille = dir.path().join("corbeille");
        let a = dir.path().join("A - B.mp3");
        let b = dir.path().join("A - B.wav");
        std::fs::write(&a, b"aaa").unwrap();
        std::fs::write(&b, b"bbb").unwrap();
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, &a, "pending");
            piste(&c, 2, &b, "pending");
        }
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            deplacer_vers(&corbeille),
            &[1, 2],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        let lot = res.batch_id.unwrap();
        let c = m.lock().unwrap();
        crate::actions::record(&c, "plus-tard", Some(1), "reject", None, None).unwrap();
        assert!(
            crate::actions::revert_batch(&c, &lot).is_err(),
            "la piste 1, plus ancienne du lot, porte un geste plus récent"
        );
    }

    /// Un journal qui échoue après le déplacement remet le fichier à sa place : sans ligne
    /// d'action, ni Ctrl+Z ni Restaurer ne l'atteindraient.
    #[test]
    fn un_journal_en_echec_remet_le_fichier_en_place() {
        let dir = tempfile::tempdir().unwrap();
        let corbeille = dir.path().join("corbeille");
        let a = dir.path().join("A - B.mp3");
        std::fs::write(&a, b"aaa").unwrap();
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, &a, "pending");
            // Le journal refuse toute nouvelle ligne : l'écriture du `trash` échouera.
            c.execute_batch(
                "CREATE TRIGGER refus BEFORE INSERT ON actions BEGIN SELECT RAISE(ABORT, 'refus'); END;",
            )
            .unwrap();
        }
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            deplacer_vers(&corbeille),
            &[1],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(res.failed.len(), 1);
        assert!(res.trashed.is_empty() && res.batch_id.is_none());
        assert!(a.exists(), "le fichier est revenu");
        let c = m.lock().unwrap();
        let statut: String = c
            .query_row("SELECT status FROM tracks WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(statut, "pending");
    }

    #[test]
    fn une_copie_deja_partie_echoue_et_la_boucle_continue() {
        let dir = tempfile::tempdir().unwrap();
        let corbeille = dir.path().join("corbeille");
        let a = dir.path().join("A - B.mp3");
        let b = dir.path().join("A - B.wav");
        std::fs::write(&a, b"aaa").unwrap();
        std::fs::write(&b, b"bbb").unwrap();
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, &a, "trash");
            piste(&c, 2, &b, "pending");
        }
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            deplacer_vers(&corbeille),
            &[1, 2],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(res.failed.len(), 1);
        assert_eq!(res.failed[0].id, 1);
        assert_eq!(res.trashed, vec![2]);
        assert!(
            a.exists(),
            "une copie qui n'est plus dans la bibliothèque ne bouge pas"
        );
    }

    #[test]
    fn arreter_tombe_entre_deux_copies() {
        let dir = tempfile::tempdir().unwrap();
        let corbeille = dir.path().join("corbeille");
        let a = dir.path().join("A - B.mp3");
        let b = dir.path().join("A - B.wav");
        std::fs::write(&a, b"aaa").unwrap();
        std::fs::write(&b, b"bbb").unwrap();
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, &a, "pending");
            piste(&c, 2, &b, "pending");
        }
        let arret = AtomicBool::new(false);
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            deplacer_vers(&corbeille),
            &[1, 2],
            &arret,
            |_| arret.store(true, Ordering::SeqCst),
        )
        .unwrap();
        assert!(res.stopped);
        assert_eq!(res.trashed, vec![1]);
        assert!(b.exists(), "la copie suivante n'est pas touchée");
        assert!(res.batch_id.is_some(), "ce qui est parti reste annulable");
    }

    /// Rien n'est parti : aucun lot, donc rien à offrir à Annuler.
    #[test]
    fn tout_echoue_ne_rend_aucun_lot() {
        let m = base();
        {
            let c = m.lock().unwrap();
            piste(&c, 1, Path::new("Z:/absent/A - B.mp3"), "pending");
        }
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            |_, _| Err("disque débranché".into()),
            &[1],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(res.batch_id, None);
        assert_eq!(res.failed.len(), 1);
        assert!(res.trashed.is_empty());
    }

    #[test]
    fn rien_a_envoyer_ne_cree_aucun_lot() {
        let m = base();
        let res = appliquer(
            || m.lock().map_err(|e| e.to_string()),
            |_, _| Err("jamais appelé".into()),
            &[],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(res.batch_id, None);
        assert!(res.trashed.is_empty() && res.failed.is_empty() && !res.stopped);
    }

    /// « Absente » ne se dit que si la source peut l'affirmer ; sinon la copie est « non vérifiée »,
    /// avec la raison que la confirmation affiche avant d'envoyer.
    #[test]
    fn absente_ne_se_dit_que_si_la_source_peut_l_affirmer() {
        let present = Presence::Present { playlists: 2 };
        let ouvert = Some(RekordboxDoubt::RekordboxOpen);
        for doute in [None, ouvert] {
            assert_eq!(
                usage_rekordbox(present, doute),
                RekordboxUse::Present { playlists: 2 }
            );
            assert_eq!(
                usage_rekordbox(Presence::Unknown, doute),
                RekordboxUse::Unknown
            );
        }
        assert_eq!(
            usage_rekordbox(Presence::Absent, None),
            RekordboxUse::Absent
        );
        assert_eq!(
            usage_rekordbox(Presence::Absent, ouvert),
            RekordboxUse::Unverified {
                reason: RekordboxDoubt::RekordboxOpen
            },
            "Rekordbox ouvert : l'absence n'est pas une affirmation"
        );
        assert_eq!(
            usage_rekordbox(Presence::Absent, Some(RekordboxDoubt::XmlSnapshot)),
            RekordboxUse::Unverified {
                reason: RekordboxDoubt::XmlSnapshot
            }
        );
    }

    #[test]
    fn seul_un_master_db_sans_journal_affirme_l_absence() {
        use crate::rekordbox_presence::MasterDbUnavailable;
        assert_eq!(
            doute_rekordbox(Some(&PresenceSource::MasterDb { wal_pending: false })),
            None
        );
        assert_eq!(
            doute_rekordbox(Some(&PresenceSource::MasterDb { wal_pending: true })),
            Some(RekordboxDoubt::RekordboxOpen),
            "Rekordbox ouvert : ses derniers imports ne sont pas encore dans master.db"
        );
        assert_eq!(
            doute_rekordbox(Some(&PresenceSource::LinkedXml {
                masterdb: MasterDbUnavailable::Missing
            })),
            Some(RekordboxDoubt::XmlSnapshot),
            "le XML lié est un instantané d'export"
        );
        assert_eq!(doute_rekordbox(None), None);
    }

    #[test]
    fn dup_apply_shapes_match_contracts_ts() {
        let DupApplyResult {
            batch_id,
            trashed,
            failed,
            stopped,
        } = DupApplyResult {
            batch_id: None,
            trashed: vec![],
            failed: vec![],
            stopped: false,
        };
        let DupApplyFailure { id, error } = DupApplyFailure {
            id: 1,
            error: String::new(),
        };
        let DupApplyProgress {
            done,
            total,
            id: pid,
        } = DupApplyProgress {
            done: 1,
            total: 1,
            id: 1,
        };
        let _ = (
            batch_id, trashed, failed, stopped, id, error, done, total, pid,
        );
    }

    #[test]
    fn apply_duplicate_plan_reste_hors_du_fil_de_la_fenetre() {
        let source = include_str!("ipc_doublons.rs");
        let debut = source
            .find("pub async fn apply_duplicate_plan(")
            .expect("`apply_duplicate_plan` doit rester `async`");
        let corps = &source[debut..];
        let fin = corps
            .find("fn appliquer_bloquant(")
            .expect("le corps synchrone doit suivre la commande");
        let commande = &corps[..fin];
        assert!(
            commande.contains("tauri::async_runtime::spawn_blocking("),
            "la commande ne délègue plus à `spawn_blocking` : N déplacements gèleraient l'interface"
        );
        assert!(commande.contains("appliquer_bloquant("));
        assert!(!commande.contains(".unwrap()") && !commande.contains(".expect("));
    }

    /// Même garde que `ipc::tests::analyze_path_reste_hors_du_fil_de_la_fenetre` : un test de
    /// SOURCE, solidaire de `cargo fmt --check` qui fige la forme des lignes cherchées.
    #[test]
    fn list_duplicate_groups_reste_hors_du_fil_de_la_fenetre() {
        let source = include_str!("ipc_doublons.rs");
        let debut = source
            .find("pub async fn list_duplicate_groups(")
            .expect("`list_duplicate_groups` doit rester `async`");
        let corps = &source[debut..];
        let fin = corps
            .find("fn lister_bloquant(")
            .expect("le corps synchrone doit suivre la commande");
        let commande = &corps[..fin];
        assert!(
            commande.contains("tauri::async_runtime::spawn_blocking("),
            "la commande ne délègue plus à `spawn_blocking` : lire la bibliothèque et ses \
             fichiers gèlerait l'interface"
        );
        assert!(
            commande.contains("lister_bloquant("),
            "la commande n'appelle plus le corps synchrone extrait"
        );
        assert!(
            !commande.contains(".unwrap()") && !commande.contains(".expect("),
            "interdiction dure du dépôt hors #[cfg(test)]"
        );
    }
}
