//! Background analysis worker. A small thread pool drains pending, not-yet-analysed tracks,
//! runs the M2a engine OFF the DB lock, writes the scalar results back, and pings the UI.
//! Distinct from `watcher.rs` (which feeds the queue); this one consumes it.
use crate::analysis::{self, AnalysisReport, Rail, Verdict};
use rusqlite::Connection;
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{AppHandle, Emitter, Manager};

struct Queue {
    deque: VecDeque<i64>,
    queued: HashSet<i64>, // ids in the deque OR in-flight (prevents double-enqueue)
    running: usize,
    shutdown: bool,
}

/// Managed state: the shared work queue + a condvar the worker threads park on.
pub struct AnalysisWorker {
    inner: Arc<(Mutex<Queue>, Condvar)>,
}

fn rail_str(r: Rail) -> &'static str {
    match r {
        Rail::Lossless => "lossless",
        Rail::Lossy => "lossy",
        Rail::Unknown => "unknown",
    }
}

fn verdict_str(v: Verdict) -> &'static str {
    match v {
        Verdict::Ok => "ok",
        Verdict::Fake => "fake",
        Verdict::Grey => "grey",
    }
}

/// Ids of tracks that still need analysis: pending and either never analysed OR analysed
/// before the report cache existed (report_json NULL) — so every track ends up with a cached
/// report and opening it is always instant. (`persist_failure` sets report_json='' so broken
/// files don't loop here.)
pub fn select_pending(conn: &Connection) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM tracks WHERE status='pending' AND (analyzed_at IS NULL OR report_json IS NULL) ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
    rows.collect()
}

/// (done, total): total = current pending; done = pending already analysed.
pub fn progress(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    let total: i64 = conn.query_row(
        "SELECT count(*) FROM tracks WHERE status='pending'",
        [],
        |r| r.get(0),
    )?;
    let done: i64 = conn.query_row(
        "SELECT count(*) FROM tracks WHERE status='pending' AND analyzed_at IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    Ok((done, total))
}

/// Writes a full report into the track row and stamps `analyzed_at`.
pub fn persist_report(conn: &Connection, id: i64, r: &AnalysisReport) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tracks SET
            verdict=?2, cutoff_hz=?3, bitrate=?4, declared_fmt=?5, real_quality=?6, duration=?7,
            clip_runs=?8, clip_pct=?9, true_peak_dbtp=?10, dc_offset=?11, phase_correlation=?12,
            dual_mono=?13, truncated=?14, silence_head_ms=?15, silence_tail_ms=?16,
            container_ok=?17, codec_error=?18, id3_version=?19, has_cover=?20, tags_cdj_ok=?21,
            report_json=?22, report_cache_ver=?23, analyzed_at=datetime('now')
         WHERE id=?1",
        rusqlite::params![
            id,
            verdict_str(r.verdict),
            r.cutoff_hz,
            r.declared_bitrate,
            r.declared_format,
            rail_str(r.declared_rail),
            r.duration_sec,
            r.clip_runs,
            r.clip_pct,
            r.true_peak_dbtp,
            r.dc_offset,
            r.phase_correlation,
            r.dual_mono as i64,
            r.truncated as i64,
            r.silence_head_ms,
            r.silence_tail_ms,
            r.container_ok as i64,
            r.codec_error,
            r.id3_version,
            r.has_cover as i64,
            r.tags_cdj_ok as i64,
            // cache the full report, spectrogram included (FIX-3) — instant re-open AND instant
            // spectrogram, no re-decode either way
            serde_json::to_string(r).unwrap_or_default(),
            analysis::REPORT_CACHE_VERSION,
        ],
    )?;
    Ok(())
}

