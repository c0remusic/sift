//! Phase 3 measurement-only benchmark (docs/superpowers/specs/2026-07-13-architecture-evolution-design.md,
//! section 6). Measures real latency of `library::list_filed` / `queue::list_pending` at 15k and
//! 100k rows on a synthetic-but-varied dataset, plus `EXPLAIN QUERY PLAN` and JSON serialization
//! size — no pagination code, no production behaviour change. Compiled only in test builds
//! (`#[cfg(test)] mod bench_volume;` in lib.rs), never shipped in the release binary.
//!
//! Run with: `cargo test --release -- --ignored --nocapture bench_volume`
//! (release build matters: these numbers are meaningless in an unoptimised debug build).

use rusqlite::Connection;
use std::time::{Duration, Instant};

use crate::library::{self, LibraryFilter};
use crate::queue;

// ── synthetic dataset ────────────────────────────────────────────────────────

const FIRST_NAMES: [&str; 25] = [
    "Marcus", "Aya", "Kaito", "Solene", "Devon", "Nadia", "Ronan", "Priya", "Elias", "Yuki",
    "Camille", "Tobias", "Zara", "Idris", "Mireille", "Kenji", "Anouk", "Femi", "Leila", "Ozzy",
    "Ingrid", "Malik", "Rosa", "Viggo", "Chidi",
];
const LAST_NAMES: [&str; 20] = [
    "Reyes", "Okafor", "Lindqvist", "Dubois", "Kowalski", "Haddad", "Moreau", "Nakamura",
    "Ferreira", "Novak", "Adeyemi", "Bianchi", "Larsen", "Petrov", "Costa", "Herrera", "Weiss",
    "Diallo", "Kimura", "Santos",
];

/// Genre pool. "House" is index 0 so the genre-filter benchmark can target a value guaranteed
/// to exist in the dataset without depending on the assignment formula below.
const GENRES: [&str; 30] = [
    "House", "Deep House", "Tech House", "Techno", "Minimal", "Melodic Techno", "Disco",
    "Nu Disco", "Funk", "Soul", "Drum and Bass", "Jungle", "Breakbeat", "Garage", "UK Garage",
    "Dubstep", "Ambient", "Downtempo", "Trance", "Progressive House", "Electro", "Acid House",
    "Italo Disco", "Boogie", "Afrobeat", "Amapiano", "Jazz Fusion", "Trip Hop", "IDM", "Hard Techno",
];

fn artist_for(i: usize) -> String {
    let first = FIRST_NAMES[(i * 7 + 3) % FIRST_NAMES.len()];
    let last = LAST_NAMES[(i * 11 + 5) % LAST_NAMES.len()];
    format!("{first} {last}")
}

/// Format pool, weighted toward mp3 like a real catalogue: 3/5 mp3, 1/5 each aiff/flac/wav.
fn format_for(i: usize) -> &'static str {
    match i % 5 {
        0 => "aiff",
        1 => "flac",
        2 => "wav",
        _ => "mp3",
    }
}

fn bitrate_for(format: &str, i: usize) -> i64 {
    if format == "mp3" {
        [128, 192, 256, 320][i % 4]
    } else {
        1411
    }
}

/// ~80% ok, ~10% fake, ~10% grey.
fn verdict_for(i: usize) -> &'static str {
    match i % 10 {
        0 => "fake",
        1 => "grey",
        _ => "ok",
    }
}

/// 1-3 genres per track, indices spaced by 10 (mod 30) so they're always distinct — avoids a
/// PRIMARY KEY(track_id, genre) collision when g_count == 3.
fn genres_for(i: usize) -> Vec<&'static str> {
    let base = (i * 7) % GENRES.len();
    let count = 1 + (i % 3);
    (0..count).map(|g| GENRES[(base + g * 10) % GENRES.len()]).collect()
}

