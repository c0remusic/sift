//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::actions;
use crate::filing;
use crate::library::{self, LibraryFacets, LibraryFilter, LibraryTrack};
use crate::metadata::{self, MetadataEdit};
use rusqlite::Connection;
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

/// Plain (testable) implementation of `update_metadata`. Returns the `tag_edit` batch_id so the
/// caller can offer a targeted undo — same contract as `apply_tags` (`ipc_filing.rs`). Also runs
/// M8 Tier 3 metadata-sync detection (read-only) when the file is linked to Rekordbox.
fn update_metadata_inner(conn: &Connection, track_id: i64, edit: MetadataEdit) -> Result<String, String> {
    // (1) Look up the track path — error immediately if unknown.
    let path: String = conn
        .query_row("SELECT path FROM tracks WHERE id=?1", rusqlite::params![track_id], |r| r.get(0))
        .map_err(|_| format!("track {track_id} not found"))?;

    // (2) Snapshot the OLD tags BEFORE writing — same pattern as apply_tags (ipc_filing.rs).
    let snapshot = crate::tagging::read_tags_full(&path)?;

    // (3) Write the file tags. If it fails we stop here — nothing journaled, DB untouched.
    crate::tagging::write_tags_full(
        &path,
        &edit.artist,
        &edit.title,
        edit.label.as_deref(),
        edit.year,
        &edit.genres,
        edit.cover_path.as_deref(),
    )?;

    // (4) Persist to the DB only after the file write succeeded.
    metadata::update_metadata_db(conn, track_id, &edit).map_err(|e| e.to_string())?;

    // (5) Journal a revertable tag_edit — this is the fix for a pre-existing gap: before this,
    // Bibliothèque edits had no undo path at all (see M8 Tier 3 design, "Fix du gap").
    let meta = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let batch_id = filing::new_batch_id(track_id);
    let action_id = actions::record_with_meta(conn, &batch_id, Some(track_id), "tag_edit", Some(&path), None, Some(&meta))
        .map_err(|e| e.to_string())?;

    // (6) M8 Tier 3: detect (read-only) whether this track is linked to Rekordbox and needs a
    // metadata sync candidate. Never fails the edit itself.
    let (genre, label) = actions::sanitize_genre_label(&edit.genres, edit.label.as_deref());
    let values = actions::MetadataSyncValues {
        artist: Some(edit.artist.clone()),
        title: Some(edit.title.clone()),
        label,
        year: edit.year,
        genre,
    };
    actions::detect_masterdb_metadata_sync_if_linked(conn, &path, track_id, &values, action_id);

    // (7) M8 Tier 3 (pochette): only when THIS edit actually changed the cover — unlike the
    // metadata detector above, which always fires.
    if let Some(cover_path) = &edit.cover_path {
        actions::detect_masterdb_artwork_sync_if_linked(conn, &path, track_id, cover_path, action_id);
    }

    Ok(batch_id)
}

/// Edit a filed track's metadata: writes the file tags first, then updates the DB, then
/// journals the edit as a revertable `tag_edit` (returns its `batch_id` for a targeted undo —
/// see `frontend/library-detail.ts`'s "Annuler" toast).
#[tauri::command]
pub fn update_metadata(
    conn: State<'_, Mutex<Connection>>,
    track_id: i64,
    edit: MetadataEdit,
) -> Result<String, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    update_metadata_inner(&conn, track_id, edit)
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
pub use crate::rekordbox_repairs::{ApplyRepairOutcome, PendingMasterdbRepair};

/// Candidate `master.db` path repairs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_repairs(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PendingMasterdbRepair>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::pending_repairs_inner(&conn)
}

/// Mark a pending/ambiguous repair as dismissed — it stops appearing in `pending_repairs`.
/// Never applies anything.
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_repair(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::dismiss_repair_inner(&conn, id)
}

/// Resolves an ambiguous repair by manually picking the correct `master.db` candidate. The row
/// becomes an ordinary `pending` row afterwards — no other change to the `apply_repairs` flow.
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::resolve_ambiguous_inner(&conn, id, &chosen_track_id)
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
    crate::rekordbox_repairs::apply_repairs_inner(&conn, &backup_root, &ids)
}

// ── M8 Tier 3: master.db metadata sync candidates ─────────────────────────────

pub use crate::rekordbox_repairs::{ApplyMetadataSyncOutcome, PendingMetadataSync};

