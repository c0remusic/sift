//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::library::{self, LibraryFacets, LibraryFilter, LibraryTrack};
use crate::metadata::{self, MetadataEdit};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Filed tracks joined to metadata + genres, filtered (folder / quality / genre / q).
#[tauri::command]
pub fn list_library(
    conn: State<'_, Mutex<Connection>>,
    filter: Option<LibraryFilter>,
) -> Result<Vec<LibraryTrack>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::list_filed(&conn, &filter.unwrap_or_default()).map_err(|e| e.to_string())
}

/// Folder + genre facet counts for the sidebar.
#[tauri::command]
pub fn library_folders(conn: State<'_, Mutex<Connection>>) -> Result<LibraryFacets, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::folder_facets(&conn).map_err(|e| e.to_string())
}

/// Edit a filed track's metadata: writes the file tags first, then updates the DB.
/// If the file write fails the DB is left untouched (no partial state).
#[tauri::command]
pub fn update_metadata(
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
    edit: MetadataEdit,
) -> Result<(), String> {
    // (1) Look up the track path — error immediately if unknown.
    let path: String = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT path FROM tracks WHERE id=?1",
            rusqlite::params![track_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("track {track_id} not found"))?
    };

    // (2) Write the file tags. Lock is released before this call; if it fails we stop here and
    // the DB is untouched.
    crate::tagging::write_tags_full(
        &path,
        &edit.artist,
        &edit.title,
        edit.label.as_deref(),
        edit.year,
        &edit.genres,
        edit.cover_path.as_deref(),
    )?;

    // (3) Persist to the DB only after the file write succeeded.
    let conn = conn.lock().map_err(|e| e.to_string())?;
    metadata::update_metadata_db(&conn, track_id, &edit).map_err(|e| e.to_string())
}

/// Group `filed` tracks by acoustic fingerprint into duplicate clusters, each with a
/// recommended keeper. Read-only — resolving a group is a plain `trash_track` per loser.
#[tauri::command]
pub fn scan_library_duplicates(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<crate::dedup::DupGroup>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::dedup::scan_library_duplicates(&conn).map_err(|e| e.to_string())
}

/// Dashboard aggregate stats for the Bibliothèque (totals, lossless/mp3 split, duplicates,
/// tracks to re-source, genre breakdown).
#[tauri::command]
pub fn library_stats(conn: State<'_, Mutex<Connection>>) -> Result<library::DashboardStats, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::library_stats(&conn).map_err(|e| e.to_string())
}

// ── M7 Rekordbox XML export + playlist path repair ──────────────────────────

/// Status of the linked Rekordbox XML — surfaced to the Bibliothèque dashboard card.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RekordboxLinkStatus {
    pub path: Option<String>,
    pub linked: bool,
    pub playlist_count: usize,
    pub track_count: usize,
    /// Set (linked=false is NOT implied) when the linked file is unreadable/corrupt at last
    /// check — the card shows this and blocks further auto-repair until the user re-links.
    pub error: Option<String>,
    /// FIX-7: true when a prior filing/move's Rekordbox repair hit an AMBIGUOUS `patch_location`
    /// match (`settings::REKORDBOX_XML_DRIFT` — see `actions::repair_rekordbox_xml_if_linked`) —
    /// the linked XML's raw text no longer matches what Sift's DB expects for some track, and the
    /// repair could not safely proceed. Previously only visible in the server log. Cleared by a
    /// fresh `link_rekordbox_xml` or the next successful repair.
    pub drift_detected: bool,
}

/// Read the persisted drift flag (see `settings::REKORDBOX_XML_DRIFT`) for building a
/// `RekordboxLinkStatus`. Absent/unset or any value other than "1" = no known drift.
fn drift_detected(conn: &Connection) -> bool {
    crate::settings::get(conn, crate::settings::REKORDBOX_XML_DRIFT)
        .ok()
        .flatten()
        .as_deref()
        == Some("1")
}

fn count_playlists(nodes: &[crate::rekordbox_xml::PlaylistNode]) -> usize {
    nodes
        .iter()
        .map(|n| match n {
            crate::rekordbox_xml::PlaylistNode::Playlist { .. } => 1,
            crate::rekordbox_xml::PlaylistNode::Folder { children, .. } => count_playlists(children),
        })
        .sum()
}