/// Inserts `n` synthetic tracks, `filed_fraction` of them 'filed' and the rest 'pending'
/// (interleaved via `i % 1000`, not a block split, so the two statuses are spread across the
/// id range like a real catalogue rather than clustered). Metadata + genres inserted alongside,
/// batched in one transaction for insert speed (irrelevant to the measured queries, but keeps
/// dataset setup itself fast).
///
/// `filed_fraction` is NOT fixed at the originally-planned 50/50: see
/// `debug_print_sqlite_variable_limit` and the "SQLite bound-parameter limit" finding in
/// docs/superpowers/plans/2026-07-14-phase3-measurement-report.md — `library::list_filed`'s
/// batched genre lookup (`genres::get_genres_batch`, one bound `?` per filed row in a single
/// `IN (...)`) hits SQLite's 32766-parameter limit and returns an `Err` once the filed set is
/// close to/above that size. The main benchmark run uses a fraction low enough to stay under it
/// at both volumes (comparable across 15k/100k); a separate block reproduces the crash directly
/// at a realistic 50% to document it with a real error message.
fn seed_dataset(conn: &mut Connection, n: usize, filed_fraction: f64) -> rusqlite::Result<()> {
    let filed_permille = (filed_fraction * 1000.0).round() as usize;
    let tx = conn.transaction()?;
    {
        let mut ins_track = tx.prepare(
            "INSERT INTO tracks
                (id, path, format, bitrate, duration, verdict, status, folder, has_cover, filename)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )?;
        let mut ins_meta = tx.prepare(
            "INSERT INTO metadata (track_id, artist, title, label, year, bpm)
             VALUES (?1,?2,?3,?4,?5,?6)",
        )?;
        let mut ins_genre = tx.prepare(
            "INSERT INTO track_genres (track_id, genre, ord) VALUES (?1,?2,?3)",
        )?;

        for i in 0..n {
            let id = (i + 1) as i64;
            let format = format_for(i);
            let bitrate = bitrate_for(format, i);
            let duration = 120.0 + (i % 300) as f64 * 1.3;
            let verdict = verdict_for(i);
            let status = if (i % 1000) < filed_permille { "filed" } else { "pending" };
            let folder = if status == "filed" {
                Some(format!("Folder{}", i % 15))
            } else {
                None
            };
            let has_cover = (i % 3 == 0) as i64;
            let path = format!("/lib/{status}/{id}.{format}");
            let filename = format!("{id}.{format}");

            ins_track.execute(rusqlite::params![
                id, path, format, bitrate, duration, verdict, status, folder, has_cover, filename,
            ])?;

            let artist = artist_for(i);
            let title = format!("Track {id}");
            let label = format!("Label{}", i % 40);
            let year = 1985 + (i % 40) as i64;
            let bpm = 100 + (i % 45) as i64;
            ins_meta.execute(rusqlite::params![id, artist, title, label, year, bpm])?;

            for (ord, genre) in genres_for(i).into_iter().enumerate() {
                ins_genre.execute(rusqlite::params![id, genre, ord as i64])?;
            }
        }
    }
    tx.commit()
}

/// Opens a fresh temp-file SQLite DB, runs real migrations, seeds `n` tracks.
/// The `NamedTempFile` deletes its file on drop — no manual cleanup needed (Step 6).
fn build_dataset(n: usize, filed_fraction: f64) -> (tempfile::NamedTempFile, Connection) {
    let tmp = tempfile::NamedTempFile::new().expect("create temp db file");
    let mut conn = crate::db::open(tmp.path()).expect("db open + migrate");
    seed_dataset(&mut conn, n, filed_fraction).expect("seed dataset");
    (tmp, conn)
}

// ── timing helpers ───────────────────────────────────────────────────────────

fn measure<F: FnMut()>(mut f: F, iters: usize) -> Vec<Duration> {
    let mut out = Vec::with_capacity(iters);
    for _ in 0..iters {
        let start = Instant::now();
        f();
        out.push(start.elapsed());
    }
    out
}

