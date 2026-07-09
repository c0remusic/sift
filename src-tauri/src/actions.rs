//! The undo engine over the `actions` journal. One user action (Ranger/Jeter/Re-sourcer)
//! is one `batch_id` grouping several rows (convert, move, …). `revert_batch` is the single
//! guarded inversion primitive; `undo_last` (LIFO) and the journal both go through it, so
//! there is exactly one place that knows how to safely reverse work. Pure DB + filesystem.

use rusqlite::{params, Connection};
use serde::Serialize;

/// A raw action row as loaded for reverting: (id, track_id, type, from_path, to_path, meta).
/// `meta` is the free-form JSON column (v7): the `tag_edit` action stores its old-tags snapshot
/// there; every other type leaves it NULL.
type ActionRow = (i64, Option<i64>, String, Option<String>, Option<String>, Option<String>);

/// Why a revert could not proceed (nothing is changed when this is returned).
#[derive(Debug, Clone, PartialEq)]
pub enum RevertError {
    /// Unsafe to revert (collision, missing source, or a newer action depends on it).
    Blocked(String),
    /// Database error.
    Db(String),
}

impl std::fmt::Display for RevertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RevertError::Blocked(m) => write!(f, "revert blocked: {m}"),
            RevertError::Db(m) => write!(f, "db error: {m}"),
        }
    }
}

impl From<rusqlite::Error> for RevertError {
    fn from(e: rusqlite::Error) -> Self {
        RevertError::Db(e.to_string())
    }
}

/// Append one journaled action row and return its id. `batch_id` groups the rows of a
/// single user action; `kind` is one of convert|move|trash|reject.
pub fn record(
    conn: &Connection,
    batch_id: &str,
    track_id: Option<i64>,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
) -> rusqlite::Result<i64> {
    record_with_meta(conn, batch_id, track_id, kind, from_path, to_path, None)
}

/// Like `record`, plus the free-form `meta` JSON column (v7). Used by `apply_tags` to stash the
/// old-tags snapshot a `tag_edit` revert needs. `record` is the thin no-meta wrapper.
pub fn record_with_meta(
    conn: &Connection,
    batch_id: &str,
    track_id: Option<i64>,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    meta: Option<&str>,
) -> rusqlite::Result<i64> {
    let id = record_row_only(conn, batch_id, track_id, kind, from_path, to_path, meta)?;
    maybe_repair_rekordbox_xml(conn, kind, from_path, to_path);
    maybe_detect_masterdb_repair(conn, kind, from_path, to_path, id);
    Ok(id)
}

/// Insert ONLY the journal row (no Rekordbox XML side effect). Split out of `record_with_meta` so
/// a caller that groups several rows in ONE SQLite transaction (see `filing::commit_file`) can do
/// all the DB inserts inside the transaction and run the file-I/O XML repair AFTER the commit —
/// keeping slow disk I/O out of the write transaction. `record_with_meta` remains the all-in-one
/// entry point (insert + immediate repair) for every non-transactional caller.
pub fn record_row_only(
    conn: &Connection,
    batch_id: &str,
    track_id: Option<i64>,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    meta: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO actions(track_id, type, from_path, to_path, batch_id, meta, session_id)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6,
                (SELECT value FROM settings WHERE key='current_session_id'))",
        params![track_id, kind, from_path, to_path, batch_id, meta],
    )?;
    Ok(conn.last_insert_rowid())
}

/// M7: if a Rekordbox XML is linked and this action moved/renamed/converted a file it already
/// references, patch that Location immediately so the track doesn't silently vanish from its
/// Rekordbox playlists. Journaling the action must never fail because of this side effect —
/// any repair error is logged and swallowed, never propagated to the caller.
///
/// Restricted to `move`/`convert`: those are the only kinds where `to_path` is a new location
/// for the SAME library file Rekordbox should keep pointing at. `trash`/`reject` also carry
/// (from, to) pairs, but `to` there is Sift's internal trash/bin path, not a relocation within
/// the library — patching Location to it would make Rekordbox point a "jeté" track at Sift's
/// trash folder. `tag_edit` never sets `to_path` (None) so it's excluded by the match anyway;
/// the `from != to` guard additionally skips the common no-op case (a conformant filing where the
/// file didn't move) so a same-path action doesn't force a pointless read+reparse+write of the XML.
///
/// Extracted from `record_with_meta` so a transactional caller (`filing::commit_file`) can defer
/// this file I/O until AFTER its SQLite transaction commits — the behaviour (which kinds, the
/// `from != to` guard) is unchanged.
pub fn maybe_repair_rekordbox_xml(
    conn: &Connection,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
) {
    if matches!(kind, "move" | "convert") {
        if let (Some(from), Some(to)) = (from_path, to_path) {
            if from != to {
                repair_rekordbox_xml_if_linked(conn, from, to);
            }
        }
    }
}

/// M8 Tier 1: mirrors `maybe_repair_rekordbox_xml`'s guard exactly (same kinds, same
/// `from != to` check — see that function's docs for why `trash`/`reject` are excluded) but
/// for the `master.db` path-repair candidate table instead of the linked XML.
pub fn maybe_detect_masterdb_repair(
    conn: &Connection,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    action_id: i64,
) {
    if matches!(kind, "move" | "convert") {
        if let (Some(from), Some(to)) = (from_path, to_path) {
            if from != to {
                detect_masterdb_repair_if_linked(conn, from, to, action_id);
            }
        }
    }
}

/// Same guard as `maybe_detect_masterdb_repair`, against an already-loaded `master.db` index —
/// see `resolve_masterdb_index_if_linked`'s docs.
pub fn maybe_detect_masterdb_repair_with_index(
    conn: &Connection,
    index: &crate::rekordbox_masterdb::RekordboxIndex,
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    action_id: i64,
) {
    if matches!(kind, "move" | "convert") {
        if let (Some(from), Some(to)) = (from_path, to_path) {
            if from != to {
                detect_masterdb_repair_with_index(conn, index, from, to, action_id);
            }
        }
    }
}

/// Shared by every M8 Tier 1/3 detector: if a Rekordbox XML is linked, decrypt+read the sibling
/// `master.db` (same directory — `master.db` and `masterPlaylists6.xml` are always siblings,
/// confirmed by the M8 spikes) once. `master.db` is a multi-MB SQLCipher file — decrypting it is
/// the expensive part of detection, so callers that need more than one detector for the same
/// commit (see `filing::commit_file`'s post-commit loop) must call this ONCE and pass the result
/// to both `*_with_index` variants, instead of each detector re-reading the file independently.
/// Returns `None` (logging on a real read failure) if nothing is linked or the file is unreadable
/// — same silent-no-op contract as the detectors themselves.
pub fn resolve_masterdb_index_if_linked(conn: &Connection) -> Option<crate::rekordbox_masterdb::RekordboxIndex> {
    let Ok(Some(xml_path)) = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH) else {
        return None;
    };
    let pioneer_dir = std::path::Path::new(&xml_path).parent()?;
    let master_db_path = pioneer_dir.join("master.db");
    match crate::rekordbox_masterdb::read_rekordbox_masterdb(&master_db_path) {
        Ok(idx) => Some(idx),
        Err(e) => {
            log::error!("masterdb detection: {} unreadable: {e}", master_db_path.display());
            None
        }
    }
}

/// Read-only detection: if a Rekordbox XML is linked, look up the sibling `master.db` for
/// `djmdContent` rows whose `FolderPath` equals `from_path`, and record a candidate repair row —
/// `pending` (exactly one match) or `ambiguous` (2+ matches, the real duplicate-path scenario the
/// M8 spikes found in a real library). Never writes `master.db` itself. Any failure (no XML
/// linked, `master.db` unreadable) is a silent no-op — detecting a candidate repair must never
/// fail the filing action that triggered it, same contract as `repair_rekordbox_xml_if_linked`.
///
/// Thin wrapper over `detect_masterdb_repair_with_index` for callers that only need this one
/// detector (a single `master.db` read is cheap enough there). A caller running this AND
/// `detect_masterdb_metadata_sync_if_linked` for the same commit should instead call
/// `resolve_masterdb_index_if_linked` once and use the `_with_index` variants directly.
pub fn detect_masterdb_repair_if_linked(conn: &Connection, from_path: &str, to_path: &str, action_id: i64) {
    let Some(index) = resolve_masterdb_index_if_linked(conn) else {
        return;
    };
    detect_masterdb_repair_with_index(conn, &index, from_path, to_path, action_id);
}