/// Candidate `master.db` metadata syncs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_metadata_syncs(conn: State<'_, Mutex<Connection>>) -> Result<Vec<PendingMetadataSync>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::pending_metadata_syncs_inner(&conn)
}

/// Mark a pending/ambiguous metadata sync as dismissed — it stops appearing in
/// `pending_metadata_syncs`. Never applies anything. A subsequent retag of the same track still
/// resurrects a fresh candidate (see `detect_masterdb_metadata_sync_if_linked`'s `ON CONFLICT`).
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_metadata_sync(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::dismiss_metadata_sync_inner(&conn, id)
}

/// Resolves an ambiguous metadata sync by manually picking the correct `master.db` candidate. The
/// row becomes an ordinary `pending` row afterwards — no other change to the
/// `apply_metadata_syncs` flow.
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous_metadata_sync(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::resolve_ambiguous_metadata_sync_inner(&conn, id, &chosen_track_id)
}

/// Applies the given pending/ambiguous metadata sync `id`s against the linked Rekordbox's
/// `master.db`, one at a time. Never invoked automatically — explicit user-confirmed write step.
/// A failure on one `id` does not stop the rest of the batch. Backups land under
/// `app_data_dir()/rekordbox-backups/<batch timestamp>/<id>/`, same convention as Tier 1/2.
#[tauri::command]
pub fn rekordbox_masterdb_apply_metadata_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<ApplyMetadataSyncOutcome>, String> {
    let backup_root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::apply_metadata_syncs_inner(&conn, &backup_root, &ids)
}

// ── M8 Tier 3 (pochette): master.db artwork sync candidates ───────────────────

pub use crate::rekordbox_repairs::PendingArtworkSync;

/// Candidate `master.db` artwork syncs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_artwork_syncs(conn: State<'_, Mutex<Connection>>) -> Result<Vec<PendingArtworkSync>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_pending_artwork_syncs_inner(&conn)
}

/// Mark a pending/ambiguous artwork sync as dismissed.
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_artwork_sync(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_dismiss_artwork_sync_inner(&conn, id)
}

/// Resolves an ambiguous artwork sync by manually picking the correct `master.db` candidate.
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous_artwork_sync(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(&conn, id, &chosen_track_id)
}

/// Applies the given pending/ambiguous artwork sync `id`s against the linked Rekordbox's cached
/// artwork files, one at a time. Never invoked automatically. Backups land under
/// `app_data_dir()/rekordbox-backups/<batch timestamp>/<id>/`, same convention as the other tiers.
#[tauri::command]
pub fn rekordbox_masterdb_apply_artwork_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<crate::rekordbox_repairs::ApplyArtworkSyncOutcome>, String> {
    let backup_root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_apply_artwork_syncs_inner(&conn, &backup_root, &ids)
}

// ── M8 Tier 2: playlist duplicate-entry dedup ─────────────────────────────────

pub use crate::rekordbox_repairs::PlaylistDuplicateGroupDto;

/// Scans the linked Rekordbox's `master.db` for playlists containing the
/// same track more than once. Read-only — never touches `master.db`. Called
/// fresh on demand (no persistence): unlike Tier 1's candidate repairs,
/// duplicate playlist entries are a pre-existing library condition, not
/// something Sift's own actions cause, so there's nothing to detect
/// mid-filing or store until later review.
#[tauri::command]
pub fn rekordbox_masterdb_scan_playlist_duplicates(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PlaylistDuplicateGroupDto>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::scan_playlist_duplicates_inner(&conn)
}

/// Removes every extra occurrence in `group.remove` from the linked
/// Rekordbox's `master.db`, keeping `group.keep` untouched — the explicit,
/// user-confirmed write step for one duplicate group returned by
/// `rekordbox_masterdb_scan_playlist_duplicates`. Never invoked
/// automatically. `group` should be exactly what the frontend received from
/// a scan; if the library changed since then (e.g. the row was already
/// removed), the write engine's own verification catches it and this
/// returns a humanized error rather than silently doing nothing or the
/// wrong thing.
#[tauri::command]
pub fn rekordbox_masterdb_dedup_playlist_group(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    group: PlaylistDuplicateGroupDto,
) -> Result<(), String> {
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::dedup_playlist_group_inner(&conn, &backup_root, group)
}