fn summarize(label: &str, mut durs: Vec<Duration>) {
    durs.sort();
    let min = durs[0];
    let max = durs[durs.len() - 1];
    let median = durs[durs.len() / 2];
    println!(
        "  {label:<40} min={:>8.2}ms  median={:>8.2}ms  max={:>8.2}ms",
        min.as_secs_f64() * 1000.0,
        median.as_secs_f64() * 1000.0,
        max.as_secs_f64() * 1000.0,
    );
}

const ITERS: usize = 5;

fn measure_queries(conn: &Connection, volume: usize) {
    println!("\n=== list_filed / list_pending latency @ {volume} rows ===");

    let base = LibraryFilter::default();
    summarize(
        "list_filed (no filter)",
        measure(|| { library::list_filed(conn, &base).unwrap(); }, ITERS),
    );

    let with_q = LibraryFilter { q: Some("a".to_string()), ..Default::default() };
    summarize(
        "list_filed (q LIKE, worst case)",
        measure(|| { library::list_filed(conn, &with_q).unwrap(); }, ITERS),
    );

    let with_genre = LibraryFilter { genre: Some("House".to_string()), ..Default::default() };
    summarize(
        "list_filed (genre IN subquery)",
        measure(|| { library::list_filed(conn, &with_genre).unwrap(); }, ITERS),
    );

    summarize(
        "list_pending",
        measure(|| { queue::list_pending(conn).unwrap(); }, ITERS),
    );
}

// ── EXPLAIN QUERY PLAN ───────────────────────────────────────────────────────

/// Mirrors the exact SQL text built by `library::list_filed`/`queue::list_pending` for each
/// filter combination (those functions build SQL dynamically and don't expose it, so the
/// strings are reproduced here for `EXPLAIN QUERY PLAN` purposes only — literal filter values
/// substituted directly since EXPLAIN QUERY PLAN never binds/executes real params).
fn explain(conn: &Connection, label: &str, sql: &str) {
    println!("\n-- EXPLAIN QUERY PLAN: {label} --");
    println!("   SQL: {sql}");
    let mut stmt = conn
        .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
        .expect("prepare explain");
    let rows = stmt
        .query_map([], |r| {
            let detail: String = r.get(3)?;
            Ok(detail)
        })
        .expect("query explain");
    for row in rows {
        println!("   {}", row.expect("explain row"));
    }
}

fn explain_all_queries(conn: &Connection) {
    explain(
        conn,
        "list_filed (no filter)",
        "SELECT t.id, t.path, t.format, t.bitrate, t.duration, t.verdict, t.folder, t.has_cover, \
         m.artist, m.title, m.label, m.year, m.bpm, m.cover_path, m.discogs_release_id \
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id \
         WHERE t.status = 'filed' ORDER BY m.artist, m.title, t.path",
    );
    explain(
        conn,
        "list_filed (q LIKE)",
        "SELECT t.id, t.path, t.format, t.bitrate, t.duration, t.verdict, t.folder, t.has_cover, \
         m.artist, m.title, m.label, m.year, m.bpm, m.cover_path, m.discogs_release_id \
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id \
         WHERE t.status = 'filed' AND (m.artist LIKE '%a%' OR m.title LIKE '%a%' OR t.path LIKE '%a%') \
         ORDER BY m.artist, m.title, t.path",
    );
    explain(
        conn,
        "list_filed (genre IN subquery)",
        "SELECT t.id, t.path, t.format, t.bitrate, t.duration, t.verdict, t.folder, t.has_cover, \
         m.artist, m.title, m.label, m.year, m.bpm, m.cover_path, m.discogs_release_id \
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id \
         WHERE t.status = 'filed' AND t.id IN (SELECT track_id FROM track_genres WHERE genre = 'House') \
         ORDER BY m.artist, m.title, t.path",
    );
    explain(
        conn,
        "list_pending",
        "SELECT t.id, t.path, t.filename, t.source_id, t.verdict, t.real_quality, m.artist, m.title \
         FROM tracks t LEFT JOIN metadata m ON m.track_id = t.id \
         WHERE t.status='pending' ORDER BY t.id",
    );
}

// ── JSON serialization proxy (IPC cost) ──────────────────────────────────────