/// Same as `detect_masterdb_repair_if_linked`, but against an already-loaded `master.db` index
/// instead of reading the file itself — see `resolve_masterdb_index_if_linked`'s docs.
pub fn detect_masterdb_repair_with_index(
    conn: &Connection,
    index: &crate::rekordbox_masterdb::RekordboxIndex,
    from_path: &str,
    to_path: &str,
    action_id: i64,
) {
    let matches: Vec<&str> = index
        .tracks
        .iter()
        .filter(|t| t.folder_path == from_path)
        .map(|t| t.track_id.as_str())
        .collect();

    let result = match matches.len() {
        0 => return,
        1 => conn.execute(
            "INSERT OR IGNORE INTO rekordbox_masterdb_repairs (action_id, track_id, from_path, to_path)
             VALUES (?1, ?2, ?3, ?4)",
            params![action_id, matches[0], from_path, to_path],
        ),
        _ => {
            let candidates = matches.join(",");
            conn.execute(
                "INSERT OR IGNORE INTO rekordbox_masterdb_repairs
                 (action_id, candidate_track_ids, from_path, to_path, status)
                 VALUES (?1, ?2, ?3, ?4, 'ambiguous')",
                params![action_id, candidates, from_path, to_path],
            )
        }
    };
    if let Err(e) = result {
        log::error!("masterdb repair detection: insert failed: {e}");
    }
}

/// M8 Tier 3: the values a caller just wrote to a file's ID3 tags, not yet resolved against
/// Rekordbox's own FK tables (that resolution happens at apply time, inside
/// `rekordbox_masterdb::sync_track_metadata`). `None` fields mean "not changed by this write" —
/// same convention as `tagging::write_tags_full`.
pub struct MetadataSyncValues {
    pub artist: Option<String>,
    pub title: Option<String>,
    pub label: Option<String>,
    pub year: Option<i64>,
    pub genre: Option<String>,
}

/// Applies the exact same trim+blank-filter discipline as `tagging::write_tags_full` before a
/// value becomes an M8 Tier 3 sync candidate — a value the detector records must never diverge
/// from what the real tag write actually decided to write (see the final whole-branch review of
/// docs/superpowers/plans/2026-07-09-m8-tier3-metadata-sync-ipc-ui.md, finding #2).
pub fn sanitize_genre_label(genres: &[String], label: Option<&str>) -> (Option<String>, Option<String>) {
    let joined: String = genres
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    let genre = if joined.is_empty() { None } else { Some(joined) };
    let label = label.filter(|s| !s.trim().is_empty()).map(|s| s.to_string());
    (genre, label)
}

/// M8 Tier 3: read-only detection, mirroring `detect_masterdb_repair_if_linked`'s guard and
/// 0/1/2+ match branches exactly, but writing to `rekordbox_masterdb_metadata_syncs` (keyed by
/// Sift `track_id`, `UNIQUE(track_id)` — a second call for the same track REPLACES the row via
/// `ON CONFLICT DO UPDATE`, preserving `id` so any reference already shown in the UI this render
/// stays valid) instead of `rekordbox_masterdb_repairs`.
///
/// Called directly by the 3 sites that write ID3 tags — `filing.rs`'s post-commit loop,
/// `apply_tags`, and `update_metadata` — right after each obtains its own `action_id`. Never
/// threaded through `record_with_meta`'s generic signature.
///
/// Thin wrapper over `detect_masterdb_metadata_sync_with_index` for callers that only need this
/// one detector. `filing::commit_file` also runs `detect_masterdb_repair_if_linked` for the same
/// commit — it calls `resolve_masterdb_index_if_linked` once and uses the `_with_index` variants
/// of both instead, to avoid decrypting `master.db` twice per row.
pub fn detect_masterdb_metadata_sync_if_linked(
    conn: &Connection,
    lookup_path: &str,
    track_id: i64,
    values: &MetadataSyncValues,
    action_id: i64,
) {
    let Some(index) = resolve_masterdb_index_if_linked(conn) else {
        return;
    };
    detect_masterdb_metadata_sync_with_index(conn, &index, lookup_path, track_id, values, action_id);
}

/// Same as `detect_masterdb_metadata_sync_if_linked`, but against an already-loaded `master.db`
/// index instead of reading the file itself — see `resolve_masterdb_index_if_linked`'s docs.
pub fn detect_masterdb_metadata_sync_with_index(
    conn: &Connection,
    index: &crate::rekordbox_masterdb::RekordboxIndex,
    lookup_path: &str,
    track_id: i64,
    values: &MetadataSyncValues,
    action_id: i64,
) {
    let matches: Vec<&str> = index
        .tracks
        .iter()
        .filter(|t| t.folder_path == lookup_path)
        .map(|t| t.track_id.as_str())
        .collect();

    let (rekordbox_track_id, candidate_track_ids, status): (Option<&str>, Option<String>, &str) = match matches.len() {
        0 => return,
        1 => (Some(matches[0]), None, "pending"),
        _ => (None, Some(matches.join(",")), "ambiguous"),
    };

    let result = conn.execute(
        "INSERT INTO rekordbox_masterdb_metadata_syncs
             (action_id, track_id, rekordbox_track_id, candidate_track_ids, new_artist, new_title, new_label, new_year, new_genre, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(track_id) DO UPDATE SET
             action_id=excluded.action_id, rekordbox_track_id=excluded.rekordbox_track_id,
             candidate_track_ids=excluded.candidate_track_ids, new_artist=excluded.new_artist,
             new_title=excluded.new_title, new_label=excluded.new_label, new_year=excluded.new_year,
             new_genre=excluded.new_genre, status=excluded.status, detected_at=datetime('now')",
        params![
            action_id, track_id, rekordbox_track_id, candidate_track_ids,
            values.artist, values.title, values.label, values.year, values.genre, status,
        ],
    );
    if let Err(e) = result {
        log::error!("masterdb metadata sync detection: insert failed: {e}");
    }
}

/// M8 Tier 3 (pochette): read-only detection, mirroring `detect_masterdb_metadata_sync_if_linked`'s
/// guard and 0/1/2+ match branches exactly, but writing to `rekordbox_masterdb_artwork_syncs`
/// and storing `cover_path` as-is (never resolved image bytes — those are read fresh at apply
/// time by `rekordbox_masterdb_apply_artwork_syncs`, so a moved/deleted source file fails loudly
/// instead of silently syncing stale bytes).
///
/// Unlike the metadata detector, callers only invoke this when `cover_path` is actually `Some` on
/// their current write — an edit that doesn't touch the cover must never produce a candidate.
pub fn detect_masterdb_artwork_sync_if_linked(
    conn: &Connection,
    lookup_path: &str,
    track_id: i64,
    cover_path: &str,
    action_id: i64,
) {
    let Some(index) = resolve_masterdb_index_if_linked(conn) else {
        return;
    };
    detect_masterdb_artwork_sync_with_index(conn, &index, lookup_path, track_id, cover_path, action_id);
}

/// Same as `detect_masterdb_artwork_sync_if_linked`, but against an already-loaded `master.db`
/// index — see `resolve_masterdb_index_if_linked`'s docs (filing.rs's post-commit loop shares one
/// decrypted index across all 3 of its detectors per commit).
pub fn detect_masterdb_artwork_sync_with_index(
    conn: &Connection,
    index: &crate::rekordbox_masterdb::RekordboxIndex,
    lookup_path: &str,
    track_id: i64,
    cover_path: &str,
    action_id: i64,
) {
    let matches: Vec<&str> = index
        .tracks
        .iter()
        .filter(|t| t.folder_path == lookup_path)
        .map(|t| t.track_id.as_str())
        .collect();

    let (rekordbox_track_id, candidate_track_ids, status): (Option<&str>, Option<String>, &str) = match matches.len() {
        0 => return,
        1 => (Some(matches[0]), None, "pending"),
        _ => (None, Some(matches.join(",")), "ambiguous"),
    };

    let result = conn.execute(
        "INSERT INTO rekordbox_masterdb_artwork_syncs
             (action_id, track_id, rekordbox_track_id, candidate_track_ids, cover_path, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(track_id) DO UPDATE SET
             action_id=excluded.action_id, rekordbox_track_id=excluded.rekordbox_track_id,
             candidate_track_ids=excluded.candidate_track_ids, cover_path=excluded.cover_path,
             status=excluded.status, detected_at=datetime('now')",
        params![action_id, track_id, rekordbox_track_id, candidate_track_ids, cover_path, status],
    );
    if let Err(e) = result {
        log::error!("masterdb artwork sync detection: insert failed: {e}");
    }
}

/// If a Rekordbox XML is linked (`settings::REKORDBOX_XML_PATH`) and it references `from_path`,
/// patch its `Location` to `to_path` and rewrite the file immediately. No-op (returns `None`) if
/// nothing is linked. On a read/parse failure of the linked file, logs the error and returns
/// `None` — fails fast, no panic, no silent corruption of the file. The dashboard card's
/// `rekordbox_status` IPC (not this hook) is what surfaces the error state to the user.
///
/// FIX-7: an AMBIGUOUS `patch_location` match (the linked XML's raw text has drifted from what
/// Sift's DB thinks) used to only `log::error!` — invisible unless someone was tailing the server
/// log. It now also persists `settings::REKORDBOX_XML_DRIFT`, which `rekordbox_status`/
/// `RekordboxLinkStatus.drift_detected` surface to the dashboard card. A subsequent SUCCESSFUL
/// patch clears the flag (the drift that mattered got resolved); re-linking also clears it (the
/// user's explicit "I've dealt with it" signal) — see `ipc_library::link_rekordbox_xml_inner`.
pub fn repair_rekordbox_xml_if_linked(conn: &Connection, from_path: &str, to_path: &str) -> Option<usize> {
    let path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).ok().flatten()?;
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            log::error!("rekordbox repair: linked XML {path} unreadable: {e}");
            return None;
        }
    };
    let mut parsed = match crate::rekordbox_xml::parse(&bytes) {
        Ok(p) => p,
        Err(e) => {
            log::error!("rekordbox repair: linked XML {path} unparseable: {e}");
            return None;
        }
    };
    use crate::rekordbox_xml::PatchLocationResult;
    match crate::rekordbox_xml::patch_location(&mut parsed, from_path, to_path) {
        PatchLocationResult::NotTracked => Some(0), // linked, but this path wasn't tracked — nothing to repair
        PatchLocationResult::Drifted => {
            let _ = crate::settings::set(conn, crate::settings::REKORDBOX_XML_DRIFT, "1");
            None
        }
        PatchLocationResult::Patched => {
            if let Err(e) = std::fs::write(&path, &parsed.raw_xml) {
                log::error!("rekordbox repair: failed writing patched XML {path}: {e}");
                return None;
            }
            let _ = crate::settings::set(conn, crate::settings::REKORDBOX_XML_DRIFT, "0");
            Some(1)
        }
    }
}