#[cfg(test)]
mod rekordbox_tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&c).unwrap();
        c
    }

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        if std::path::Path::new(&p).exists() { Some(p) } else { None }
    }

    #[test]
    fn update_metadata_journals_a_revertable_tag_edit() {
        let Some(src) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("track.mp3");
        std::fs::copy(&src, &path).unwrap();
        crate::tagging::write_tags_full(path.to_str().unwrap(), "OLD Artist", "OLD Title", None, None, &[], None).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status) VALUES(?1, 'filed')",
            rusqlite::params![path.to_str().unwrap()],
        ).unwrap();
        let track_id = conn.last_insert_rowid();

        let edit = crate::metadata::MetadataEdit {
            artist: "NEW Artist".to_string(),
            title: "NEW Title".to_string(),
            label: None,
            year: None,
            genres: vec![],
            cover_path: None,
        };
        let batch_id = update_metadata_inner(&conn, track_id, edit).unwrap();
        assert!(!batch_id.is_empty());

        let after = crate::tagging::read_tags_full(path.to_str().unwrap()).unwrap();
        assert_eq!(after.artist.as_deref(), Some("NEW Artist"));

        crate::actions::revert_batch(&conn, &batch_id).unwrap();
        let reverted = crate::tagging::read_tags_full(path.to_str().unwrap()).unwrap();
        assert_eq!(reverted.artist.as_deref(), Some("OLD Artist"), "revert_batch must restore the pre-edit tags");
    }

    #[test]
    fn update_metadata_calls_masterdb_metadata_sync_detection_when_linked() {
        let Some(src) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("track1.mp3");
        std::fs::copy(&src, &path).unwrap();
        crate::tagging::write_tags_full(path.to_str().unwrap(), "Old", "Old Title", None, None, &[], None).unwrap();

        // Patch the fixture's track_id "40000001" FolderPath to this real temp path — same
        // decrypt/re-encrypt-for-test technique as actions.rs's ambiguous-match test (Task 2) —
        // so tracks.path (below) and master.db's FolderPath refer to the exact same string.
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2.execute("UPDATE djmdContent SET FolderPath=?1 WHERE ID='40000001'", rusqlite::params![path.to_str().unwrap()]).unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES(?1, 'filed')", rusqlite::params![path.to_str().unwrap()]).unwrap();
        let track_id = conn.last_insert_rowid();

        let edit = crate::metadata::MetadataEdit {
            artist: "New Artist".to_string(),
            title: "New Title".to_string(),
            label: None, year: None, genres: vec![], cover_path: None,
        };
        update_metadata_inner(&conn, track_id, edit).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1", rusqlite::params![track_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn update_metadata_calls_masterdb_artwork_sync_detection_only_when_cover_edited() {
        let Some(src) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("track1.mp3");
        std::fs::copy(&src, &path).unwrap();
        crate::tagging::write_tags_full(path.to_str().unwrap(), "Old", "Old Title", None, None, &[], None).unwrap();

        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2.execute("UPDATE djmdContent SET FolderPath=?1 WHERE ID='40000001'", rusqlite::params![path.to_str().unwrap()]).unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES(?1, 'filed')", rusqlite::params![path.to_str().unwrap()]).unwrap();
        let track_id = conn.last_insert_rowid();

        // (1) Edit WITHOUT touching the cover — no artwork candidate expected.
        let edit_no_cover = crate::metadata::MetadataEdit {
            artist: "New Artist".to_string(), title: "New Title".to_string(),
            label: None, year: None, genres: vec![], cover_path: None,
        };
        update_metadata_inner(&conn, track_id, edit_no_cover).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", rusqlite::params![track_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "no cover_path in this edit — must not create an artwork sync candidate");

        // (2) Edit WITH a new cover — artwork candidate expected.
        let edit_with_cover = crate::metadata::MetadataEdit {
            artist: "New Artist".to_string(), title: "New Title".to_string(),
            label: None, year: None, genres: vec![], cover_path: Some("/cache/covers/999.jpg".to_string()),
        };
        update_metadata_inner(&conn, track_id, edit_with_cover).unwrap();
        let cover_path: String = conn.query_row("SELECT cover_path FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", rusqlite::params![track_id], |r| r.get(0)).unwrap();
        assert_eq!(cover_path, "/cache/covers/999.jpg");
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

}