/// Plain (testable without a `State`) implementation of `link_rekordbox_xml`: parse+validate
/// `path` as a Rekordbox XML and, on success, persist it as the linked file via `conn`. Fails
/// fast (nothing persisted) if the file can't be read or parsed.
fn link_rekordbox_xml_inner(conn: &Connection, path: &str) -> Result<RekordboxLinkStatus, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("lecture impossible: {e}"))?;
    let parsed = crate::rekordbox_xml::parse(&bytes)?;
    crate::settings::set(conn, crate::settings::REKORDBOX_XML_PATH, path).map_err(|e| e.to_string())?;
    // FIX-7: (re-)linking is the user's explicit "I've dealt with it" signal — clear any drift
    // flagged against the PREVIOUSLY linked file so a stale warning doesn't linger forever.
    crate::settings::set(conn, crate::settings::REKORDBOX_XML_DRIFT, "0").map_err(|e| e.to_string())?;
    Ok(RekordboxLinkStatus {
        path: Some(path.to_string()),
        linked: true,
        playlist_count: count_playlists(&parsed.playlists),
        track_count: parsed.collection.len(),
        error: None,
        drift_detected: false,
    })
}

/// Parse+validate `path` as a Rekordbox XML and, on success, persist it as the linked file.
/// Fails fast (path NOT persisted) if the file can't be read or parsed — no silent partial link.
#[tauri::command]
pub fn link_rekordbox_xml(
    conn: State<'_, Mutex<Connection>>,
    path: String,
) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    link_rekordbox_xml_inner(&conn, &path)
}

/// Plain (testable) implementation of `rekordbox_status`.
fn rekordbox_status_inner(conn: &Connection) -> Result<RekordboxLinkStatus, String> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(RekordboxLinkStatus {
            path: None,
            linked: false,
            playlist_count: 0,
            track_count: 0,
            error: None,
            drift_detected: false,
        });
    };
    let drift = drift_detected(conn);
    match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| crate::rekordbox_xml::parse(&b)) {
        Ok(parsed) => Ok(RekordboxLinkStatus {
            path: Some(path),
            linked: true,
            playlist_count: count_playlists(&parsed.playlists),
            track_count: parsed.collection.len(),
            error: None,
            drift_detected: drift,
        }),
        Err(e) => Ok(RekordboxLinkStatus {
            path: Some(path),
            linked: true,
            playlist_count: 0,
            track_count: 0,
            error: Some(e),
            drift_detected: drift,
        }),
    }
}

/// Current link status: re-reads the linked file (if any) fresh from disk. If a path is
/// persisted but the file is now unreadable/corrupt, reports `linked:true, error:Some(..)` —
/// the setting is NOT cleared automatically (the spec: block auto-rewrite, don't lose the
/// reference silently; the user must explicitly re-link).
#[tauri::command]
pub fn rekordbox_status(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_status_inner(&conn)
}

/// Plain (testable) implementation of `export_rekordbox_xml`.
fn export_rekordbox_xml_inner(conn: &Connection) -> Result<RekordboxLinkStatus, String> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant d'exporter")?;
    let filed = library::list_filed(conn, &LibraryFilter::default()).map_err(|e| e.to_string())?;

    let bytes = std::fs::read(&path).map_err(|e| format!("XML Rekordbox illisible: {e}"))?;
    let mut parsed = crate::rekordbox_xml::parse(&bytes)?;
    crate::rekordbox_xml::merge_filed_tracks(&mut parsed, &filed);
    let out = crate::rekordbox_xml::write(&parsed);
    std::fs::write(&path, &out).map_err(|e| format!("écriture impossible: {e}"))?;
    Ok(RekordboxLinkStatus {
        path: Some(path),
        linked: true,
        playlist_count: count_playlists(&parsed.playlists),
        track_count: parsed.collection.len(),
        error: None,
        drift_detected: drift_detected(conn),
    })
}

/// Reload the linked XML, merge every `filed` track absent from it, rewrite the file. Fails fast
/// (no write attempted) if no XML is linked, or if the linked file is unreadable/corrupt — no
/// silent recreation of an empty tree, matching the spec's fail-fast requirement.
#[tauri::command]
pub fn export_rekordbox_xml(conn: State<'_, Mutex<Connection>>) -> Result<RekordboxLinkStatus, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    export_rekordbox_xml_inner(&conn)
}