/// Reverse one action's filesystem effect. Guards refuse to overwrite or act on stale
/// state; on a guard failure nothing is changed and `Blocked` is returned.
/// `pub(crate)`: also called directly by `ecartes::restore_track` (FIX-5), which reverses a
/// single `trash` action outside the `revert_batch` LIFO flow — same guards, same primitive,
/// no separate reimplementation.
pub(crate) fn revert_one_fs(
    kind: &str,
    from_path: Option<&str>,
    to_path: Option<&str>,
    meta: Option<&str>,
) -> Result<(), RevertError> {
    use std::path::Path;
    match kind {
        // file was moved from `from` to `to` — rename back (intra-disk, fast)
        "move" => {
            let from = from_path.ok_or_else(|| RevertError::Blocked("missing from_path".into()))?;
            let to = to_path.ok_or_else(|| RevertError::Blocked("missing to_path".into()))?;
            let to_exists = Path::new(to).exists();
            let from_exists = Path::new(from).exists();
            if !to_exists && from_exists {
                // File is already at origin (e.g. sync service restored it) — revert is
                // effectively done; let the caller mark it undone without touching the FS.
                return Ok(());
            }
            if !to_exists {
                return Err(RevertError::Blocked(format!("source gone: {to}")));
            }
            if from_exists {
                // Both from and to exist — genuine conflict, refuse to overwrite.
                return Err(RevertError::Blocked(format!("destination occupied: {from}")));
            }
            if let Some(parent) = Path::new(from).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| RevertError::Blocked(format!("mkdir {}: {e}", parent.display())))?;
            }
            std::fs::rename(to, from).map_err(|e| RevertError::Blocked(format!("move back: {e}")))
        }
        // file was trashed via copy→verify→delete (cross-disk safe); restore the same way
        "trash" => {
            let from = from_path.ok_or_else(|| RevertError::Blocked("missing from_path".into()))?;
            let to = to_path.ok_or_else(|| RevertError::Blocked("missing to_path".into()))?;
            let to_exists = Path::new(to).exists();
            let from_exists = Path::new(from).exists();
            if !to_exists && from_exists {
                // already at origin (e.g. manual restore) — nothing to do
                return Ok(());
            }
            if !to_exists {
                return Err(RevertError::Blocked(format!("trash file gone: {to}")));
            }
            if from_exists {
                return Err(RevertError::Blocked(format!("destination occupied: {from}")));
            }
            if let Some(parent) = Path::new(from).parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| RevertError::Blocked(format!("mkdir {}: {e}", parent.display())))?;
            }
            let src_len = std::fs::metadata(to)
                .map_err(|e| RevertError::Blocked(format!("stat trash file: {e}")))?
                .len();
            std::fs::copy(to, from)
                .map_err(|e| RevertError::Blocked(format!("copy from trash: {e}")))?;
            let dst_len = match std::fs::metadata(from) {
                Ok(m) => m.len(),
                Err(e) => {
                    let _ = std::fs::remove_file(from);
                    return Err(RevertError::Blocked(format!("stat restored copy: {e}")));
                }
            };
            if dst_len != src_len {
                let _ = std::fs::remove_file(from);
                return Err(RevertError::Blocked(format!(
                    "trash restore size mismatch (src {src_len} != dst {dst_len})"
                )));
            }
            std::fs::remove_file(to)
                .map_err(|e| RevertError::Blocked(format!("remove from trash after restore: {e}")))
        }
        // a converted file was produced at `to` — remove it (idempotent if already gone)
        "convert" => {
            if let Some(to) = to_path {
                if Path::new(to).exists() {
                    std::fs::remove_file(to)
                        .map_err(|e| RevertError::Blocked(format!("remove converted: {e}")))?;
                }
            }
            Ok(())
        }
        // status-only action — nothing on disk to reverse
        "reject" => Ok(()),
        // the file's tags were rewritten in place (Apply ID3 tags); `from_path` is the file and
        // `meta` holds the snapshot of the OLD tags captured before the write. Restore them exactly.
        // Guards: refuse cleanly if the file is gone or the snapshot is missing/corrupt; restore_tags
        // saves last, so a mid-restore failure leaves the file unchanged.
        "tag_edit" => {
            let path = from_path.ok_or_else(|| RevertError::Blocked("tag_edit missing from_path".into()))?;
            if !Path::new(path).exists() {
                return Err(RevertError::Blocked(format!("file gone: {path}")));
            }
            let meta = meta.ok_or_else(|| RevertError::Blocked("tag_edit missing tag snapshot".into()))?;
            let snap: crate::tagging::TagsSnapshot = serde_json::from_str(meta)
                .map_err(|e| RevertError::Blocked(format!("bad tag snapshot: {e}")))?;
            crate::tagging::restore_tags(path, &snap).map_err(RevertError::Blocked)
        }
        other => Err(RevertError::Blocked(format!("unknown action type: {other}"))),
    }
}