/// Marks a track analysed-but-failed so the worker doesn't loop on a broken file.
fn persist_failure(conn: &Connection, id: i64, err: &str) -> rusqlite::Result<()> {
    // Set report_json='' (non-null sentinel) so this broken file isn't re-selected forever
    // by select_pending's `report_json IS NULL` backfill clause.
    // Also clear `verdict` (review-caught bug: this UPDATE used to leave it untouched — a track
    // that had a real verdict from a PRIOR successful analysis, then had its content change
    // (scanner.rs resets analyzed_at/report_json but keeps the old verdict), then failed on
    // re-analysis here, kept displaying that stale verdict as if it were still current/valid,
    // and `queue::QueueItem::needs_analysis` — verdict-aware specifically so a failure is never
    // silently invisible — had no way to tell the two apart). Invariant this restores: `verdict`
    // is non-NULL if and only if it reflects the CURRENT file's most recent successful analysis.
    //
    // Also NULL every derived analysis column a PRIOR successful run may have written (real_quality
    // drives the queue rail, plus cutoff/bitrate/loudness/tag facts): same staleness class as the
    // verdict — a failed re-analysis must not leave the old file's measurements presented as if they
    // were the current file's. Keep only the failure markers (container_ok=0, codec_error). Bump
    // analysis_attempts so a permanently-broken file eventually reaches a terminal state (frontend
    // threshold MAX_ANALYSIS_ATTEMPTS, shared/contracts.ts) instead of inflating "Non analysés (N)".
    conn.execute(
        "UPDATE tracks SET
            verdict=NULL, container_ok=0, codec_error=?2, report_json='',
            analyzed_at=datetime('now'), analysis_attempts=analysis_attempts+1,
            real_quality=NULL, cutoff_hz=NULL, bitrate=NULL, declared_fmt=NULL, duration=NULL,
            clip_runs=NULL, clip_pct=NULL, true_peak_dbtp=NULL, dc_offset=NULL,
            phase_correlation=NULL, dual_mono=NULL, truncated=NULL, silence_head_ms=NULL,
            silence_tail_ms=NULL, id3_version=NULL, has_cover=NULL, tags_cdj_ok=NULL,
            report_cache_ver=NULL
         WHERE id=?1",
        rusqlite::params![id, err],
    )?;
    Ok(())
}

/// Starts the worker pool and registers its managed state. Call once in setup, after the DB.
pub fn init(app: &AppHandle) {
    let n = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let worker = AnalysisWorker {
        inner: Arc::new((
            Mutex::new(Queue {
                deque: VecDeque::new(),
                queued: HashSet::new(),
                running: 0,
                shutdown: false,
            }),
            Condvar::new(),
        )),
    };
    let inner = worker.inner.clone();
    app.manage(worker);
    for _ in 0..n {
        let app2 = app.clone();
        let inner2 = inner.clone();
        std::thread::spawn(move || worker_loop(app2, inner2));
    }
    log::info!("analysis worker pool started ({n} threads)");
}

/// Enqueues every pending, not-yet-analysed track not already queued/in-flight, then wakes
/// the pool. Call at startup and after every `queue:changed`.
pub fn refill(app: &AppHandle) {
    let Some(worker) = app.try_state::<AnalysisWorker>() else {
        return;
    };
    let ids = {
        let state = app.state::<Mutex<Connection>>();
        let Ok(conn) = state.lock() else {
            log::error!("worker refill: DB connection mutex poisoned, skipping refill");
            return;
        };
        match select_pending(&conn) {
            Ok(v) => v,
            Err(e) => {
                log::error!("worker refill query failed: {e}");
                return;
            }
        }
    };
    let (m, cv) = &*worker.inner;
    let Ok(mut q) = m.lock() else { return };
    let mut added = 0;
    for id in ids {
        if q.queued.insert(id) {
            q.deque.push_back(id);
            added += 1;
        }
    }
    if added > 0 {
        cv.notify_all();
    }
}

/// Blocks until an id is available (or shutdown). Increments `running` for the popped id.
fn pop(inner: &Arc<(Mutex<Queue>, Condvar)>) -> Option<i64> {
    let (m, cv) = &**inner;
    let mut q = m.lock().ok()?;
    loop {
        if q.shutdown {
            return None;
        }
        if let Some(id) = q.deque.pop_front() {
            q.running += 1;
            return Some(id);
        }
        q = cv.wait(q).ok()?;
    }
}

/// Marks an id done: drops it from `queued` (so a later content-change can re-enqueue it)
/// and decrements `running`.
fn finish(inner: &Arc<(Mutex<Queue>, Condvar)>, id: i64) {
    let (m, _) = &**inner;
    if let Ok(mut q) = m.lock() {
        q.queued.remove(&id);
        q.running = q.running.saturating_sub(1);
    }
}

