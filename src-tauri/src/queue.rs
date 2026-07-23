//! Read model for the "to process" queue = tracks WHERE status='pending'.
use rusqlite::Connection;
use serde::Serialize;

// The backend only maintains `analysis_attempts` (persist_failure increments it, reset_analysis
// clears it). The terminal-state threshold that drops a stuck track from the "Non analysés (N)"
// count is a frontend display rule — its single source of truth is MAX_ANALYSIS_ATTEMPTS in
// shared/contracts.ts, not duplicated here.

/// One row in the live queue. `verdict` is NULL until the worker (M2b) analyses it.
#[derive(Debug, Serialize, PartialEq)]
pub struct QueueItem {
    pub id: i64,
    pub path: String,
    pub filename: Option<String>,
    pub source_id: Option<i64>,
    pub verdict: Option<String>,
    /// Declared rail ("lossless" | "lossy" | "unknown"), NULL until analysed. Drives the batch
    /// grouping + output format (lossless → AIFF, lossy → MP3 320). Stored in `real_quality`.
    pub rail: Option<String>,
    /// Identified artist/title from the `metadata` table (NULL until identified). Lets the batch
    /// list show the file's name BEFORE (filename) next to the Discogs name AFTER.
    pub artist: Option<String>,
    pub title: Option<String>,
    /// True when this track shares a name with another pending/filed track (dedup name
    /// pre-filter). Set by the IPC layer (see ipc::list_queue), default false.
    #[serde(default)]
    pub dup: bool,
    /// True when there's no CURRENT, usable verdict to show for this track — either the worker
    /// hasn't gotten to it yet / needs to redo it (`analyzed_at IS NULL OR report_json IS NULL`,
    /// worker::select_pending's own pick-up condition — covers a fresh scan AND a content-change
    /// re-pending, which resets these two but leaves the OLD verdict in place), OR it's a
    /// permanently-stuck decode failure: `persist_failure` (worker.rs) sets `analyzed_at` and
    /// `report_json=''` (a non-NULL sentinel, precisely so select_pending's own condition never
    /// re-selects it forever) while leaving `verdict` NULL — the worker will NEVER retry that one
    /// on its own, so `verdict IS NULL` is included too, specifically to keep surfacing it for a
    /// manual retry (reanalyze_tracks). Single source of truth for "offer a re-analyze affordance
    /// here" across the whole app — never re-derive this from `verdict` alone in the frontend
    /// (caught in review: an earlier version of this field mirrored ONLY select_pending's
    /// condition and silently excluded every decode-failed track from the retry UI meant for
    /// exactly that case).
    pub needs_analysis: bool,
    /// How many times analysis has failed for this track (worker::persist_failure increments it,
    /// reset_analysis clears it). The frontend treats it as terminally broken past a threshold
    /// (MAX_ANALYSIS_ATTEMPTS in shared/contracts.ts): still individually retryable, but excluded
    /// from the count/bulk-retry so a genuinely unrepairable file stops inflating "Non analysés (N)".
    pub analysis_attempts: i64,
}

/// All pending tracks, oldest first.
pub fn list_pending(conn: &Connection) -> rusqlite::Result<Vec<QueueItem>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.filename, t.source_id, t.verdict, t.real_quality, m.artist, m.title,
                (t.verdict IS NULL OR t.analyzed_at IS NULL OR t.report_json IS NULL),
                t.analysis_attempts
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id
         WHERE t.status='pending' ORDER BY t.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(QueueItem {
            id: r.get(0)?,
            path: r.get(1)?,
            filename: r.get(2)?,
            source_id: r.get(3)?,
            verdict: r.get(4)?,
            rail: r.get(5)?,
            artist: r.get(6)?,
            title: r.get(7)?,
            dup: false,
            needs_analysis: r.get(8)?,
            analysis_attempts: r.get(9)?,
        })
    })?;
    rows.collect()
}