/// Reverse a whole user action (all live rows of `batch_id`), newest-first, then set the
/// track back to `pending` (folder cleared) and mark the rows `undone`. Blocked if the
/// batch has no live rows, or if a newer live action on the same track exists outside it.
pub fn revert_batch(conn: &Connection, batch_id: &str) -> Result<(), RevertError> {
    // Load this batch's live rows, newest first.
    let mut stmt = conn.prepare(
        "SELECT id, track_id, type, from_path, to_path, meta FROM actions
         WHERE batch_id=?1 AND undone=0 ORDER BY id DESC",
    )?;
    let rows: Vec<ActionRow> = stmt
        .query_map(params![batch_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if rows.is_empty() {
        return Err(RevertError::Blocked(format!("no live actions for batch {batch_id}")));
    }

    let max_id = rows.iter().map(|r| r.0).max().unwrap();
    let track_id = rows.iter().find_map(|r| r.1);

    // LIFO safety: refuse if a newer live action touches the same track outside this batch.
    if let Some(tid) = track_id {
        let newer: i64 = conn.query_row(
            "SELECT count(*) FROM actions
             WHERE track_id=?1 AND undone=0 AND batch_id<>?2 AND id>?3",
            params![tid, batch_id, max_id],
            |r| r.get(0),
        )?;
        if newer > 0 {
            return Err(RevertError::Blocked(
                "a newer action on this track must be undone first".into(),
            ));
        }
    }

    // Reverse each row's filesystem effect (newest first), marking each row undone AS SOON AS its
    // revert succeeds. This keeps a PARTIAL failure (an FS error on a later row) consistent and
    // RE-TRYABLE: the rows already reverted stay marked undone, so a re-run resumes with only the
    // still-live rows instead of blocking on an already-restored file. Fail-fast on the FS error.
    for (id, _tid, kind, from_path, to_path, meta) in &rows {
        if let Err(e) = revert_one_fs(kind, from_path.as_deref(), to_path.as_deref(), meta.as_deref()) {
            // Surface the underlying FS failure (it carries the OS error string, e.g. Windows
            // "Access is denied. (os error 5)") instead of letting it vanish behind the `?`. The
            // convert step's `remove_file` is the one that strands a `.aiff` next to a restored
            // `.aif` when it is blocked by a held handle — this log is how we SEE why.
            log::error!(
                "revert_batch {batch_id}: FS step '{kind}' failed (from={from_path:?} to={to_path:?}): {e}"
            );
            return Err(e);
        }
        conn.execute("UPDATE actions SET undone=1 WHERE id=?1", params![id])?;
    }

    // Every row reverted: restore the track to pending and clear the filing-time columns so the
    // re-queued track carries no stale target/confidence. The metadata row (the IDENTIFICATION work:
    // artist/title/version/label/year/genres/discogs_release_id) is KEPT — reverting a FILING (the
    // file move/encode) must not throw away the identification. The result is the already-supported
    // "pending + identified" state (same as an identified-not-yet-filed track), so on reopen the
    // identity is restored and the B9 "tags not written" marker correctly shows (the file was rolled
    // back without the Discogs tags). (analyzed_at is left intact — the file is unchanged.)
    //
    // A tag_edit-only batch is NOT a filing: it never moved the file nor set 'filed', so reverting it
    // must touch ONLY the file's tags (done above) — never flip the track to pending. Skip the whole
    // block for such a batch. (Filing batches still NEVER journal a tag action.)
    let tag_only = rows.iter().all(|(_, _, kind, _, _, _)| kind.as_str() == "tag_edit");
    if let Some(tid) = track_id {
        if !tag_only {
            conn.execute(
                "UPDATE tracks SET status='pending', folder=NULL, target_format=NULL, confidence=NULL
                 WHERE id=?1",
                params![tid],
            )?;
            // A filed track went back to pending — the dashboard duplicate-count cache's
            // (COUNT, MAX(id)) key can miss this, so invalidate explicitly (R1 coordination).
            crate::library::invalidate_duplicate_count_cache();
        }
    }
    Ok(())
}

/// Revert the most recent live batch (LIFO). Returns the reverted batch id, or None if
/// there is nothing to undo.
pub fn undo_last(conn: &Connection) -> Result<Option<String>, RevertError> {
    let batch: Option<String> = conn
        .query_row(
            "SELECT batch_id FROM actions WHERE undone=0 AND batch_id IS NOT NULL
             ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(RevertError::Db(other.to_string())),
        })?;
    match batch {
        Some(b) => {
            revert_batch(conn, &b)?;
            Ok(Some(b))
        }
        None => Ok(None),
    }
}

/// One entry of the consultable journal: a live batch, summarized by its FIRST action.
/// `track_count` = number of distinct tracks in the batch (used by the front to gate
/// "last batch" confirmation on > 10 tracks). `session_id` = NULL for pre-migration rows.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JournalEntry {
    pub batch_id: String,
    pub track_id: Option<i64>,
    /// The batch's FIRST action type (convert|move|trash|reject) — determines the display
    /// category. MIN instead of MAX so a convert+trash filing shows as "convert", not "trash".
    pub kind: String,
    pub from_path: Option<String>,
    pub to_path: Option<String>,
    pub ts: String,
    pub session_id: Option<String>,
    pub track_count: i64,
}

