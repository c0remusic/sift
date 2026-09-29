//! Live folder watching. One debounced recursive watcher per source; its ~500 ms settle
//! window also coalesces the burst of events a file move produces (no explicit
//! stability polling — see the M1 design doc). On audio create/modify → upsert pending;
//! on delete → forget the pending row. Each batch emits `queue:changed`.
use crate::scanner;
use crate::sources::strip_verbatim;
use notify_debouncer_full::notify::RecommendedWatcher;
use notify_debouncer_full::{
    new_debouncer,
    notify::{EventKind, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

type Handle = Debouncer<RecommendedWatcher, RecommendedCache>;

/// Map of source_id → live debouncer. Stored in Tauri managed state so handles stay alive.
///
/// PRIVÉ depuis le 2026-09-15 : plus rien hors de ce module ne le construit ni ne le `manage`,
/// et c'est le compilateur qui le garantit désormais, là où un doc-comment le demandait.
#[derive(Default)]
struct Watchers(Mutex<HashMap<i64, Handle>>);

/// Starts (or restarts) watchers for every source currently in the DB.
///
/// Pose l'état vide elle-même. Un `init_state` public le faisait jusqu'au 2026-09-15, avec pour
/// interface la phrase « Call once in setup, before `start_all` » — un ordre d'appel à la charge
/// de l'appelant, que rien ne vérifiait. Le replier ici rend la séquence irreprésentable dans le
/// mauvais ordre : il n'y a plus qu'un geste.
pub fn start_all(app: &AppHandle) {
    app.manage(Watchers::default());
    let rows: Vec<(i64, String)> = {
        let state = app.state::<Mutex<Connection>>();
        // Un retour muet ici, c'est l'application qui démarre sans AUCUNE surveillance de dossier :
        // rien ne réapparaît dans la file, et rien ne dit pourquoi.
        let conn = match state.lock() {
            Ok(c) => c,
            Err(e) => {
                log::error!(
                    "watcher start_all: verrou DB empoisonné, aucune source surveillée: {e}"
                );
                return;
            }
        };
        let mut stmt = match conn.prepare("SELECT id, path FROM sources WHERE watched=1") {
            Ok(s) => s,
            Err(e) => {
                log::error!("watcher start_all: préparation de la requête sources échouée: {e}");
                return;
            }
        };
        let rows = match stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) {
            Ok(r) => r,
            Err(e) => {
                log::error!("watcher start_all: lecture des sources échouée: {e}");
                return;
            }
        };
        rows.filter_map(|r| r.ok()).collect()
    };
    for (id, path) in rows {
        start(app, id, &path);
    }
}

/// Starts a recursive debounced watcher on `path` for `source_id`. Replaces any existing one.
pub fn start(app: &AppHandle, source_id: i64, path: &str) {
    let path = strip_verbatim(path);
    let path = path.as_str();
    if !std::path::Path::new(path).is_dir() {
        log::warn!("watch skipped, not a dir: {path}");
        return;
    }
    let app2 = app.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(500),
        None,
        move |res: DebounceEventResult| handle_events(&app2, source_id, res),
    );
    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => {
            log::error!("debouncer init failed for {path}: {e}");
            return;
        }
    };
    if let Err(e) = debouncer.watch(std::path::Path::new(path), RecursiveMode::Recursive) {
        log::error!("watch failed for {path}: {e}");
        return;
    }
    log::info!("watching source {source_id} at {path}");
    {
        let watchers = app.state::<Watchers>();
        if let Ok(mut map) = watchers.0.lock() {
            map.insert(source_id, debouncer);
        };
    }
}

/// Stops and drops the watcher for `source_id`, if any.
pub fn stop(app: &AppHandle, source_id: i64) {
    {
        let watchers = app.state::<Watchers>();
        if let Ok(mut map) = watchers.0.lock() {
            map.remove(&source_id);
        };
    }
}