fn read_path(app: &AppHandle, id: i64) -> Option<String> {
    let state = app.state::<Mutex<Connection>>();
    let conn = match state.lock() {
        Ok(conn) => conn,
        Err(_) => {
            log::error!("worker read_path({id}): DB connection mutex poisoned");
            return None;
        }
    };
    conn.query_row(
        "SELECT path FROM tracks WHERE id=?1",
        rusqlite::params![id],
        |r| r.get(0),
    )
    .ok()
}

/// Locks the DB briefly and writes the analysis outcome for `id`.
fn persist_result(app: &AppHandle, id: i64, path: &str, result: Result<AnalysisReport, String>) {
    let state = app.state::<Mutex<Connection>>();
    let Ok(conn) = state.lock() else {
        log::error!(
            "worker persist_result({id}, {path}): DB connection mutex poisoned, result lost"
        );
        return;
    };
    let written = match &result {
        Ok(rep) => persist_report(&conn, id, rep),
        Err(e) => {
            log::warn!("analyze failed for {path}: {e}");
            persist_failure(&conn, id, e)
        }
    };
    // Don't drop the write silently: if the DB was busy/locked the track stays
    // analysed_at=NULL and gets picked up again by the next refill (queue:changed/scan),
    // but surface it so a persistent failure is visible rather than invisible.
    if let Err(e) = written {
        log::error!("persist failed for {path} (id {id}), will retry on next refill: {e}");
    }
}