/// Recent live (not-yet-undone) batches, newest first, one entry per batch (summarized by
/// the batch's FIRST action row — MIN id — so a convert+trash filing shows kind="convert").
/// `session_id_filter` = Some(sid) to restrict to one session; None = all sessions.
/// `tag_edit` batches are excluded (they have no category in the Journal view).
pub fn list_journal(conn: &Connection, limit: i64, session_id_filter: Option<&str>) -> Vec<JournalEntry> {
    let mut stmt = match conn.prepare(
        "SELECT a.batch_id, a.track_id, a.type, a.from_path, a.to_path, a.ts,
                a.session_id, g.cnt
         FROM actions a
         JOIN (
             SELECT batch_id, MIN(id) AS mid, count(DISTINCT track_id) AS cnt
             FROM actions
             WHERE undone=0 AND batch_id IS NOT NULL AND type NOT IN ('tag_edit')
             GROUP BY batch_id
         ) g ON a.id = g.mid
         WHERE (?2 IS NULL OR a.session_id = ?2)
         ORDER BY a.id DESC
         LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![limit, session_id_filter], |r| {
        Ok(JournalEntry {
            batch_id: r.get(0)?,
            track_id: r.get(1)?,
            kind: r.get(2)?,
            from_path: r.get(3)?,
            to_path: r.get(4)?,
            ts: r.get(5)?,
            session_id: r.get(6)?,
            track_count: r.get(7)?,
        })
    });
    match rows {
        Ok(it) => it.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn record_inserts_a_row() {
        let conn = db();
        // track_id None: record() is exercised independently of any track row (FK-safe)
        let id = record(&conn, "b1", None, "move", Some("/a"), Some("/b")).unwrap();
        assert!(id > 0);
        let (kind, undone): (String, i64) = conn
            .query_row(
                "SELECT type, undone FROM actions WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(kind, "move");
        assert_eq!(undone, 0);
    }

    #[test]
    fn sanitize_genre_label_drops_blank_genre_entries() {
        let genres = vec!["Deep House".to_string(), "  ".to_string(), "House".to_string()];
        let (genre, _) = sanitize_genre_label(&genres, None);
        assert_eq!(genre, Some("Deep House; House".to_string()));
    }

    #[test]
    fn sanitize_genre_label_all_blank_genres_is_none() {
        let genres = vec!["  ".to_string(), "".to_string()];
        let (genre, _) = sanitize_genre_label(&genres, None);
        assert_eq!(genre, None);
    }

    #[test]
    fn sanitize_genre_label_blank_label_is_none() {
        let (_, label) = sanitize_genre_label(&[], Some("  "));
        assert_eq!(label, None);
    }

    #[test]
    fn sanitize_genre_label_real_label_passes_through() {
        let (_, label) = sanitize_genre_label(&[], Some("Real Label"));
        assert_eq!(label, Some("Real Label".to_string()));
    }

    #[test]
    fn record_with_meta_repairs_linked_rekordbox_xml_on_move() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // TrackID 2 in the fixture is at "C:/Music/House/deep/strings.aiff" — journal a move
        // away from that exact path (matches Location after normalization).
        record(
            &conn,
            "b1",
            None,
            "move",
            Some("C:/Music/House/deep/strings.aiff"),
            Some("C:/Music/House/Deep/strings.aiff"),
        )
        .unwrap();

        let rewritten = std::fs::read_to_string(&xml_path).unwrap();
        assert!(
            rewritten.contains("House/Deep/strings.aiff") || rewritten.contains("House%2FDeep%2Fstrings.aiff"),
            "Location patched in the linked XML file on disk"
        );
    }

    #[test]
    fn record_with_meta_is_noop_on_rekordbox_when_nothing_linked() {
        let conn = db();
        // No REKORDBOX_XML_PATH setting at all — must not error, must not create a file.
        let id = record(&conn, "b2", None, "move", Some("/a"), Some("/b")).unwrap();
        assert!(id > 0);
    }

    /// FIX-1 regression: journaling a `trash` (Jeter) must NEVER patch the linked Rekordbox XML.
    /// `to_path` for a `trash` row is Sift's internal trash folder, not a relocation within the
    /// library — patching Location to it would silently repoint the track at Sift's trash bin in
    /// the user's real Rekordbox file. The linked XML on disk must stay byte-for-byte unchanged.
    #[test]
    fn record_trash_does_not_patch_linked_rekordbox_xml() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        std::fs::write(&xml_path, crate::rekordbox_xml::SAMPLE_XML).unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let before = std::fs::read_to_string(&xml_path).unwrap();

        // Same TrackID-2 path as the "on_move" test above, but journaled as `trash` this time.
        record(
            &conn,
            "b1",
            None,
            "trash",
            Some("C:/Music/House/deep/strings.aiff"),
            Some("C:/Users/x/Documents/Sift/Trash/1__strings.aiff"),
        )
        .unwrap();

        let after = std::fs::read_to_string(&xml_path).unwrap();
        assert_eq!(before, after, "trash must never touch the linked Rekordbox XML");
    }

    /// FIX-7 regression: an AMBIGUOUS `patch_location` match (two collection tracks sharing a
    /// byte-identical Location — a drifted/corrupt linked XML) must persist
    /// `settings::REKORDBOX_XML_DRIFT`, surfaced by `RekordboxLinkStatus.drift_detected`, instead
    /// of only reaching the server log.
    #[test]
    fn record_move_sets_drift_flag_on_ambiguous_rekordbox_match() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let xml_path = dir.path().join("export.xml");
        let dup_location_xml = r#"<?xml version="1.0" encoding="UTF-8"?>

<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.7" Company="Pioneer DJ"/>
  <COLLECTION Entries="2">
    <TRACK TrackID="1" Name="A" Artist="X" Location="file://localhost/C:/Music/dup.mp3"/>
    <TRACK TrackID="2" Name="B" Artist="Y" Location="file://localhost/C:/Music/dup.mp3"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="0"/>
  </PLAYLISTS>
</DJ_PLAYLISTS>
"#;
        std::fs::write(&xml_path, dup_location_xml).unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        assert_eq!(crate::settings::get(&conn, crate::settings::REKORDBOX_XML_DRIFT).unwrap(), None);

        record(&conn, "b1", None, "move", Some("C:/Music/dup.mp3"), Some("C:/Music/moved.mp3")).unwrap();

        assert_eq!(
            crate::settings::get(&conn, crate::settings::REKORDBOX_XML_DRIFT).unwrap(),
            Some("1".to_string()),
            "ambiguous match must set the drift flag"
        );
        // And the file on disk is untouched — Drifted never writes.
        let after = std::fs::read_to_string(&xml_path).unwrap();
        assert_eq!(after, dup_location_xml);
    }

    #[test]
    fn revert_move_puts_file_back() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("orig.mp3");
        let to = dir.path().join("bin/orig.mp3");
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(&to, b"x").unwrap(); // currently at destination
        revert_one_fs("move", Some(from.to_str().unwrap()), Some(to.to_str().unwrap()), None).unwrap();
        assert!(from.exists() && !to.exists());
    }

    #[test]
    fn revert_move_blocked_when_origin_occupied() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("orig.mp3");
        let to = dir.path().join("bin/orig.mp3");
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(&from, b"old").unwrap(); // origin already taken → must not overwrite
        std::fs::write(&to, b"new").unwrap();
        let err = revert_one_fs("move", Some(from.to_str().unwrap()), Some(to.to_str().unwrap()), None);
        assert!(matches!(err, Err(RevertError::Blocked(_))));
        assert!(to.exists()); // nothing moved
    }

    #[test]
    fn revert_convert_deletes_converted_file() {
        let dir = tempfile::tempdir().unwrap();
        let converted = dir.path().join("out.aiff");
        std::fs::write(&converted, b"x").unwrap();
        revert_one_fs("convert", Some("/orig.flac"), Some(converted.to_str().unwrap()), None).unwrap();
        assert!(!converted.exists());
    }

    #[test]
    fn revert_reject_is_noop() {
        assert!(revert_one_fs("reject", None, None, None).is_ok());
    }

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        if Path::new(&p).exists() {
            Some(p)
        } else {
            None
        }
    }

    /// The judge of the whole feature: applying then reverting a `tag_edit` must restore the file's
    /// original tags EXACTLY, while leaving the track's status and metadata row untouched (a tag edit
    /// is not a filing — it never moved the file nor set 'filed').
    #[test]
    fn revert_tag_edit_restores_tags_without_touching_status_or_metadata() {
        let Some(src) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("track.mp3");
        std::fs::copy(&src, &file).unwrap();
        let path = file.to_str().unwrap();

        // A PENDING track with a metadata row — both must survive a tag_edit revert.
        conn.execute("INSERT INTO tracks(path, status) VALUES(?1, 'pending')", params![path]).unwrap();
        let tid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO metadata(track_id, artist, title) VALUES(?1, 'orig-a', 'orig-t')",
            params![tid],
        )
        .unwrap();

        // Capture old tags, apply new ones, journal the snapshot as a tag_edit (as apply_tags does).
        let before = crate::tagging::read_tags_full(path).unwrap();
        crate::tagging::write_tags_full(path, "NEW A", "NEW T", Some("NEW L"), Some(2030), &["Acid".to_string()], None).unwrap();
        let meta = serde_json::to_string(&before).unwrap();
        record_with_meta(&conn, "tg", Some(tid), "tag_edit", Some(path), None, Some(&meta)).unwrap();

        revert_batch(&conn, "tg").unwrap();

        // Tags restored to the original snapshot, exactly.
        assert_eq!(crate::tagging::read_tags_full(path).unwrap(), before);
        // Status and metadata row untouched.
        let status: String = conn.query_row("SELECT status FROM tracks WHERE id=?1", params![tid], |r| r.get(0)).unwrap();
        assert_eq!(status, "pending", "a tag_edit revert must not change status");
        let meta_rows: i64 = conn.query_row("SELECT count(*) FROM metadata WHERE track_id=?1", params![tid], |r| r.get(0)).unwrap();
        assert_eq!(meta_rows, 1, "a tag_edit revert must not drop metadata");
        // Row marked undone.
        let live: i64 = conn.query_row("SELECT count(*) FROM actions WHERE batch_id='tg' AND undone=0", [], |r| r.get(0)).unwrap();
        assert_eq!(live, 0);
    }

    #[test]
    fn revert_tag_edit_blocked_when_file_gone() {
        // Missing file → Blocked, nothing changes (the snapshot can't be applied to a vanished file).
        let err = revert_one_fs("tag_edit", Some("/no/such/file.mp3"), None, Some("{}"));
        assert!(matches!(err, Err(RevertError::Blocked(_))));
    }

    /// Insert a filed track + its convert/move batch, with the file physically at `to`.
    fn seed_filed(conn: &Connection, dir: &Path, batch: &str) -> (i64, std::path::PathBuf, std::path::PathBuf) {
        conn.execute(
            "INSERT INTO tracks(path, status, folder, target_format, confidence)
             VALUES(?1, 'filed', 'House', 'aiff_16_44', 'green')",
            params![format!("{}/orig.mp3", dir.display())],
        )
        .unwrap();
        let track_id = conn.last_insert_rowid();
        let from = dir.join("orig.mp3");
        let to = dir.join("House/orig.mp3");
        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(&to, b"x").unwrap(); // file lives at destination after filing
        record(conn, batch, Some(track_id), "convert", Some(from.to_str().unwrap()), Some(to.to_str().unwrap())).unwrap();
        record(conn, batch, Some(track_id), "move", Some(from.to_str().unwrap()), Some(to.to_str().unwrap())).unwrap();
        (track_id, from, to)
    }

    #[test]
    fn revert_batch_restores_file_and_status_and_marks_undone() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (track_id, from, to) = seed_filed(&conn, dir.path(), "b1");

        revert_batch(&conn, "b1").unwrap();

        // file moved back; status reset; folder cleared
        assert!(from.exists() && !to.exists());
        let (status, folder): (String, Option<String>) = conn
            .query_row("SELECT status, folder FROM tracks WHERE id=?1", params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(folder, None);
        // filing-time columns cleared on undo
        let (tf, cf): (Option<String>, Option<String>) = conn
            .query_row("SELECT target_format, confidence FROM tracks WHERE id=?1", params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(tf, None);
        assert_eq!(cf, None);
        // rows marked undone
        let live: i64 = conn
            .query_row("SELECT count(*) FROM actions WHERE batch_id='b1' AND undone=0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live, 0);
    }

    /// Faithful reproduction of a real non-conformant filing (see filing.rs `execute_file`): the
    /// source is CONVERTED into the bin and the original is moved to `.sift-trash`, journalled as
    /// `convert`(source → converted) THEN `trash`(source → trash_path). revert_batch processes
    /// newest-first, so it must restore the original from trash BEFORE deleting the converted file —
    /// proving the no-data-loss ordering the relevé deduced by reading the code.
    #[test]
    fn revert_batch_conversion_restores_original_and_deletes_converted() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();

        // Physical post-filing state: converted file in the bin, original sitting in `.sift-trash`,
        // and the original source location empty.
        let source = dir.path().join("orig.flac");
        let converted = dir.path().join("House/orig.aiff");
        let trashed = dir.path().join(".sift-trash/1__orig.flac");
        std::fs::create_dir_all(converted.parent().unwrap()).unwrap();
        std::fs::create_dir_all(trashed.parent().unwrap()).unwrap();
        std::fs::write(&converted, b"converted-cdj").unwrap();
        std::fs::write(&trashed, b"original-flac").unwrap();
        assert!(!source.exists(), "source location is empty after the original was trashed");

        // DB: the filed track (+ a metadata row) and the two journalled actions, real order.
        conn.execute(
            "INSERT INTO tracks(path, status, folder, target_format, confidence)
             VALUES(?1, 'filed', 'House', 'aiff_16_44', 'green')",
            params![source.to_str().unwrap()],
        )
        .unwrap();
        let track_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO metadata(track_id, artist, title) VALUES(?1, 'A', 'B')",
            params![track_id],
        )
        .unwrap();
        record(&conn, "bc", Some(track_id), "convert", Some(source.to_str().unwrap()), Some(converted.to_str().unwrap())).unwrap();
        record(&conn, "bc", Some(track_id), "trash", Some(source.to_str().unwrap()), Some(trashed.to_str().unwrap())).unwrap();

        revert_batch(&conn, "bc").unwrap();

        // Original restored to its source (content intact); converted transcode deleted; trash emptied.
        assert!(source.exists(), "original must be restored to its source");
        assert_eq!(std::fs::read(&source).unwrap(), b"original-flac", "restored bytes are the original");
        assert!(!converted.exists(), "converted file must be deleted");
        assert!(!trashed.exists(), "trashed original must have been moved back");

        // Track back to pending, filing columns cleared, metadata PRESERVED, all rows undone.
        let (status, folder, tf, cf): (String, Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT status, folder, target_format, confidence FROM tracks WHERE id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(folder, None);
        assert_eq!(tf, None);
        assert_eq!(cf, None);
        // Reverting a FILING must NOT erase the identification: the metadata row survives so the
        // track comes back "pending + identified" (no need to re-fetch Discogs).
        let (meta, artist): (i64, Option<String>) = conn
            .query_row(
                "SELECT count(*), max(artist) FROM metadata WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(meta, 1, "metadata identity preserved on a filing revert");
        assert_eq!(artist.as_deref(), Some("A"), "the identified artist survives the revert");
        let live: i64 = conn
            .query_row("SELECT count(*) FROM actions WHERE batch_id='bc' AND undone=0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live, 0, "all rows marked undone");
    }

    /// Partial-failure recovery: if an FS error hits a LATER action in the batch (here `convert`,
    /// processed second), the work already done (here `trash`, processed first) must stay marked
    /// undone so a re-run RESUMES instead of blocking on an already-restored file. Reproduces the
    /// real convert+trash filing; the convert revert is made to fail by pointing its `to` at a
    /// non-empty directory (`remove_file` errors), standing in for any transient FS error.
    #[test]
    fn revert_batch_resumes_after_partial_fs_failure() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();

        let source = dir.path().join("orig.flac");
        let converted = dir.path().join("House/orig.aiff");
        let trashed = dir.path().join(".sift-trash/1__orig.flac");
        std::fs::create_dir_all(trashed.parent().unwrap()).unwrap();
        std::fs::write(&trashed, b"original-flac").unwrap();
        // Make the convert revert FAIL on the first pass: `converted` is a non-empty DIRECTORY, so
        // remove_file(converted) errors (stand-in for a locked/undeletable file).
        std::fs::create_dir_all(&converted).unwrap();
        std::fs::write(converted.join("inner"), b"x").unwrap();

        conn.execute(
            "INSERT INTO tracks(path, status, folder, target_format, confidence)
             VALUES(?1, 'filed', 'House', 'aiff_16_44', 'green')",
            params![source.to_str().unwrap()],
        )
        .unwrap();
        let track_id = conn.last_insert_rowid();
        record(&conn, "bp", Some(track_id), "convert", Some(source.to_str().unwrap()), Some(converted.to_str().unwrap())).unwrap();
        record(&conn, "bp", Some(track_id), "trash", Some(source.to_str().unwrap()), Some(trashed.to_str().unwrap())).unwrap();

        // First pass: trash reverts (original restored), convert FAILS. The partial work must be
        // PERSISTED row-by-row — trash marked undone — not discarded.
        let err = revert_batch(&conn, "bp");
        assert!(matches!(err, Err(RevertError::Blocked(_))), "convert remove_file fails on a dir");
        assert!(source.exists(), "the trash step already restored the original");
        let trash_undone: i64 = conn
            .query_row("SELECT undone FROM actions WHERE batch_id='bp' AND type='trash'", [], |r| r.get(0))
            .unwrap();
        let convert_undone: i64 = conn
            .query_row("SELECT undone FROM actions WHERE batch_id='bp' AND type='convert'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(trash_undone, 1, "the succeeded action is marked undone immediately");
        assert_eq!(convert_undone, 0, "the failed action stays live for a retry");
        let status: String = conn
            .query_row("SELECT status FROM tracks WHERE id=?1", params![track_id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "filed", "status is NOT reset until the batch is fully reverted");

        // Clear the FS error (the path becomes a normal file), then re-run: it RESUMES with only the
        // still-live convert row and FINISHES — no block on the already-restored trash.
        std::fs::remove_dir_all(&converted).unwrap();
        std::fs::write(&converted, b"converted-cdj").unwrap();

        revert_batch(&conn, "bp").unwrap();
        assert!(!converted.exists(), "converted file deleted on the retry");
        let live: i64 = conn
            .query_row("SELECT count(*) FROM actions WHERE batch_id='bp' AND undone=0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live, 0, "all rows undone after the retry");
        let status: String = conn
            .query_row("SELECT status FROM tracks WHERE id=?1", params![track_id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "pending", "track reset once the batch is fully reverted");
    }

    #[test]
    fn revert_batch_blocked_when_newer_action_on_same_track() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (track_id, _from, _to) = seed_filed(&conn, dir.path(), "b1");
        // a newer, live action on the same track (e.g. re-filed since)
        record(&conn, "b2", Some(track_id), "move", Some("/x"), Some("/y")).unwrap();

        let err = revert_batch(&conn, "b1");
        assert!(matches!(err, Err(RevertError::Blocked(_))));
    }

    #[test]
    fn revert_batch_unknown_is_blocked() {
        let conn = db();
        assert!(matches!(revert_batch(&conn, "nope"), Err(RevertError::Blocked(_))));
    }

    #[test]
    fn undo_last_reverts_most_recent_batch() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        // older batch b1 on its own track
        seed_filed(&conn, &dir.path().join("one"), "b1");
        // newer batch b2 on another track
        seed_filed(&conn, &dir.path().join("two"), "b2");

        let undone = undo_last(&conn).unwrap();
        assert_eq!(undone.as_deref(), Some("b2")); // newest first

        // b1 still live, b2 marked undone
        let b1_live: i64 = conn.query_row("SELECT count(*) FROM actions WHERE batch_id='b1' AND undone=0", [], |r| r.get(0)).unwrap();
        let b2_live: i64 = conn.query_row("SELECT count(*) FROM actions WHERE batch_id='b2' AND undone=0", [], |r| r.get(0)).unwrap();
        assert!(b1_live > 0 && b2_live == 0);
    }

    #[test]
    fn undo_last_none_when_empty() {
        let conn = db();
        assert_eq!(undo_last(&conn).unwrap(), None);
    }

    #[test]
    fn journal_lists_batches_newest_first() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        seed_filed(&conn, &dir.path().join("one"), "b1");
        seed_filed(&conn, &dir.path().join("two"), "b2");

        let entries = list_journal(&conn, 10, None);
        let ids: Vec<&str> = entries.iter().map(|e| e.batch_id.as_str()).collect();
        assert_eq!(ids, vec!["b2", "b1"]); // newest first, one per batch
        assert_eq!(entries[0].kind, "convert"); // representative (first) action of the batch
    }

    /// Seed a non-conformant `.aif` filing in `dir`, SAME folder: `Track.aif` was converted into
    /// `Track.aiff` (forced extension) and the original trashed — the real `execute_file` order is
    /// `convert` then `trash`. Returns (original .aif, converted .aiff, batch_id).
    fn seed_aif_filing(conn: &Connection, dir: &Path, batch: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let original = dir.join("Track.aif");
        let converted = dir.join("Track.aiff");
        let trashed = dir.join(".sift-trash/1__Track.aif");
        std::fs::create_dir_all(trashed.parent().unwrap()).unwrap();
        std::fs::write(&converted, b"converted-cdj").unwrap();
        std::fs::write(&trashed, b"original-aif").unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status, folder, target_format, confidence)
             VALUES(?1, 'filed', 'House', 'aiff_16_44', 'green')",
            params![original.to_str().unwrap()],
        )
        .unwrap();
        let track_id = conn.last_insert_rowid();
        record(conn, batch, Some(track_id), "convert", Some(original.to_str().unwrap()), Some(converted.to_str().unwrap())).unwrap();
        record(conn, batch, Some(track_id), "trash", Some(original.to_str().unwrap()), Some(trashed.to_str().unwrap())).unwrap();
        (original, converted)
    }

    /// 2a — COLD reproduction of the `.aif`→`.aiff` filing. With nothing holding the converted file,
    /// a cold revert must leave EXACTLY ONE file (the restored `Track.aif`) and delete `Track.aiff`.
    /// Proves the inversion logic eliminates the duplicate when no FS step is blocked.
    #[test]
    fn cold_revert_of_aif_filing_leaves_single_file() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (original, converted) = seed_aif_filing(&conn, dir.path(), "ba");
        assert!(!original.exists(), "before revert the original .aif lives in trash");

        revert_batch(&conn, "ba").unwrap();

        assert!(original.exists(), "original .aif restored");
        assert_eq!(std::fs::read(&original).unwrap(), b"original-aif");
        assert!(!converted.exists(), "converted .aiff deleted — no .aif/.aiff duplicate");
    }

    /// 2b-i — DISCRIMINATES suspicion n°1 (the analysis worker holds the freshly-filed `.aiff` open
    /// and blocks its deletion). The worker opens audio with plain `std::fs::File::open` (see
    /// analysis/decode.rs and lofty's `Probe::open`). Holding the converted `.aiff` the SAME way
    /// during the revert: if std's Windows share mode includes FILE_SHARE_DELETE, `remove_file`
    /// succeeds despite the open handle and the revert leaves a single file — REFUTING "a std-reading
    /// worker causes the duplicate". The assertion is the verdict; if it ever fails, std blocks and
    /// the suspicion is instead confirmed.
    #[cfg(windows)]
    #[test]
    fn windows_std_reader_does_not_block_revert() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (original, converted) = seed_aif_filing(&conn, dir.path(), "bw");

        // Hold the .aiff open exactly like the analysis worker (plain std open), then revert.
        let handle = std::fs::File::open(&converted).unwrap();
        let res = revert_batch(&conn, "bw");
        drop(handle);

        assert!(res.is_ok(), "a std-opened reader does not block the revert: {res:?}");
        assert!(original.exists(), "original .aif restored");
        assert!(!converted.exists(), "converted .aiff deleted despite the open std handle");
    }

    /// 2b-ii — PROVES the trigger. A handle opened WITHOUT share-delete (the way an external locker
    /// such as the Windows Search indexer, an AV scanner, or Explorer's preview pane holds a file)
    /// blocks `remove_file`. The revert restores `Track.aif` from trash, then FAILS to delete
    /// `Track.aiff` → the exact `.aif` + `.aiff` duplicate in one folder the user reported. Dropping
    /// the handle and re-running completes the revert to a single file, proving the lock is the sole
    /// cause. This ASSERTS the current (buggy) duplicate — it is a reproduction, not a fix.
    #[cfg(windows)]
    #[test]
    fn windows_held_handle_reproduces_aif_aiff_duplicate() {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x0000_0001; // read sharing only — NO delete sharing

        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (original, converted) = seed_aif_filing(&conn, dir.path(), "bl");

        // Hold the .aiff with NO delete-share — models an external locker holding the re-enqueued file.
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&converted)
            .unwrap();

        let res = revert_batch(&conn, "bl");
        let err = res.expect_err("a delete-blocking handle must block the convert revert");
        eprintln!("REPRO os error on remove_file(.aiff): {err}");
        assert!(matches!(err, RevertError::Blocked(_)));

        // The reported bug: both `.aif` (restored) and `.aiff` (undeletable) coexist in one folder.
        assert!(original.exists(), "original .aif restored from trash");
        assert!(converted.exists(), "converted .aiff still present → the .aif/.aiff duplicate");

        // Release the handle and re-run: the revert RESUMES and finishes — single file remains.
        drop(handle);
        revert_batch(&conn, "bl").unwrap();
        assert!(original.exists() && !converted.exists(), "single file once the lock is gone");
    }

    fn seed_pioneer_dir_with_fixture(dir: &std::path::Path) -> std::path::PathBuf {
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

    #[test]
    fn detect_masterdb_repair_records_pending_on_single_match() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        // rekordbox_masterdb_repairs.action_id is a real FK to actions(id) — seed a row via
        // record_row_only (no side effects) and use its id, rather than an arbitrary literal.
        let action_id = record_row_only(&conn, "b1", None, "move", Some("D:/FIXTURE/track1.mp3"), Some("D:/FIXTURE/renamed/track1.flac"), None).unwrap();

        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", action_id);

        let (got_action_id, track_id, candidates, status): (i64, String, Option<String>, String) = conn
            .query_row(
                "SELECT action_id, track_id, candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("one repair row inserted");
        assert_eq!(got_action_id, action_id);
        assert_eq!(track_id, "40000001");
        assert_eq!(candidates, None);
        assert_eq!(status, "pending");
    }

    #[test]
    fn detect_masterdb_repair_no_match_inserts_nothing() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let action_id = record_row_only(&conn, "b1", None, "move", Some("D:/nowhere/nope.mp3"), Some("D:/somewhere/else.mp3"), None).unwrap();

        detect_masterdb_repair_if_linked(&conn, "D:/nowhere/nope.mp3", "D:/somewhere/else.mp3", action_id);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_repairs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_repair_ambiguous_on_two_matches() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // Make track 2's FolderPath collide with track 1's, using the manual decrypt/re-encrypt
        // primitives directly — cheaper than a full repair_track_path call for a test-only setup.
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2
            .execute(
                "UPDATE djmdContent SET FolderPath='D:/FIXTURE/track1.mp3' WHERE ID='40000002'",
                [],
            )
            .unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();

        let action_id = record_row_only(&conn, "b1", None, "move", Some("D:/FIXTURE/track1.mp3"), Some("D:/FIXTURE/renamed/track1.flac"), None).unwrap();
        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", action_id);

        let (track_id, candidates, status): (Option<String>, String, String) = conn
            .query_row(
                "SELECT track_id, candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("one ambiguous row inserted");
        assert_eq!(track_id, None);
        let mut ids: Vec<&str> = candidates.split(',').collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["40000001", "40000002"]);
        assert_eq!(status, "ambiguous");
    }

    #[test]
    fn detect_masterdb_repair_no_op_when_no_xml_linked() {
        let conn = db();
        let action_id = record_row_only(&conn, "b1", None, "move", Some("D:/FIXTURE/track1.mp3"), Some("D:/FIXTURE/renamed/track1.flac"), None).unwrap();
        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", action_id);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_repairs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_repair_second_call_same_action_id_does_not_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let action_id = record_row_only(&conn, "b1", None, "move", Some("D:/FIXTURE/track1.mp3"), Some("D:/FIXTURE/renamed/track1.flac"), None).unwrap();

        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", action_id);
        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", action_id);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_repairs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    fn seed_sift_track(conn: &Connection, path: &str) -> i64 {
        conn.execute("INSERT INTO tracks(path, status) VALUES(?1, 'pending')", params![path]).unwrap();
        conn.last_insert_rowid()
    }

    fn some_values() -> MetadataSyncValues {
        MetadataSyncValues {
            artist: Some("Larry Heard".to_string()),
            title: Some("Mystery of Love".to_string()),
            label: Some("Alleviated".to_string()),
            year: Some(1985),
            genre: Some("House".to_string()),
        }
    }

    #[allow(clippy::type_complexity)]
    #[test]
    fn detect_masterdb_metadata_sync_records_pending_on_single_match() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();

        detect_masterdb_metadata_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, &some_values(), action_id);

        let (got_action_id, rb_track_id, candidates, new_artist, new_title, new_label, new_year, new_genre, status): (
            i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>, Option<String>, String,
        ) = conn
            .query_row(
                "SELECT action_id, rekordbox_track_id, candidate_track_ids, new_artist, new_title, new_label, new_year, new_genre, status
                 FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
            )
            .expect("one metadata sync row inserted");
        assert_eq!(got_action_id, action_id);
        assert_eq!(rb_track_id, Some("40000001".to_string()));
        assert_eq!(candidates, None);
        assert_eq!(new_artist, Some("Larry Heard".to_string()));
        assert_eq!(new_title, Some("Mystery of Love".to_string()));
        assert_eq!(new_label, Some("Alleviated".to_string()));
        assert_eq!(new_year, Some(1985));
        assert_eq!(new_genre, Some("House".to_string()));
        assert_eq!(status, "pending");
    }

    #[test]
    fn detect_masterdb_metadata_sync_no_match_inserts_nothing() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/nowhere/nope.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/nowhere/nope.mp3"), None, None).unwrap();

        detect_masterdb_metadata_sync_if_linked(&conn, "D:/nowhere/nope.mp3", track_id, &some_values(), action_id);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_metadata_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_metadata_sync_ambiguous_on_two_matches() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // Same collision technique as detect_masterdb_repair_ambiguous_on_two_matches.
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2.execute("UPDATE djmdContent SET FolderPath='D:/FIXTURE/track1.mp3' WHERE ID='40000002'", []).unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();

        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_metadata_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, &some_values(), action_id);

        let (rb_track_id, candidates, status): (Option<String>, String, String) = conn
            .query_row(
                "SELECT rekordbox_track_id, candidate_track_ids, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("one ambiguous row inserted");
        assert_eq!(rb_track_id, None);
        let mut ids: Vec<&str> = candidates.split(',').collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["40000001", "40000002"]);
        assert_eq!(status, "ambiguous");
    }

    #[test]
    fn detect_masterdb_metadata_sync_no_op_when_no_xml_linked() {
        let conn = db();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_metadata_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, &some_values(), action_id);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_metadata_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_metadata_sync_second_call_replaces_row_not_duplicates() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id_1 = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_metadata_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, &some_values(), action_id_1);

        // Mark it applied, then retag again — a fresh retag must resurrect it as pending,
        // not leave the stale 'applied' row untouched.
        conn.execute("UPDATE rekordbox_masterdb_metadata_syncs SET status='applied' WHERE track_id=?1", params![track_id]).unwrap();
        let row_id_before: i64 = conn.query_row("SELECT id FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1", params![track_id], |r| r.get(0)).unwrap();

        let action_id_2 = record_row_only(&conn, "b2", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        let new_values = MetadataSyncValues { artist: Some("New Artist".to_string()), title: None, label: None, year: None, genre: None };
        detect_masterdb_metadata_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, &new_values, action_id_2);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_metadata_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "must replace, never accumulate");
        let (row_id_after, action_id, new_artist, status): (i64, i64, Option<String>, String) = conn
            .query_row(
                "SELECT id, action_id, new_artist, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row_id_after, row_id_before, "id must stay stable across a replace");
        assert_eq!(action_id, action_id_2);
        assert_eq!(new_artist, Some("New Artist".to_string()));
        assert_eq!(status, "pending", "must fall back to pending even though the previous row was applied");
    }

    #[test]
    fn detect_masterdb_artwork_sync_records_pending_on_single_match() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();

        detect_masterdb_artwork_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, "/cache/covers/999.jpg", action_id);

        let (got_action_id, rb_track_id, candidates, cover_path, status): (
            i64, Option<String>, Option<String>, String, String,
        ) = conn
            .query_row(
                "SELECT action_id, rekordbox_track_id, candidate_track_ids, cover_path, status
                 FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .expect("one artwork sync row inserted");
        assert_eq!(got_action_id, action_id);
        assert_eq!(rb_track_id, Some("40000001".to_string()));
        assert_eq!(candidates, None);
        assert_eq!(cover_path, "/cache/covers/999.jpg");
        assert_eq!(status, "pending");
    }

    #[test]
    fn detect_masterdb_artwork_sync_no_match_inserts_nothing() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/nowhere/nope.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/nowhere/nope.mp3"), None, None).unwrap();

        detect_masterdb_artwork_sync_if_linked(&conn, "D:/nowhere/nope.mp3", track_id, "/cache/covers/999.jpg", action_id);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_artwork_sync_ambiguous_on_two_matches() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // Same collision technique as detect_masterdb_metadata_sync_ambiguous_on_two_matches.
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2.execute("UPDATE djmdContent SET FolderPath='D:/FIXTURE/track1.mp3' WHERE ID='40000002'", []).unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();

        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_artwork_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, "/cache/covers/999.jpg", action_id);

        let (rb_track_id, candidates, status): (Option<String>, String, String) = conn
            .query_row(
                "SELECT rekordbox_track_id, candidate_track_ids, status FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("one ambiguous row inserted");
        assert_eq!(rb_track_id, None);
        let mut ids: Vec<&str> = candidates.split(',').collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["40000001", "40000002"]);
        assert_eq!(status, "ambiguous");
    }

    #[test]
    fn detect_masterdb_artwork_sync_no_op_when_no_xml_linked() {
        let conn = db();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_artwork_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, "/cache/covers/999.jpg", action_id);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_artwork_sync_second_call_replaces_row_not_duplicates() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();
        let track_id = seed_sift_track(&conn, "D:/FIXTURE/track1.mp3");
        let action_id_1 = record_row_only(&conn, "b1", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_artwork_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, "/cache/covers/old.jpg", action_id_1);

        conn.execute("UPDATE rekordbox_masterdb_artwork_syncs SET status='applied' WHERE track_id=?1", params![track_id]).unwrap();
        let row_id_before: i64 = conn.query_row("SELECT id FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", params![track_id], |r| r.get(0)).unwrap();

        let action_id_2 = record_row_only(&conn, "b2", Some(track_id), "tag_edit", Some("D:/FIXTURE/track1.mp3"), None, None).unwrap();
        detect_masterdb_artwork_sync_if_linked(&conn, "D:/FIXTURE/track1.mp3", track_id, "/cache/covers/new.jpg", action_id_2);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "must replace, never accumulate");
        let (row_id_after, action_id, cover_path, status): (i64, i64, String, String) = conn
            .query_row(
                "SELECT id, action_id, cover_path, status FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![track_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(row_id_after, row_id_before, "id must stay stable across a replace");
        assert_eq!(action_id, action_id_2);
        assert_eq!(cover_path, "/cache/covers/new.jpg");
        assert_eq!(status, "pending", "must fall back to pending even though the previous row was applied");
    }
}