fn measure_serialization(conn: &Connection) {
    let rows = library::list_filed(conn, &LibraryFilter::default()).unwrap();
    println!("\n=== JSON serialization proxy (list_filed, no filter, 100k dataset) ===");
    println!("  rows returned: {}", rows.len());

    let start = Instant::now();
    let json = serde_json::to_string(&rows).unwrap();
    let elapsed = start.elapsed();

    println!("  serialized size: {} bytes ({:.2} MB)", json.len(), json.len() as f64 / 1_048_576.0);
    println!("  serialization time: {:.2}ms", elapsed.as_secs_f64() * 1000.0);
    println!(
        "  NOTE: this is serde_json::to_string cost only (Tauri's actual IPC command \
         serialization), not a full IPC round-trip — that requires a running `tauri dev` \
         WebView2 process and is out of scope for this automated benchmark."
    );
}

// ── entry point ───────────────────────────────────────────────────────────────

/// Filed fraction used for the main latency run — chosen to stay under the SQLite
/// bound-parameter limit (see `seed_dataset` doc comment) at BOTH volumes, so the two are
/// comparable. Not the originally-planned 50/50; see the crash-reproduction block below for
/// that proportion.
const MAIN_RUN_FILED_FRACTION: f64 = 0.25;

#[test]
#[ignore]
fn bench_volume_list_filed_and_list_pending() {
    for &volume in &[15_000usize, 100_000usize] {
        let (_tmp, conn) = build_dataset(volume, MAIN_RUN_FILED_FRACTION);

        measure_queries(&conn, volume);
        explain_all_queries(&conn);

        if volume == 100_000 {
            measure_serialization(&conn);
        }
        // `_tmp` (NamedTempFile) drops here, deleting the temp SQLite file from disk.
    }

    reproduce_sqlite_variable_limit_crash();
}

/// Reproduces, with a real error message, the crash discovered while designing this benchmark:
/// at a realistic 50/50 filed/pending split and 100k total rows, `list_filed`'s unfiltered path
/// asks `genres::get_genres_batch` to bind ~50,000 placeholders in one `IN (...)` — above this
/// SQLite build's 32766 bound-parameter limit (see `debug_print_sqlite_variable_limit`). This is
/// a functional bug (the call errors out, callers must decide whether to crash/no-op/degrade),
/// not a latency finding — reported separately in the measurement report, not folded into the
/// latency table above (which deliberately uses a lower filed fraction to avoid it).
fn reproduce_sqlite_variable_limit_crash() {
    println!("\n=== Reproducing the SQLite bound-parameter crash (100k rows, 50% filed) ===");
    let (_tmp, conn) = build_dataset(100_000, 0.5);
    let base = LibraryFilter::default();
    match library::list_filed(&conn, &base) {
        Ok(rows) => println!(
            "  UNEXPECTED: list_filed succeeded with {} rows — crash did not reproduce, \
             re-check the parameter limit and filed count.",
            rows.len()
        ),
        Err(e) => println!("  CONFIRMED crash: list_filed(no filter) returned Err: {e}"),
    }
}

#[test]
#[ignore]
fn debug_print_sqlite_variable_limit() {
    let conn = Connection::open_in_memory().unwrap();
    // Binary search the largest N for which `SELECT 1 WHERE 1 IN (?,?,...N times)` still
    // prepares, to find this build's actual SQLITE_MAX_VARIABLE_NUMBER (the `limits` rusqlite
    // feature isn't enabled, so we can't just read it via the API).
    let fails = |n: usize| -> bool {
        let placeholders = vec!["?"; n].join(",");
        let sql = format!("SELECT 1 WHERE 1 IN ({placeholders})");
        conn.prepare(&sql).is_err()
    };
    let mut lo = 1usize;
    let mut hi = 100_000usize;
    assert!(!fails(lo), "even 1 variable fails to prepare");
    assert!(fails(hi), "100000 variables unexpectedly succeeded");
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if fails(mid) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    println!("largest working variable count = {lo}, fails at {hi}");
}