/// Applies a debounced batch of FS events to the DB, then notifies the front.
fn handle_events(app: &AppHandle, source_id: i64, res: DebounceEventResult) {
    let events = match res {
        Ok(ev) => ev,
        Err(errs) => {
            for e in errs {
                log::warn!("watch error: {e}");
            }
            return;
        }
    };
    log::info!(
        "watch batch: {} event(s) for source {source_id}",
        events.len()
    );
    let state = app.state::<Mutex<Connection>>();
    // Le lot d'événements vient d'être annoncé par le `log::info!` ci-dessus : sortir sans un mot
    // ferait croire qu'il a été traité.
    let conn = match state.lock() {
        Ok(c) => c,
        Err(e) => {
            log::error!(
                "watch batch: verrou DB empoisonné, lot de la source {source_id} perdu: {e}"
            );
            return;
        }
    };
    let touched = apply_events(&conn, source_id, events.iter().map(|e| &e.event));
    drop(conn);
    if touched {
        app.emit("queue:changed", ()).ok();
        crate::worker::refill(app);
    }
}

/// Applique à la base un lot d'événements décantés. Rend vrai si une ligne a changé. Séparée de
/// `handle_events` pour être tenue par des tests sur une base en mémoire, sans `AppHandle`.
///
/// Deux gardes, et elles ne se recouvrent pas :
///
/// - **Rangement en vol (#78).** Un chemin que tient un rangement de Sift — sa source, sa
///   destination — n'est pas touché. En Lot, toutes les phases 2 passent avant le premier commit :
///   la source mise à la corbeille émettait un `Remove`, et `forget_path` effaçait la piste encore
///   `pending`, identification comprise (CASCADE), avant que son commit n'échoue sur la clé
///   étrangère. Même fenêtre pour un `Modify` (tags écrits en place), qui remettait l'analyse à zéro.
/// - **`Remove` périmé (#77).** Le lot arrive ~500 ms après les faits : un fichier peut être revenu
///   à son nom depuis — annulation d'une conversion qui a remplacé sa source, rollback. Mesuré le
///   2026-09-29 sous Windows : un renommage qui remplace émet `Deleted X` puis `Renamed X`. Le nom
///   se relit donc sur le disque, À L'OCTET (`scanner::DirListings`, une lecture par dossier et par lot) : `Path::exists` répond
///   vrai pour une autre casse, alors que `tracks.path` se compare à l'octet.
fn apply_events<'a>(
    conn: &Connection,
    source_id: i64,
    events: impl IntoIterator<Item = &'a notify_debouncer_full::notify::Event>,
) -> bool {
    let mut touched = false;
    let mut listings = scanner::DirListings::default();
    for ev in events {
        for path in &ev.paths {
            // Une piste n'existe que pour un fichier audio : le reste (pochette, .asd, dossier) ne
            // touche aucune ligne, et ne paie ni le registre ni la lecture de son dossier.
            if !scanner::is_audio(path) {
                continue;
            }
            let p = path.to_string_lossy();
            if crate::ipc_filing::is_path_in_flight(&p) {
                continue;
            }
            match ev.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    // Au nom EXACT : un renommage de casse porte l'ancien nom et le nouveau, et
                    // `is_file()` répond vrai pour l'ancien (casse ignorée) — `upsert_file`
                    // l'insérait alors comme une seconde piste pour le même fichier.
                    if path.is_file() && listings.exists_exactly(path) {
                        if let Ok(meta) = path.metadata() {
                            let f = scanner::DiskFile {
                                path: p.into_owned(),
                                filename: path
                                    .file_name()
                                    .map(|n| n.to_string_lossy().into_owned())
                                    .unwrap_or_default(),
                                size_bytes: meta.len() as i64,
                                // `scanner::mtime_secs` et pas une conversion locale : son propre
                                // commentaire interdit un second convertisseur, parce qu'il
                                // dériverait en silence et rouvrirait le bug « une piste rangée se
                                // dé-range toute seule ». Une copie mot pour mot vivait pourtant
                                // ici jusqu'au 2026-09-15.
                                mtime: scanner::mtime_secs(&meta),
                            };
                            if scanner::upsert_file(conn, source_id, &f).is_ok() {
                                touched = true;
                            }
                        }
                    }
                }
                EventKind::Remove(_) => {
                    if listings.exists_exactly(path) {
                        continue;
                    }
                    if let Ok(n) = scanner::forget_path(conn, &p) {
                        if n > 0 {
                            touched = true;
                        }
                    }
                }
                _ => {}
            }
        }
    }
    touched
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{ModifyKind, RemoveKind};
    use notify_debouncer_full::notify::Event;

    fn db() -> (Connection, i64) {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO sources (path) VALUES ('root')", [])
            .unwrap();
        let sid = conn.last_insert_rowid();
        (conn, sid)
    }

    fn pending(conn: &Connection, path: &str) -> i64 {
        conn.execute(
            "INSERT INTO tracks(path, status, size_bytes, mtime) VALUES(?1, 'pending', 1, 1)",
            [path],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn count(conn: &Connection, path: &str) -> i64 {
        conn.query_row("SELECT count(*) FROM tracks WHERE path=?1", [path], |r| {
            r.get(0)
        })
        .unwrap()
    }

    fn remove(path: &std::path::Path) -> Event {
        Event::new(EventKind::Remove(RemoveKind::Any)).add_path(path.to_path_buf())
    }

    /// #78 : la source d'un rangement en vol, disparue de son nom, garde sa ligne — le commit
    /// qui suit la repointera. Rendu, un `Remove` sur un fichier réellement absent l'oublie.
    #[test]
    fn un_remove_sur_une_source_en_vol_ne_supprime_pas_la_piste() {
        let (conn, sid) = db();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("X.flac");
        let s = src.to_str().unwrap();
        pending(&conn, s);
        let dest = dir.path().join("X.aiff");
        crate::ipc_filing::test_hold(-7802, s, dest.to_str().unwrap(), || {
            assert!(!apply_events(&conn, sid, [&remove(&src)]));
        });
        assert_eq!(count(&conn, s), 1, "tenue : gardée");
        assert!(apply_events(&conn, sid, [&remove(&src)]));
        assert_eq!(count(&conn, s), 0, "rendue et absente : oubliée");
    }

    /// #78 : une écriture sur un chemin en vol (tags écrits en place) ne remet pas l'analyse à zéro.
    #[test]
    fn un_modify_sur_un_chemin_en_vol_ne_touche_pas_la_ligne() {
        let (conn, sid) = db();
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("Y.aiff");
        std::fs::write(&src, b"autres octets").unwrap();
        let s = src.to_str().unwrap();
        let id = pending(&conn, s);
        conn.execute("UPDATE tracks SET report_json='{}' WHERE id=?1", [id])
            .unwrap();
        let modify = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(src.clone());
        crate::ipc_filing::test_hold(-7803, s, "C:/nowhere/y-dest.aiff", || {
            apply_events(&conn, sid, [&modify]);
        });
        let report: Option<String> = conn
            .query_row("SELECT report_json FROM tracks WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(report.as_deref(), Some("{}"), "analyse intacte");
    }

    /// Un renommage de casse porte l'ancien nom et le nouveau. L'ancien, que `is_file()` trouve
    /// encore sur un système de fichiers qui ignore la casse, ne devient pas une seconde piste.
    #[test]
    fn l_ancien_nom_d_un_renommage_de_casse_ne_devient_pas_une_piste() {
        let (conn, sid) = db();
        let dir = tempfile::tempdir().unwrap();
        let nouveau = dir.path().join("Larry Heard.aiff");
        std::fs::write(&nouveau, b"audio").unwrap();
        let ancien = dir.path().join("larry heard.aiff");
        let rename = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(ancien.clone())
            .add_path(nouveau.clone());
        apply_events(&conn, sid, [&rename]);
        assert_eq!(
            count(&conn, ancien.to_str().unwrap()),
            0,
            "pas de piste fantôme"
        );
        assert_eq!(count(&conn, nouveau.to_str().unwrap()), 1);
    }

    /// #77 : un `Remove` traité alors que le fichier est revenu à son nom EXACT n'oublie pas la
    /// piste. Revenu sous une autre casse, il l'oublie : `tracks.path` se compare à l'octet.
    #[test]
    fn un_remove_perime_n_oublie_une_piste_que_si_son_nom_exact_manque() {
        let (conn, sid) = db();
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Z.aiff");
        std::fs::write(&p, b"audio").unwrap();
        let s = p.to_str().unwrap();
        pending(&conn, s);
        assert!(!apply_events(&conn, sid, [&remove(&p)]));
        assert_eq!(count(&conn, s), 1, "fichier revenu : gardée");

        let autre_casse = dir.path().join("z.aiff");
        let a = autre_casse.to_str().unwrap();
        pending(&conn, a);
        apply_events(&conn, sid, [&remove(&autre_casse)]);
        assert_eq!(count(&conn, a), 0, "nom exact absent : oubliée");
    }
}