// ── M8 Tier 1: master.db path-repair candidates ──────────────────────────────

/// One candidate `master.db` path repair, detected read-only on filing
/// (`actions::detect_masterdb_repair_if_linked`) and surfaced for manual, batch-confirmed
/// application. Never applied automatically.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingMasterdbRepair {
    pub id: i64,
    /// `djmdContent.ID` — `None` when `status == "ambiguous"`.
    pub track_id: Option<String>,
    /// Comma-joined candidate `djmdContent.ID`s — set only when `status == "ambiguous"`.
    pub candidate_track_ids: Option<String>,
    /// Each candidate's current `master.db` path, resolved fresh at query time so the user can
    /// tell them apart. `None` when `status != "ambiguous"`, or when `master.db`/the linked XML
    /// couldn't be read at all (degrades gracefully — the row itself still lists, just without
    /// enrichment; never fails the whole `pending_repairs` call for this reason alone).
    pub candidate_tracks: Option<Vec<CandidateTrack>>,
    pub from_path: String,
    pub to_path: String,
    /// "pending" | "ambiguous".
    pub status: String,
    pub detected_at: String,
}

/// One ambiguous-repair candidate, enriched with its current `master.db` path for display.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CandidateTrack {
    pub track_id: String,
    /// `None` if this `track_id` no longer exists in `master.db` (library changed since detection).
    pub folder_path: Option<String>,
}

/// Result of attempting to apply one pending repair.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApplyRepairOutcome {
    pub id: i64,
    pub ok: bool,
    /// Humanized message on failure; `None` on success.
    pub error: Option<String>,
}

fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(path)
        .to_string()
}

fn humanize_masterdb_error(e: &crate::rekordbox_masterdb::MasterDbError) -> String {
    use crate::rekordbox_masterdb::MasterDbError;
    match e {
        MasterDbError::RekordboxRunning => "Rekordbox est ouvert — ferme-le avant de synchroniser".to_string(),
        MasterDbError::RegistryRowMissing => "structure de master.db inattendue — synchronisation impossible".to_string(),
        MasterDbError::TrackNotFound { track_id } => format!(
            "piste {track_id} introuvable dans master.db — la bibliothèque Rekordbox a peut-être changé depuis la détection"
        ),
        MasterDbError::WriteVerificationFailedRolledBack(m) => {
            format!("l'écriture a échoué à la vérification, la sauvegarde a été restaurée automatiquement : {m}")
        }
        MasterDbError::WriteVerificationFailedRollbackFailed(m) => format!(
            "l'écriture ET la restauration de la sauvegarde ont échoué — intervention manuelle nécessaire : {m}"
        ),
        other => other.to_string(),
    }
}

/// Resolves `pioneer_dir` from the linked XML and reads `master.db` once, returning a
/// `track_id -> folder_path` map. `None` if no XML is linked or `master.db` can't be read —
/// callers must degrade gracefully, never treat this as a hard error.
fn read_masterdb_path_map(conn: &Connection) -> Option<std::collections::HashMap<String, String>> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).ok().flatten()?;
    let pioneer_dir = std::path::Path::new(&xml_path).parent()?;
    let index = crate::rekordbox_masterdb::read_rekordbox_masterdb(&pioneer_dir.join("master.db")).ok()?;
    Some(index.tracks.into_iter().map(|t| (t.track_id, t.folder_path)).collect())
}