fn worker_loop(app: AppHandle, inner: Arc<(Mutex<Queue>, Condvar)>) {
    while let Some(id) = pop(&inner) {
        if let Some(path) = read_path(&app, id) {
            // Heavy work runs WITHOUT holding the DB lock — UI stays responsive.
            // FIX-3: collect the display spectrogram here too (bounded ~200KB, the FFT itself
            // already runs regardless of this flag — see SpectrumAccumulator::new) so it's
            // cached in report_json and the Revue spectrogram click never has to re-decode.
            // analyze() decodes arbitrary user-supplied audio files (Symphonia/FFT); catch a
            // panic here so one corrupt file doesn't silently kill this pool thread forever.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                analysis::analyze(&path, true)
            }))
            .unwrap_or_else(|payload| {
                let msg = payload
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".to_string());
                log::error!("analyze panicked for {path} (id {id}): {msg}");
                Err(format!("analysis panicked: {msg}"))
            });
            persist_result(&app, id, &path, result);
        }
        finish(&inner, id);
        app.emit("analysis:changed", ()).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{AnalysisReport, Rail, Spectrogram, Verdict};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn.execute("INSERT INTO sources (path) VALUES ('root')", [])
            .unwrap();
        conn
    }

    fn add_pending(conn: &Connection, path: &str) -> i64 {
        conn.execute(
            "INSERT INTO tracks (path, source_id, status) VALUES (?1, 1, 'pending')",
            rusqlite::params![path],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn fake_report() -> AnalysisReport {
        AnalysisReport {
            path: "x.flac".into(),
            sample_rate: 44100,
            channels: 2,
            duration_sec: 123.0,
            declared_format: "flac".into(),
            declared_bitrate: Some(900),
            declared_rail: Rail::Lossless,
            cutoff_hz: 16000.0,
            verdict: Verdict::Fake,
            container_mismatch: false,
            est_kbps: 128,
            peaks: vec![],
            spectrogram: Spectrogram {
                frames: 0,
                bins: 0,
                hz_per_bin: 0.0,
                sec_per_frame: 0.0,
                mag_db: vec![],
            },
            clip_runs: 2,
            clip_pct: 1.5,
            true_peak_dbtp: -0.3,
            dc_offset: 0.001,
            phase_correlation: 0.8,
            dual_mono: false,
            container_ok: true,
            codec_error: None,
            truncated: false,
            silence_head_ms: 10,
            silence_tail_ms: 20,
            id3_version: Some("ID3".into()),
            tags_cdj_ok: true,
            has_cover: true,
        }
    }

    #[test]
    fn select_pending_returns_unanalysed_or_uncached() {
        let conn = db();
        let a = add_pending(&conn, "a.flac"); // never analysed → selected
        let b = add_pending(&conn, "b.flac"); // analysed + report cached → NOT selected
        let c = add_pending(&conn, "c.flac"); // filed → NOT selected
        let d = add_pending(&conn, "d.flac"); // analysed but no report cache → selected (backfill)
        conn.execute(
            "UPDATE tracks SET analyzed_at=datetime('now'), report_json='{}' WHERE id=?1",
            [b],
        )
        .unwrap();
        conn.execute("UPDATE tracks SET status='filed' WHERE id=?1", [c])
            .unwrap();
        conn.execute(
            "UPDATE tracks SET analyzed_at=datetime('now') WHERE id=?1",
            [d],
        )
        .unwrap();
        assert_eq!(select_pending(&conn).unwrap(), vec![a, d]);
    }

    #[test]
    fn persist_report_writes_columns_and_marks_analysed() {
        let conn = db();
        let id = add_pending(&conn, "x.flac");
        persist_report(&conn, id, &fake_report()).unwrap();
        let (verdict, cutoff, dual, analyzed): (String, f64, i64, Option<String>) = conn
            .query_row(
                "SELECT verdict, cutoff_hz, dual_mono, analyzed_at FROM tracks WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(verdict, "fake");
        assert!((cutoff - 16000.0).abs() < 1e-3);
        assert_eq!(dual, 0);
        assert!(analyzed.is_some(), "analyzed_at stamped");
        // and it leaves select_pending empty now
        assert!(select_pending(&conn).unwrap().is_empty());
    }

    #[test]
    fn persist_failure_clears_a_stale_verdict_from_a_prior_success() {
        // Review-caught bug: a track that succeeded once (real verdict), then had its content
        // change (scanner.rs resets analyzed_at/report_json but leaves the old verdict), then
        // failed on re-analysis, used to keep displaying that now-STALE verdict as if it were
        // still current — persist_failure never touched the `verdict` column. Invariant this
        // test locks in: verdict is non-NULL iff it reflects the file's most recent successful
        // analysis, never a leftover from before a later failure.
        let conn = db();
        let id = add_pending(&conn, "x.flac");
        persist_report(&conn, id, &fake_report()).unwrap(); // first pass: succeeds, verdict="fake"
        conn.execute(
            "UPDATE tracks SET analyzed_at=NULL, report_json=NULL WHERE id=?1", // content changed
            [id],
        )
        .unwrap();
        persist_failure(&conn, id, "decode error").unwrap(); // second pass: fails

        let verdict: Option<String> = conn
            .query_row("SELECT verdict FROM tracks WHERE id=?1", [id], |r| r.get(0))
            .unwrap();
        assert_eq!(
            verdict, None,
            "a failed re-analysis must clear the old verdict, not leave it stale"
        );
    }

    #[test]
    fn persist_failure_bumps_attempts_and_clears_stale_derived_columns() {
        // A track analysed OK once (real_quality set, drives the queue rail), then its content
        // changes and re-analysis fails: the old rail/measurements must not survive as if current,
        // and the attempt counter must climb toward the terminal MAX_ANALYSIS_ATTEMPTS.
        let conn = db();
        let id = add_pending(&conn, "x.flac");
        persist_report(&conn, id, &fake_report()).unwrap(); // real_quality="lossless", etc.

        persist_failure(&conn, id, "decode error").unwrap();
        let (rq, attempts): (Option<String>, i64) = conn
            .query_row(
                "SELECT real_quality, analysis_attempts FROM tracks WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            rq, None,
            "stale rail (real_quality) must be cleared on failure"
        );
        assert_eq!(
            attempts, 1,
            "each failed analysis increments the attempt counter"
        );

        persist_failure(&conn, id, "decode error again").unwrap();
        let attempts2: i64 = conn
            .query_row(
                "SELECT analysis_attempts FROM tracks WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            attempts2, 2,
            "attempts accumulate across successive failures"
        );
    }

    #[test]
    fn progress_counts_done_over_total() {
        let conn = db();
        let _a = add_pending(&conn, "a.flac");
        let b = add_pending(&conn, "b.flac");
        persist_report(&conn, b, &fake_report()).unwrap();
        assert_eq!(progress(&conn).unwrap(), (1, 2));
    }
}