/// Forces re-analysis of the given tracks: clears `verdict`/`report_json`/`analyzed_at` (plus
/// the two failure-marker columns `persist_failure` sets) and zeroes `analysis_attempts` so a
/// manual retry gives the track a fresh set of attempts, then `worker::select_pending` picks them
/// back up on the next refill. Only touches rows still `status='pending'` — a filed/écarté track
/// is left alone even if its id is passed in by mistake (no accidental resurrection).
///
/// Runs in a single transaction with one prepared statement: the bulk "Réanalyser (N)" caller can
/// pass thousands of ids, and doing N separately-committed UPDATEs while holding the global DB
/// mutex (a) stalls the worker pool behind N fsyncs and (b) leaves the queue half-reset with no
/// rollback if one statement fails midway (review-caught).
pub fn reset_analysis(conn: &Connection, track_ids: &[i64]) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    {
        let mut stmt = tx.prepare(
            "UPDATE tracks SET verdict=NULL, report_json=NULL, analyzed_at=NULL,
                codec_error=NULL, container_ok=NULL, analysis_attempts=0
             WHERE id=?1 AND status='pending'",
        )?;
        for id in track_ids {
            n += stmt.execute(rusqlite::params![id])?;
        }
    }
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn list_pending_returns_only_pending() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks (path, filename, status) VALUES ('a.mp3','a.mp3','pending')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (path, filename, status) VALUES ('b.mp3','b.mp3','filed')",
            [],
        )
        .unwrap();
        let q = list_pending(&conn).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].filename, Some("a.mp3".to_string()));
    }

    /// Mirrors shared/contracts.ts's `QueueItem`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn queue_item_shape_matches_contracts_ts() {
        let v = QueueItem {
            id: 0,
            path: String::new(),
            filename: None,
            source_id: None,
            verdict: None,
            rail: None,
            artist: None,
            title: None,
            dup: false,
            needs_analysis: true,
            analysis_attempts: 0,
        };
        let QueueItem {
            id,
            path,
            filename,
            source_id,
            verdict,
            rail,
            artist,
            title,
            dup,
            needs_analysis,
            analysis_attempts,
        } = v;
        let _ = (
            id,
            path,
            filename,
            source_id,
            verdict,
            rail,
            artist,
            title,
            dup,
            needs_analysis,
            analysis_attempts,
        );
    }

    #[test]
    fn needs_analysis_true_for_a_permanent_decode_failure() {
        // Mirrors worker::persist_failure exactly: analyzed_at + report_json='' (non-NULL
        // sentinel, so select_pending never re-selects it on its own), verdict left NULL. Caught
        // in review: an earlier version of `needs_analysis` mirrored ONLY select_pending's pick-up
        // condition and was FALSE here, silently hiding every decode-failed track from the manual
        // retry UI built specifically for this case.
        let conn = db();
        conn.execute(
            "INSERT INTO tracks (path, filename, status, verdict, report_json, analyzed_at, codec_error)
             VALUES ('bad.mp3','bad.mp3','pending',NULL,'','2026-01-01','decode failed')",
            [],
        )
        .unwrap();
        let q = list_pending(&conn).unwrap();
        assert_eq!(q.len(), 1);
        assert!(
            q[0].needs_analysis,
            "a persist_failure row (verdict NULL, analyzed_at/report_json SET) must still be \
             surfaced for manual retry, since the worker will never auto-retry it"
        );
    }

    #[test]
    fn reset_analysis_only_touches_pending_rows() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks (path, filename, status, verdict, report_json, analyzed_at)
             VALUES ('a.mp3','a.mp3','pending','ok','{}','2026-01-01')",
            [],
        )
        .unwrap();
        let pending_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tracks (path, filename, status, verdict, report_json, analyzed_at)
             VALUES ('b.mp3','b.mp3','filed','ok','{}','2026-01-01')",
            [],
        )
        .unwrap();
        let filed_id = conn.last_insert_rowid();

        // Give the pending row a non-zero attempt counter so we can prove reset clears it.
        conn.execute(
            "UPDATE tracks SET analysis_attempts=2 WHERE id=?1",
            rusqlite::params![pending_id],
        )
        .unwrap();

        let n = reset_analysis(&conn, &[pending_id, filed_id]).unwrap();
        assert_eq!(n, 1, "only the pending row should be reset");

        let attempts: i64 = conn
            .query_row(
                "SELECT analysis_attempts FROM tracks WHERE id=?1",
                rusqlite::params![pending_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            attempts, 0,
            "a manual reset gives the track a fresh attempt count"
        );

        let q = list_pending(&conn).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].verdict, None);
        assert!(
            q[0].needs_analysis,
            "reset row must be picked up by select_pending's condition"
        );

        // The filed row's verdict is untouched (it never left `pending` filter results either).
        let filed_verdict: Option<String> = conn
            .query_row(
                "SELECT verdict FROM tracks WHERE id=?1",
                rusqlite::params![filed_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(filed_verdict, Some("ok".to_string()));
    }

    #[test]
    fn reset_analysis_makes_the_track_selectable_again() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks (path, filename, status, verdict, report_json, analyzed_at)
             VALUES ('a.mp3','a.mp3','pending','ok','{}','2026-01-01')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        assert!(
            crate::worker::select_pending(&conn).unwrap().is_empty(),
            "already-analysed track shouldn't be selected for (re)analysis yet"
        );

        reset_analysis(&conn, &[id]).unwrap();

        assert_eq!(crate::worker::select_pending(&conn).unwrap(), vec![id]);
    }
}