/// Plain (testable) implementation of `rekordbox_masterdb_pending_repairs`.
fn rekordbox_masterdb_pending_repairs_inner(conn: &Connection) -> Result<Vec<PendingMasterdbRepair>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, track_id, candidate_track_ids, from_path, to_path, status, detected_at
             FROM rekordbox_masterdb_repairs
             WHERE status IN ('pending', 'ambiguous')
             ORDER BY detected_at",
        )
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<PendingMasterdbRepair> = stmt
        .query_map([], |r| {
            Ok(PendingMasterdbRepair {
                id: r.get(0)?,
                track_id: r.get(1)?,
                candidate_track_ids: r.get(2)?,
                candidate_tracks: None,
                from_path: r.get(3)?,
                to_path: r.get(4)?,
                status: r.get(5)?,
                detected_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Resolve master.db exactly once for the whole batch, not once per ambiguous row.
    if rows.iter().any(|r| r.status == "ambiguous") {
        if let Some(path_map) = read_masterdb_path_map(conn) {
            for row in rows.iter_mut().filter(|r| r.status == "ambiguous") {
                if let Some(ids) = &row.candidate_track_ids {
                    row.candidate_tracks = Some(
                        ids.split(',')
                            .map(|id| CandidateTrack {
                                track_id: id.to_string(),
                                folder_path: path_map.get(id).cloned(),
                            })
                            .collect(),
                    );
                }
            }
        }
    }
    Ok(rows)
}

/// Candidate `master.db` path repairs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_repairs(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PendingMasterdbRepair>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_pending_repairs_inner(&conn)
}

/// Plain (testable) implementation of `rekordbox_masterdb_dismiss_repair`.
fn rekordbox_masterdb_dismiss_repair_inner(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE rekordbox_masterdb_repairs SET status='dismissed' WHERE id=?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a pending/ambiguous repair as dismissed — it stops appearing in `pending_repairs`.
/// Never applies anything.
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_repair(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_dismiss_repair_inner(&conn, id)
}

/// Attempts one repair row. Never calls `repair_track_path` for a row that isn't `pending`
/// with a known `track_id`, or whose `to_path` no longer exists on disk.
fn apply_one_repair(
    conn: &Connection,
    pioneer_dir: &Path,
    backup_root: &Path,
    batch_stamp: &str,
    id: i64,
) -> ApplyRepairOutcome {
    let row = conn.query_row(
        "SELECT track_id, to_path, status FROM rekordbox_masterdb_repairs WHERE id=?1",
        rusqlite::params![id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        },
    );
    let (track_id, to_path, status) = match row {
        Ok(v) => v,
        Err(e) => return ApplyRepairOutcome { id, ok: false, error: Some(e.to_string()) },
    };

    let Some(track_id) = track_id.filter(|_| status == "pending") else {
        return ApplyRepairOutcome {
            id,
            ok: false,
            error: Some("piste ambiguë ou déjà traitée — résolution manuelle requise".to_string()),
        };
    };

    if !std::path::Path::new(&to_path).exists() {
        return ApplyRepairOutcome {
            id,
            ok: false,
            error: Some(
                "le fichier n'existe plus à l'emplacement attendu — la piste a peut-être été déplacée ou annulée depuis"
                    .to_string(),
            ),
        };
    }

    let file_name = basename(&to_path);
    let repair = crate::rekordbox_masterdb::PathRepair {
        track_id,
        new_folder_path: to_path,
        new_file_name_l: file_name.clone(),
        new_file_name_s: file_name,
    };
    let backup_dir = backup_root.join(batch_stamp).join(id.to_string());

    match crate::rekordbox_masterdb::repair_track_path(pioneer_dir, &backup_dir, &repair) {
        Ok(()) => {
            if let Err(e) = conn.execute(
                "UPDATE rekordbox_masterdb_repairs SET status='applied', applied_at=datetime('now') WHERE id=?1",
                rusqlite::params![id],
            ) {
                return ApplyRepairOutcome { id, ok: false, error: Some(e.to_string()) };
            }
            ApplyRepairOutcome { id, ok: true, error: None }
        }
        Err(e) => ApplyRepairOutcome { id, ok: false, error: Some(humanize_masterdb_error(&e)) },
    }
}

/// Plain (testable) implementation of `rekordbox_masterdb_apply_repairs`. `backup_root` is the
/// caller-resolved base directory for backups (production: `app_data_dir()/rekordbox-backups`)
/// — kept as a parameter so this stays testable without a Tauri runtime.
fn rekordbox_masterdb_apply_repairs_inner(
    conn: &Connection,
    backup_root: &Path,
    ids: &[i64],
) -> Result<Vec<ApplyRepairOutcome>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;

    // One timestamp per BATCH (not per row) — two rows in the same call must land under the
    // same batch directory, each still isolated by its own <id> subdirectory below it.
    let batch_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();

    let mut outcomes = Vec::with_capacity(ids.len());
    for &id in ids {
        outcomes.push(apply_one_repair(conn, pioneer_dir, backup_root, &batch_stamp, id));
    }
    Ok(outcomes)
}

/// Applies the given pending/ambiguous repair `id`s against the linked Rekordbox's `master.db`,
/// one at a time (never in parallel — one `master.db`). Never invoked automatically — this is
/// the explicit, user-confirmed write step. A failure on one `id` does not stop the rest of the
/// batch. Backups land under `app_data_dir()/rekordbox-backups/<batch timestamp>/<id>/`, one
/// subdirectory per row so a later row's backup in the same batch never overwrites an earlier
/// row's.
#[tauri::command]
pub fn rekordbox_masterdb_apply_repairs(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    ids: Vec<i64>,
) -> Result<Vec<ApplyRepairOutcome>, String> {
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &ids)
}

#[cfg(test)]
mod rekordbox_tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&c).unwrap();
        c
    }

    #[test]
    fn link_rekordbox_xml_persists_path_on_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        let status = link_rekordbox_xml_inner(&conn, xml_path.to_str().unwrap()).unwrap();
        assert!(status.linked);
        assert_eq!(status.track_count, 3);
        assert!(status.error.is_none());
        assert_eq!(
            crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH).unwrap(),
            Some(xml_path.to_str().unwrap().to_string())
        );
    }

    #[test]
    fn link_rekordbox_xml_reports_error_on_corrupt_file_and_does_not_persist() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("bad.xml");
        std::fs::write(&xml_path, b"<not-even-xml").unwrap();
        let conn = db();
        let result = link_rekordbox_xml_inner(&conn, xml_path.to_str().unwrap());
        assert!(result.is_err(), "corrupt XML must be rejected, not silently linked");
        let saved = crate::settings::get(&conn, crate::settings::REKORDBOX_XML_PATH).unwrap();
        assert_eq!(saved, None, "no path persisted on a failed link");
    }

    #[test]
    fn rekordbox_status_reports_unlinked_when_no_setting() {
        let conn = db();
        let status = rekordbox_status_inner(&conn).unwrap();
        assert!(!status.linked);
        assert_eq!(status.path, None);
    }

    #[test]
    fn export_rekordbox_xml_fails_fast_when_nothing_linked() {
        let conn = db();
        let result = export_rekordbox_xml_inner(&conn);
        assert!(result.is_err(), "export with no linked XML must fail, not create one silently");
    }

    #[test]
    fn export_rekordbox_xml_merges_filed_tracks_and_rewrites_file() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status, folder) VALUES('C:/Music/Disco/new.mp3', 'filed', 'Disco')",
            [],
        )
        .unwrap();

        let status = export_rekordbox_xml_inner(&conn).unwrap();
        assert_eq!(status.track_count, 4, "3 original + 1 newly filed");

        let rewritten = std::fs::read_to_string(&xml_path).unwrap();
        assert!(rewritten.contains("Disco/new.mp3") || rewritten.contains("Disco%2Fnew.mp3"));
    }

    /// FIX-7 regression: `RekordboxLinkStatus.drift_detected` reflects the persisted
    /// `settings::REKORDBOX_XML_DRIFT` flag — false by default, true once set (as
    /// `actions::repair_rekordbox_xml_if_linked` would on an ambiguous `patch_location` match).
    #[test]
    fn rekordbox_status_reports_drift_detected_flag() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let status = rekordbox_status_inner(&conn).unwrap();
        assert!(!status.drift_detected, "no drift by default");

        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_DRIFT, "1").unwrap();
        let status = rekordbox_status_inner(&conn).unwrap();
        assert!(status.drift_detected, "drift flag surfaced once set");
    }

    /// FIX-7 regression: re-linking (the user's explicit "I've dealt with it" signal) clears a
    /// previously-set drift flag.
    #[test]
    fn link_rekordbox_xml_clears_a_previously_set_drift_flag() {
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        let conn = db();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_DRIFT, "1").unwrap();

        let status = link_rekordbox_xml_inner(&conn, xml_path.to_str().unwrap()).unwrap();
        assert!(!status.drift_detected, "re-linking clears prior drift");
        assert!(!rekordbox_status_inner(&conn).unwrap().drift_detected);
    }

    fn seed_pioneer_dir(dir: &std::path::Path) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::copy(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"),
            dir.join("master.db"),
        )
        .unwrap();
        let xml_path = dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        xml_path
    }

    fn seed_repair_row(
        conn: &Connection,
        from_path: &str,
        to_path: &str,
        track_id: Option<&str>,
        status: &str,
    ) -> i64 {
        conn.execute(
            "INSERT INTO actions(type, from_path, to_path) VALUES('move', ?1, ?2)",
            rusqlite::params![from_path, to_path],
        )
        .unwrap();
        let action_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO rekordbox_masterdb_repairs (action_id, track_id, from_path, to_path, status)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![action_id, track_id, from_path, to_path, status],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn pending_repairs_excludes_applied_and_dismissed() {
        let conn = db();
        seed_repair_row(&conn, "a", "a2", Some("1"), "pending");
        seed_repair_row(&conn, "b", "b2", None, "ambiguous");
        seed_repair_row(&conn, "c", "c2", Some("3"), "applied");
        seed_repair_row(&conn, "d", "d2", Some("4"), "dismissed");

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        let statuses: Vec<&str> = rows.iter().map(|r| r.status.as_str()).collect();
        assert_eq!(statuses.len(), 2);
        assert!(statuses.contains(&"pending"));
        assert!(statuses.contains(&"ambiguous"));
    }

    #[test]
    fn dismiss_repair_hides_it_from_pending_list() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", Some("1"), "pending");
        rekordbox_masterdb_dismiss_repair_inner(&conn, id).unwrap();
        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn apply_repairs_applies_a_pending_row() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let new_path = tmp.path().join("track1.flac");
        std::fs::write(&new_path, b"fake audio").unwrap();
        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", new_path.to_str().unwrap(), Some("40000001"), "pending");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].ok, "expected success, got {:?}", outcomes[0].error);

        let (status, applied_at): (String, Option<String>) = conn
            .query_row(
                "SELECT status, applied_at FROM rekordbox_masterdb_repairs WHERE id=?1",
                rusqlite::params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "applied");
        assert!(applied_at.is_some());
    }

    #[test]
    fn apply_repairs_two_rows_get_isolated_per_row_backups() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let new_path_1 = tmp.path().join("track1.flac");
        std::fs::write(&new_path_1, b"fake audio 1").unwrap();
        let new_path_2 = tmp.path().join("track2.flac");
        std::fs::write(&new_path_2, b"fake audio 2").unwrap();
        let id1 = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", new_path_1.to_str().unwrap(), Some("40000001"), "pending");
        let id2 = seed_repair_row(&conn, "D:/FIXTURE/track2.flac", new_path_2.to_str().unwrap(), Some("40000002"), "pending");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id1, id2]).unwrap();
        assert!(outcomes[0].ok, "row 1: {:?}", outcomes[0].error);
        assert!(outcomes[1].ok, "row 2: {:?}", outcomes[1].error);

        let batch_dirs: Vec<_> = std::fs::read_dir(&backup_root).unwrap().collect();
        assert_eq!(batch_dirs.len(), 1, "both rows share one batch timestamp directory");
        let batch_dir = batch_dirs[0].as_ref().unwrap().path();
        assert!(batch_dir.join(id1.to_string()).join("master.db").exists());
        assert!(batch_dir.join(id2.to_string()).join("master.db").exists());
    }

    #[test]
    fn apply_repairs_continues_after_one_row_fails() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let new_path = tmp.path().join("track1.flac");
        std::fs::write(&new_path, b"fake audio").unwrap();
        let id_ok = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", new_path.to_str().unwrap(), Some("40000001"), "pending");
        // track_id "99999999" doesn't exist in the fixture — simulates master.db having
        // changed since detection.
        let id_missing_track = seed_repair_row(&conn, "D:/nope.mp3", new_path.to_str().unwrap(), Some("99999999"), "pending");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id_ok, id_missing_track]).unwrap();
        assert!(outcomes[0].ok, "row 1 should succeed: {:?}", outcomes[0].error);
        assert!(!outcomes[1].ok, "row 2 should fail");
        assert!(outcomes[1].error.is_some());

        let status_ok: String = conn
            .query_row("SELECT status FROM rekordbox_masterdb_repairs WHERE id=?1", rusqlite::params![id_ok], |r| r.get(0))
            .unwrap();
        assert_eq!(status_ok, "applied");
        let status_failed: String = conn
            .query_row("SELECT status FROM rekordbox_masterdb_repairs WHERE id=?1", rusqlite::params![id_missing_track], |r| r.get(0))
            .unwrap();
        assert_eq!(status_failed, "pending", "failed row stays pending, retryable");
    }

    #[test]
    fn apply_repairs_skips_ambiguous_row_without_calling_repair_track_path() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let before = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", None, "ambiguous");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id]).unwrap();
        assert!(!outcomes[0].ok);
        assert_eq!(outcomes[0].error.as_deref(), Some("piste ambiguë ou déjà traitée — résolution manuelle requise"));

        // master.db must be byte-identical — repair_track_path was never called.
        let after = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        assert_eq!(before, after);
        assert!(!backup_root.exists(), "no backup should have been created either");
    }

    #[test]
    fn apply_repairs_fails_fast_when_target_file_missing() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let before = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        // to_path deliberately points at a file that doesn't exist on disk.
        let missing_path = tmp.path().join("never-created.flac");
        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", missing_path.to_str().unwrap(), Some("40000001"), "pending");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id]).unwrap();
        assert!(!outcomes[0].ok);
        assert_eq!(
            outcomes[0].error.as_deref(),
            Some("le fichier n'existe plus à l'emplacement attendu — la piste a peut-être été déplacée ou annulée depuis")
        );

        let after = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn apply_repairs_fails_all_when_no_xml_linked() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", Some("1"), "pending");
        let backup_root = tempfile::tempdir().unwrap().path().join("backups");
        let err = rekordbox_masterdb_apply_repairs_inner(&conn, &backup_root, &[id]).unwrap_err();
        assert_eq!(err, "aucun XML Rekordbox lié — relie un fichier avant de synchroniser");
    }

    #[test]
    fn pending_repairs_enriches_ambiguous_candidates_with_paths() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let index = crate::rekordbox_masterdb::read_rekordbox_masterdb(&pioneer_dir.join("master.db")).unwrap();
        let expected: std::collections::HashMap<String, String> =
            index.tracks.into_iter().map(|t| (t.track_id, t.folder_path)).collect();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        let row = rows.iter().find(|r| r.id == id).unwrap();
        let candidates = row.candidate_tracks.as_ref().expect("candidate_tracks populated");
        assert_eq!(candidates.len(), 2);
        for c in candidates {
            assert_eq!(
                c.folder_path.as_deref(),
                expected.get(&c.track_id).map(|s| s.as_str()),
                "candidate {} path mismatch",
                c.track_id
            );
        }
    }

    #[test]
    fn pending_repairs_candidate_with_unknown_id_has_no_path() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,99999999' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        let row = rows.iter().find(|r| r.id == id).unwrap();
        let candidates = row.candidate_tracks.as_ref().expect("candidate_tracks populated");
        let unknown = candidates.iter().find(|c| c.track_id == "99999999").unwrap();
        assert!(unknown.folder_path.is_none());
        let known = candidates.iter().find(|c| c.track_id == "40000001").unwrap();
        assert!(known.folder_path.is_some());
    }

    #[test]
    fn pending_repairs_degrades_gracefully_when_masterdb_unreadable() {
        // No XML linked at all — pioneer_dir can't be resolved.
        let conn = db();
        let id_pending = seed_repair_row(&conn, "a", "a2", Some("1"), "pending");
        let id_ambig = seed_repair_row(&conn, "b", "b2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='1,2' WHERE id=?1",
            rusqlite::params![id_ambig],
        )
        .unwrap();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 2, "both rows still listed despite unresolved pioneer_dir");
        let pending = rows.iter().find(|r| r.id == id_pending).unwrap();
        assert!(pending.candidate_tracks.is_none());
        let ambig = rows.iter().find(|r| r.id == id_ambig).unwrap();
        assert!(ambig.candidate_tracks.is_none(), "no XML linked -> None, not an error");
    }
}
