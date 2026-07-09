//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::actions;
use crate::filing;
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
    let genre = if edit.genres.is_empty() { None } else { Some(edit.genres.join("; ")) };
    let values = actions::MetadataSyncValues {
        artist: Some(edit.artist.clone()),
        title: Some(edit.title.clone()),
        label: edit.label.clone(),
        year: edit.year,
        genre,
    };
    actions::detect_masterdb_metadata_sync_if_linked(conn, &path, track_id, &values, action_id);

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
        MasterDbError::NoDuplicatesToRemove => {
            "aucun doublon à supprimer dans ce groupe — la bibliothèque a peut-être changé depuis le scan".to_string()
        }
        MasterDbError::SongPlaylistEntryNotFound { song_playlist_id } => format!(
            "entrée de playlist {song_playlist_id} introuvable — la bibliothèque Rekordbox a peut-être changé depuis le scan"
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

/// Plain (testable) implementation of `rekordbox_masterdb_resolve_ambiguous`.
fn rekordbox_masterdb_resolve_ambiguous_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String> {
    let (candidate_track_ids, status): (Option<String>, String) = conn
        .query_row(
            "SELECT candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE id=?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if status != "ambiguous" {
        return Err("cette ligne n'est plus ambiguë — rechargement nécessaire".to_string());
    }
    let candidates = candidate_track_ids.unwrap_or_default();
    if !candidates.split(',').any(|c| c == chosen_track_id) {
        return Err("piste choisie invalide pour cette ambiguïté".to_string());
    }

    conn.execute(
        "UPDATE rekordbox_masterdb_repairs SET track_id=?1, candidate_track_ids=NULL, status='pending' WHERE id=?2",
        rusqlite::params![chosen_track_id, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, &chosen_track_id)
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

// ── M8 Tier 3: master.db metadata sync candidates ─────────────────────────────

/// One candidate metadata sync (Sift retagged a file linked to Rekordbox), keyed by Sift
/// `track_id` (unlike Tier 1's `PendingMasterdbRepair`, which is keyed by `action_id`) — a fresh
/// retag before the user applies replaces this row rather than adding another.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingMetadataSync {
    pub id: i64,
    pub track_id: i64,
    /// `tracks.path`, for display.
    pub sift_path: String,
    /// `djmdContent.ID` — `None` when `status == "ambiguous"`.
    pub rekordbox_track_id: Option<String>,
    pub candidate_track_ids: Option<String>,
    /// Same enrichment discipline as `PendingMasterdbRepair::candidate_tracks` — resolved fresh,
    /// only for `ambiguous` rows, `None` if `master.db` couldn't be read (degrades gracefully).
    pub candidate_tracks: Option<Vec<CandidateTrack>>,
    pub new_artist: Option<String>,
    pub new_title: Option<String>,
    pub new_label: Option<String>,
    pub new_year: Option<i64>,
    pub new_genre: Option<String>,
    /// "pending" | "ambiguous".
    pub status: String,
    pub detected_at: String,
}

/// Plain (testable) implementation of `rekordbox_masterdb_pending_metadata_syncs`.
fn rekordbox_masterdb_pending_metadata_syncs_inner(conn: &Connection) -> Result<Vec<PendingMetadataSync>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.track_id, t.path, s.rekordbox_track_id, s.candidate_track_ids,
                    s.new_artist, s.new_title, s.new_label, s.new_year, s.new_genre, s.status, s.detected_at
             FROM rekordbox_masterdb_metadata_syncs s
             JOIN tracks t ON t.id = s.track_id
             WHERE s.status IN ('pending', 'ambiguous')
             ORDER BY s.detected_at",
        )
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<PendingMetadataSync> = stmt
        .query_map([], |r| {
            Ok(PendingMetadataSync {
                id: r.get(0)?,
                track_id: r.get(1)?,
                sift_path: r.get(2)?,
                rekordbox_track_id: r.get(3)?,
                candidate_track_ids: r.get(4)?,
                candidate_tracks: None,
                new_artist: r.get(5)?,
                new_title: r.get(6)?,
                new_label: r.get(7)?,
                new_year: r.get(8)?,
                new_genre: r.get(9)?,
                status: r.get(10)?,
                detected_at: r.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if rows.iter().any(|r| r.status == "ambiguous") {
        if let Some(path_map) = read_masterdb_path_map(conn) {
            for row in rows.iter_mut().filter(|r| r.status == "ambiguous") {
                if let Some(ids) = &row.candidate_track_ids {
                    row.candidate_tracks = Some(
                        ids.split(',')
                            .map(|id| CandidateTrack { track_id: id.to_string(), folder_path: path_map.get(id).cloned() })
                            .collect(),
                    );
                }
            }
        }
    }
    Ok(rows)
}

/// Candidate `master.db` metadata syncs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_metadata_syncs(conn: State<'_, Mutex<Connection>>) -> Result<Vec<PendingMetadataSync>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_pending_metadata_syncs_inner(&conn)
}

/// Plain (testable) implementation of `rekordbox_masterdb_dismiss_metadata_sync`.
fn rekordbox_masterdb_dismiss_metadata_sync_inner(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("UPDATE rekordbox_masterdb_metadata_syncs SET status='dismissed' WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a pending/ambiguous metadata sync as dismissed — it stops appearing in
/// `pending_metadata_syncs`. Never applies anything. A subsequent retag of the same track still
/// resurrects a fresh candidate (see `detect_masterdb_metadata_sync_if_linked`'s `ON CONFLICT`).
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_metadata_sync(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_dismiss_metadata_sync_inner(&conn, id)
}

/// Plain (testable) implementation of `rekordbox_masterdb_resolve_ambiguous_metadata_sync`.
fn rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String> {
    let (candidate_track_ids, status): (Option<String>, String) = conn
        .query_row(
            "SELECT candidate_track_ids, status FROM rekordbox_masterdb_metadata_syncs WHERE id=?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    if status != "ambiguous" {
        return Err("cette ligne n'est plus ambiguë — rechargement nécessaire".to_string());
    }
    let candidates = candidate_track_ids.unwrap_or_default();
    if !candidates.split(',').any(|c| c == chosen_track_id) {
        return Err("piste choisie invalide pour cette ambiguïté".to_string());
    }

    conn.execute(
        "UPDATE rekordbox_masterdb_metadata_syncs SET rekordbox_track_id=?1, candidate_track_ids=NULL, status='pending' WHERE id=?2",
        rusqlite::params![chosen_track_id, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner(&conn, id, &chosen_track_id)
}

/// Result of attempting to apply one pending metadata sync.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApplyMetadataSyncOutcome {
    pub id: i64,
    pub ok: bool,
    pub error: Option<String>,
}

/// Attempts one metadata sync row. Never calls `sync_track_metadata` for a row that isn't
/// `pending` with a known `rekordbox_track_id`.
fn apply_one_metadata_sync(conn: &Connection, pioneer_dir: &Path, backup_root: &Path, batch_stamp: &str, id: i64) -> ApplyMetadataSyncOutcome {
    let row = conn.query_row(
        "SELECT rekordbox_track_id, new_artist, new_title, new_label, new_year, new_genre, status
         FROM rekordbox_masterdb_metadata_syncs WHERE id=?1",
        rusqlite::params![id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    );
    let (rekordbox_track_id, new_artist, new_title, new_label, new_year, new_genre, status) = match row {
        Ok(v) => v,
        Err(e) => return ApplyMetadataSyncOutcome { id, ok: false, error: Some(e.to_string()) },
    };

    let Some(rekordbox_track_id) = rekordbox_track_id.filter(|_| status == "pending") else {
        return ApplyMetadataSyncOutcome {
            id,
            ok: false,
            error: Some("piste ambiguë ou déjà traitée — résolution manuelle requise".to_string()),
        };
    };

    let sync = crate::rekordbox_masterdb::MetadataSync {
        track_id: rekordbox_track_id,
        artist: new_artist,
        title: new_title,
        year: new_year,
        genre: new_genre,
        label: new_label,
    };
    let backup_dir = backup_root.join(batch_stamp).join(id.to_string());

    match crate::rekordbox_masterdb::sync_track_metadata(pioneer_dir, &backup_dir, &sync) {
        Ok(()) => {
            if let Err(e) = conn.execute(
                "UPDATE rekordbox_masterdb_metadata_syncs SET status='applied', applied_at=datetime('now') WHERE id=?1",
                rusqlite::params![id],
            ) {
                return ApplyMetadataSyncOutcome { id, ok: false, error: Some(e.to_string()) };
            }
            ApplyMetadataSyncOutcome { id, ok: true, error: None }
        }
        Err(e) => ApplyMetadataSyncOutcome { id, ok: false, error: Some(humanize_masterdb_error(&e)) },
    }
}

/// Plain (testable) implementation of `rekordbox_masterdb_apply_metadata_syncs`.
fn rekordbox_masterdb_apply_metadata_syncs_inner(conn: &Connection, backup_root: &Path, ids: &[i64]) -> Result<Vec<ApplyMetadataSyncOutcome>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;

    let batch_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut outcomes = Vec::with_capacity(ids.len());
    for &id in ids {
        outcomes.push(apply_one_metadata_sync(conn, pioneer_dir, backup_root, &batch_stamp, id));
    }
    Ok(outcomes)
}

/// Applies the given pending/ambiguous metadata sync `id`s against the linked Rekordbox's
/// `master.db`, one at a time. Never invoked automatically — explicit user-confirmed write step.
/// A failure on one `id` does not stop the rest of the batch. Backups land under
/// `app_data_dir()/rekordbox-backups/<batch timestamp>/<id>/`, same convention as Tier 1/2.
#[tauri::command]
pub fn rekordbox_masterdb_apply_metadata_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<ApplyMetadataSyncOutcome>, String> {
    let backup_root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_apply_metadata_syncs_inner(&conn, &backup_root, &ids)
}

// ── M8 Tier 2: playlist duplicate-entry dedup ─────────────────────────────────

/// One `djmdSongPlaylist` row involved in a duplicate group — mirrors
/// `rekordbox_masterdb::PlaylistDuplicateEntry` field-for-field, kept as a
/// separate IPC-local type per this module's `Serialize`-boundary convention
/// (see `humanize_masterdb_error`'s doc comment for the same rationale
/// applied to `MasterDbError`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistDuplicateEntryDto {
    pub song_playlist_id: String,
    pub track_no: i64,
}

impl From<crate::rekordbox_masterdb::PlaylistDuplicateEntry> for PlaylistDuplicateEntryDto {
    fn from(e: crate::rekordbox_masterdb::PlaylistDuplicateEntry) -> Self {
        Self { song_playlist_id: e.song_playlist_id, track_no: e.track_no }
    }
}

impl From<PlaylistDuplicateEntryDto> for crate::rekordbox_masterdb::PlaylistDuplicateEntry {
    fn from(e: PlaylistDuplicateEntryDto) -> Self {
        Self { song_playlist_id: e.song_playlist_id, track_no: e.track_no }
    }
}

/// A set of `djmdSongPlaylist` rows in the same playlist that reference the
/// same track more than once — mirrors
/// `rekordbox_masterdb::PlaylistDuplicateGroup` field-for-field, plus 2
/// display-only fields (`playlist_name`, `track_path`) resolved by the scan
/// command for the UI's benefit. Round-trips through the frontend
/// unmodified: a scan returns these, and the exact same shape is passed
/// back to `rekordbox_masterdb_dedup_playlist_group` — no server-side id or
/// cache needed, the group's own fields are the identity. The write engine
/// only ever reads `playlist_id`/`content_id`/`keep`/`remove` (see the
/// reverse `From` impl below) — `playlist_name`/`track_path` are ignored on
/// that path, never required to be present or correct for a write to
/// succeed.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistDuplicateGroupDto {
    pub playlist_id: String,
    /// `djmdPlaylist.Name`, resolved fresh at scan time. `None` if the
    /// playlist couldn't be found when resolving names (library changed
    /// since detection) — the UI falls back to the raw id.
    pub playlist_name: Option<String>,
    pub content_id: String,
    /// The duplicated track's current `master.db` path, resolved fresh at
    /// scan time. `None` for the same reason as `playlist_name`.
    pub track_path: Option<String>,
    pub keep: PlaylistDuplicateEntryDto,
    pub remove: Vec<PlaylistDuplicateEntryDto>,
}

impl From<crate::rekordbox_masterdb::PlaylistDuplicateGroup> for PlaylistDuplicateGroupDto {
    fn from(g: crate::rekordbox_masterdb::PlaylistDuplicateGroup) -> Self {
        Self {
            playlist_id: g.playlist_id,
            playlist_name: None,
            content_id: g.content_id,
            track_path: None,
            keep: g.keep.into(),
            remove: g.remove.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<PlaylistDuplicateGroupDto> for crate::rekordbox_masterdb::PlaylistDuplicateGroup {
    fn from(g: PlaylistDuplicateGroupDto) -> Self {
        Self {
            playlist_id: g.playlist_id,
            content_id: g.content_id,
            keep: g.keep.into(),
            remove: g.remove.into_iter().map(Into::into).collect(),
        }
    }
}

/// Plain (testable) implementation of `rekordbox_masterdb_scan_playlist_duplicates`.
/// Enriches with `playlist_name`/`track_path` in one extra pass, only when
/// the scan actually found something — same "resolve once for the whole
/// batch, only when needed" discipline as `rekordbox_masterdb_pending_repairs_inner`'s
/// `candidate_tracks` enrichment.
fn rekordbox_masterdb_scan_playlist_duplicates_inner(conn: &Connection) -> Result<Vec<PlaylistDuplicateGroupDto>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let groups = crate::rekordbox_masterdb::detect_playlist_duplicates(&pioneer_dir.join("master.db"))
        .map_err(|e| humanize_masterdb_error(&e))?;
    let mut dtos: Vec<PlaylistDuplicateGroupDto> = groups.into_iter().map(Into::into).collect();

    if !dtos.is_empty() {
        let playlist_names = crate::rekordbox_masterdb::read_playlist_names(&pioneer_dir.join("master.db")).ok();
        let track_paths = read_masterdb_path_map(conn);
        for dto in &mut dtos {
            if let Some(names) = &playlist_names {
                dto.playlist_name = names.get(&dto.playlist_id).cloned();
            }
            if let Some(paths) = &track_paths {
                dto.track_path = paths.get(&dto.content_id).cloned();
            }
        }
    }
    Ok(dtos)
}

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
    rekordbox_masterdb_scan_playlist_duplicates_inner(&conn)
}

/// Plain (testable) implementation of `rekordbox_masterdb_dedup_playlist_group`.
/// `backup_root` is the caller-resolved base directory for backups
/// (production: `app_data_dir()/rekordbox-backups`), same convention as
/// `rekordbox_masterdb_apply_repairs_inner`.
fn rekordbox_masterdb_dedup_playlist_group_inner(
    conn: &Connection,
    backup_root: &Path,
    group: PlaylistDuplicateGroupDto,
) -> Result<(), String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;

    let batch_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = backup_root.join(&batch_stamp).join(format!("{}-{}", group.playlist_id, group.content_id));

    crate::rekordbox_masterdb::dedup_playlist_group(pioneer_dir, &backup_dir, &group.into())
        .map_err(|e| humanize_masterdb_error(&e))
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
    rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group)
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

    #[test]
    fn resolve_ambiguous_moves_row_to_pending_with_chosen_track() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "40000002").unwrap();

        let (track_id, candidates, status): (Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT track_id, candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE id=?1",
                rusqlite::params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(track_id.as_deref(), Some("40000002"));
        assert_eq!(candidates, None);
        assert_eq!(status, "pending");
    }

    #[test]
    fn resolve_ambiguous_rejects_track_id_outside_candidate_list() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let err = rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "99999999").unwrap_err();
        assert_eq!(err, "piste choisie invalide pour cette ambiguïté");

        let status: String = conn
            .query_row("SELECT status FROM rekordbox_masterdb_repairs WHERE id=?1", rusqlite::params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "ambiguous", "unchanged on rejection");
    }

    #[test]
    fn resolve_ambiguous_rejects_row_that_is_not_ambiguous() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", Some("40000001"), "pending");

        let err = rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "40000001").unwrap_err();
        assert_eq!(err, "cette ligne n'est plus ambiguë — rechargement nécessaire");
    }

    #[test]
    fn scan_playlist_duplicates_finds_the_fixture_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].playlist_id, "50000001");
        assert_eq!(groups[0].content_id, "40000001");
        assert_eq!(groups[0].keep.song_playlist_id, "60000001");
        assert_eq!(groups[0].keep.track_no, 1);
        assert_eq!(groups[0].remove.len(), 1);
        assert_eq!(groups[0].remove[0].song_playlist_id, "60000003");
        assert_eq!(groups[0].remove[0].track_no, 3);
    }

    #[test]
    fn scan_playlist_duplicates_fails_fast_when_no_xml_linked() {
        let conn = db();
        let err = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap_err();
        assert_eq!(err, "aucun XML Rekordbox lié — relie un fichier avant de synchroniser");
    }

    #[test]
    fn scan_playlist_duplicates_enriches_with_playlist_name_and_track_path() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].playlist_name.as_deref(), Some("Fixture Playlist"));
        assert_eq!(groups[0].track_path.as_deref(), Some("D:/FIXTURE/track1.mp3"));
    }

    #[test]
    fn dedup_playlist_group_command_removes_the_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        let group = groups[0].clone();

        let backup_root = tmp.path().join("backups");
        rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group).unwrap();

        let after = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert!(after.is_empty(), "duplicate must be gone after dedup");
        assert!(
            backup_root.exists(),
            "a backup must have been created before the write"
        );
    }

    #[test]
    fn dedup_playlist_group_command_fails_fast_when_no_xml_linked() {
        let conn = db();
        let group = PlaylistDuplicateGroupDto {
            playlist_id: "50000001".to_string(),
            playlist_name: None,
            content_id: "40000001".to_string(),
            track_path: None,
            keep: PlaylistDuplicateEntryDto { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntryDto { song_playlist_id: "60000003".to_string(), track_no: 3 }],
        };
        let backup_root = tempfile::tempdir().unwrap().path().join("backups");
        let err = rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group).unwrap_err();
        assert_eq!(err, "aucun XML Rekordbox lié — relie un fichier avant de synchroniser");
    }

    #[test]
    fn dedup_playlist_group_command_humanizes_stale_group_error() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // A group referencing a song_playlist_id that doesn't exist — simulates the
        // library having changed since the scan that produced this group.
        let stale_group = PlaylistDuplicateGroupDto {
            playlist_id: "50000001".to_string(),
            playlist_name: None,
            content_id: "40000001".to_string(),
            track_path: None,
            keep: PlaylistDuplicateEntryDto { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntryDto { song_playlist_id: "99999999".to_string(), track_no: 9 }],
        };
        let backup_root = tmp.path().join("backups");
        let err = rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, stale_group).unwrap_err();
        assert!(
            err.contains("99999999"),
            "error should name the missing row so the user understands what changed: {err}"
        );
    }

    fn seed_metadata_sync_row(conn: &Connection, track_id: i64, status: &str, rb_track_id: Option<&str>, candidates: Option<&str>) -> i64 {
        conn.execute("INSERT INTO tracks(path, status) VALUES(?1, 'filed')", rusqlite::params![format!("D:/t{track_id}.mp3")]).ok();
        let action_id = crate::actions::record_row_only(conn, "b1", Some(track_id), "tag_edit", Some("D:/x.mp3"), None, None).unwrap();
        conn.execute(
            "INSERT INTO rekordbox_masterdb_metadata_syncs
                 (action_id, track_id, rekordbox_track_id, candidate_track_ids, new_artist, status)
             VALUES (?1, ?2, ?3, ?4, 'New Artist', ?5)",
            rusqlite::params![action_id, track_id, rb_track_id, candidates, status],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn pending_metadata_syncs_excludes_applied_and_dismissed() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        seed_metadata_sync_row(&conn, track_id, "pending", Some("40000001"), None);

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/b.mp3', 'filed')", []).unwrap();
        let track_id_2 = conn.last_insert_rowid();
        let id2 = seed_metadata_sync_row(&conn, track_id_2, "applied", Some("40000002"), None);
        conn.execute("UPDATE rekordbox_masterdb_metadata_syncs SET status='dismissed' WHERE id=?1", rusqlite::params![id2]).ok();

        let rows = rekordbox_masterdb_pending_metadata_syncs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "pending");
    }

    #[test]
    fn dismiss_metadata_sync_marks_dismissed() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "pending", Some("40000001"), None);

        rekordbox_masterdb_dismiss_metadata_sync_inner(&conn, id).unwrap();

        let rows = rekordbox_masterdb_pending_metadata_syncs_inner(&conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn resolve_ambiguous_metadata_sync_moves_to_pending() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"));

        rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner(&conn, id, "40000002").unwrap();

        let rows = rekordbox_masterdb_pending_metadata_syncs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "pending");
        assert_eq!(rows[0].rekordbox_track_id.as_deref(), Some("40000002"));
        assert_eq!(rows[0].candidate_track_ids, None);
    }

    #[test]
    fn resolve_ambiguous_metadata_sync_rejects_track_id_outside_candidate_list() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"));

        let err = rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner(&conn, id, "99999999").unwrap_err();
        assert!(err.contains("invalide"));
    }

    #[test]
    fn resolve_ambiguous_metadata_sync_rejects_row_that_is_not_ambiguous() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "pending", Some("40000001"), None);

        let err = rekordbox_masterdb_resolve_ambiguous_metadata_sync_inner(&conn, id, "40000001").unwrap_err();
        assert!(err.contains("ambigu"));
    }

    #[test]
    fn apply_metadata_syncs_applies_pending_row() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/FIXTURE/track1.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "pending", Some("40000001"), None);

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_metadata_syncs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].ok, "expected ok, got error: {:?}", outcomes[0].error);

        let status: String = conn.query_row("SELECT status FROM rekordbox_masterdb_metadata_syncs WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "applied");
    }

    #[test]
    fn apply_metadata_syncs_continues_after_one_failure() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/FIXTURE/track1.mp3', 'filed')", []).unwrap();
        let track_id_1 = conn.last_insert_rowid();
        let id_ok = seed_metadata_sync_row(&conn, track_id_1, "pending", Some("40000001"), None);

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/FIXTURE/gone.mp3', 'filed')", []).unwrap();
        let track_id_2 = conn.last_insert_rowid();
        let id_fail = seed_metadata_sync_row(&conn, track_id_2, "pending", Some("99999999"), None); // no such djmdContent row

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_metadata_syncs_inner(&conn, &backup_root, &[id_ok, id_fail]).unwrap();
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes[0].ok);
        assert!(!outcomes[1].ok);
        assert!(outcomes[1].error.as_deref().unwrap().contains("introuvable"));

        let status_ok: String = conn.query_row("SELECT status FROM rekordbox_masterdb_metadata_syncs WHERE id=?1", rusqlite::params![id_ok], |r| r.get(0)).unwrap();
        assert_eq!(status_ok, "applied");
        let status_fail: String = conn.query_row("SELECT status FROM rekordbox_masterdb_metadata_syncs WHERE id=?1", rusqlite::params![id_fail], |r| r.get(0)).unwrap();
        assert_eq!(status_fail, "pending", "a failed row must stay pending, retryable");
    }

    #[test]
    fn apply_metadata_syncs_rejects_ambiguous_row_without_calling_engine() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_metadata_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"));

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_metadata_syncs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].ok);
        assert!(outcomes[0].error.as_deref().unwrap().contains("ambigu"));

        let status: String = conn.query_row("SELECT status FROM rekordbox_masterdb_metadata_syncs WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "ambiguous", "must not have been touched");
    }
}
