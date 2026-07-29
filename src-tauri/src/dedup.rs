//! Duplicate detection — name first (here), sound confirmation layered on later (see the M5
//! spec). The cheap name pre-filter normalizes each track's name (from its filename) into a
//! key (`naming::name_key`) and flags collisions: `name_dups` marks the queue, `find_duplicate`
//! reports the best name match for one track. The acoustic confirmation upgrades the match
//! `kind` from `name` to `both` when the sound agrees.

use crate::{fingerprint, naming};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// A candidate row loaded for matching: (id, path, status, folder, filename).
type CandRow = (i64, String, String, Option<String>, Option<String>);

/// A duplicate match for one track. `kind`: `name` (names agree) or `both` (name + sound).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DupMatch {
    pub id: i64,
    pub status: String,
    pub folder: Option<String>,
    pub filename: Option<String>,
    pub kind: String,
    pub score: f32,
}

/// One member of a duplicate group (a `filed` track acoustically identical to the others).
#[derive(Debug, Clone, Serialize)]
pub struct DupGroupMember {
    pub id: i64,
    pub path: String,
    pub filename: Option<String>,
    pub folder: Option<String>,
    pub format: Option<String>,
    pub bitrate: Option<i64>,
    pub duration: Option<f64>,
    pub truncated: bool,
    pub recommend_keep: bool,
    /// Human-readable reason, set only on the recommended member (e.g. "lossless, 1411 kbps").
    pub reason: Option<String>,
}

/// A group of 2+ `filed` tracks that are acoustically the same recording.
#[derive(Debug, Clone, Serialize)]
pub struct DupGroup {
    pub members: Vec<DupGroupMember>,
    /// Weakest pairwise similarity that linked the group together.
    pub similarity: f32,
}

fn is_lossless_fmt(fmt: &Option<String>) -> bool {
    fmt.as_deref()
        .map(|f| matches!(f.to_lowercase().as_str(), "aiff" | "aif" | "wav" | "flac"))
        .unwrap_or(false)
}

/// Index of the member to recommend keeping: lossless > lossy, then higher bitrate, then
/// longer duration, then non-truncated; ties keep the first occurrence.
fn pick_keep(members: &[DupGroupMember]) -> usize {
    let key = |m: &DupGroupMember| {
        (
            is_lossless_fmt(&m.format),
            m.bitrate.unwrap_or(-1),
            m.duration.map(|d| (d * 1000.0) as i64).unwrap_or(-1),
            !m.truncated,
        )
    };
    let mut best = 0usize;
    for i in 1..members.len() {
        if key(&members[i]) > key(&members[best]) {
            best = i;
        }
    }
    best
}

fn find_root(parent: &mut [usize], x: usize) -> usize {
    if parent[x] != x {
        parent[x] = find_root(parent, parent[x]);
    }
    parent[x]
}

fn union(parent: &mut [usize], a: usize, b: usize) {
    let (ra, rb) = (find_root(parent, a), find_root(parent, b));
    if ra != rb {
        parent[ra] = rb;
    }
}

/// Two `filed` tracks whose durations differ by more than this can't be the same recording,
/// so we skip the (expensive) fingerprint comparison. Only applied when BOTH durations are
/// known — a missing duration falls through to the full comparison (fail-open, no false skip).
const DURATION_MATCH_TOL_SEC: f64 = 2.0;

/// One row loaded from `tracks` for a duplicate scan — everything the O(n²) compare and the
/// group-building step need, so they can run without touching the connection.
pub(crate) struct DupScanRow {
    pub id: i64,
    pub path: String,
    pub filename: Option<String>,
    pub folder: Option<String>,
    pub format: Option<String>,
    pub bitrate: Option<i64>,
    pub duration: Option<f64>,
    pub truncated: bool,
    /// Cached fingerprint as stored (may be empty/NULL → recompute lazily below).
    pub fingerprint: Option<String>,
}

/// Brief read: every `filed` track plus its cached fingerprint. Intended to be called under a
/// short-held lock — the caller drops the lock before doing anything with the result.
pub(crate) fn load_dup_scan_rows(conn: &Connection) -> rusqlite::Result<Vec<DupScanRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, folder, format, bitrate, duration, truncated, fingerprint \
         FROM tracks WHERE status='filed'",
    )?;
    let rows: Vec<DupScanRow> = stmt
        .query_map([], |r| {
            Ok(DupScanRow {
                id: r.get(0)?,
                path: r.get(1)?,
                filename: r.get(2)?,
                folder: r.get(3)?,
                format: r.get(4)?,
                bitrate: r.get(5)?,
                duration: r.get(6)?,
                truncated: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
                fingerprint: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Result of resolving every row's fingerprint (cached-decode or freshly computed from disk).
pub(crate) struct BuiltFingerprints {
    /// Aligned 1:1 with the `rows` slice passed to `build_fingerprints`.
    pub fps: Vec<Option<Vec<u32>>>,
    /// Newly-computed fingerprints (cache miss) still needing a DB write.
    pub to_persist: Vec<(i64, Vec<u32>)>,
}

/// Resolve every row's fingerprint: reuse the cached value already loaded on the row, or
/// decode/compute from disk. Pure — no connection touched, safe to run without any lock held.
pub(crate) fn build_fingerprints(rows: &[DupScanRow]) -> BuiltFingerprints {
    let mut fps = Vec::with_capacity(rows.len());
    let mut to_persist = Vec::new();
    for r in rows {
        match r.fingerprint.as_deref() {
            Some(s) if !s.is_empty() => fps.push(Some(fingerprint::decode(s))),
            _ => match fingerprint::compute_for_path(&r.path) {
                Ok(fp) => {
                    to_persist.push((r.id, fp.clone()));
                    fps.push(Some(fp));
                }
                Err(_) => fps.push(None),
            },
        }
    }
    BuiltFingerprints { fps, to_persist }
}

/// Persist newly-computed fingerprints (cache warm-up). Intended to be called under a
/// short-held lock, after the heavy compute is already done.
pub(crate) fn persist_fingerprints(conn: &Connection, entries: &[(i64, Vec<u32>)]) {
    for (id, fp) in entries {
        let _ = conn.execute(
            "UPDATE tracks SET fingerprint=?2 WHERE id=?1",
            params![id, fingerprint::encode(fp)],
        );
    }
}

/// The O(n²) compare + union-find grouping itself. Pure — no connection touched, safe to run
/// without any lock held. `fps` must be aligned 1:1 with `rows` (see `build_fingerprints`).
pub(crate) fn group_duplicates(rows: &[DupScanRow], fps: &[Option<Vec<u32>>]) -> Vec<DupGroup> {
    let n = rows.len();
    let mut parent: Vec<usize> = (0..n).collect();
    let mut min_sim: HashMap<usize, f32> = HashMap::new();
    for i in 0..n {
        let Some(fi) = &fps[i] else { continue };
        let di = rows[i].duration;
        for (j, fj) in fps.iter().enumerate().skip(i + 1) {
            let Some(fj) = fj else { continue };
            // Cheap pre-filter: known durations too far apart → not the same recording.
            if let (Some(a), Some(b)) = (di, rows[j].duration) {
                if (a - b).abs() > DURATION_MATCH_TOL_SEC {
                    continue;
                }
            }
            let s = fingerprint::similarity(fi, fj);
            if s >= fingerprint::MATCH_THRESHOLD {
                union(&mut parent, i, j);
                let root = find_root(&mut parent, i);
                let e = min_sim.entry(root).or_insert(s);
                if s < *e {
                    *e = s;
                }
            }
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find_root(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }

    let mut out = Vec::new();
    for (root, idxs) in groups {
        if idxs.len() < 2 {
            continue;
        }
        let mut members: Vec<DupGroupMember> = idxs
            .iter()
            .map(|&i| {
                let r = &rows[i];
                DupGroupMember {
                    id: r.id,
                    path: r.path.clone(),
                    filename: r.filename.clone(),
                    folder: r.folder.clone(),
                    format: r.format.clone(),
                    bitrate: r.bitrate,
                    duration: r.duration,
                    truncated: r.truncated,
                    recommend_keep: false,
                    reason: None,
                }
            })
            .collect();
        let keep = pick_keep(&members);
        members[keep].recommend_keep = true;
        let lossless = is_lossless_fmt(&members[keep].format);
        members[keep].reason = Some(match members[keep].bitrate {
            Some(b) => format!("{}, {b} kbps", if lossless { "lossless" } else { "lossy" }),
            None => (if lossless { "lossless" } else { "lossy" }).to_string(),
        });
        out.push(DupGroup {
            similarity: *min_sim.get(&root).unwrap_or(&1.0),
            members,
        });
    }
    out.sort_by(|a, b| a.members[0].id.cmp(&b.members[0].id));
    out
}

/// Group every `filed` track into duplicate clusters by acoustic fingerprint similarity
/// (reuses the same cache + threshold as `find_duplicate`). Still O(n²) in the worst case,
/// but the initial SELECT now also reads the cached `fingerprint` (no per-track N+1 SELECT)
/// and a cheap duration pre-filter skips comparisons that can't possibly match — enough for
/// a full 15k-track library dashboard scan.
///
/// Enchaîne lecture + calcul + persistance sous un `conn` tenu du début à la fin.
///
/// **Réservé aux tests depuis le 2026-07-28 (audit SYS-1).** Son dernier appelant de production,
/// `library::library_stats`, tenait le verrou global pendant tout l'appel — donc pendant le
/// décodage disque de `build_fingerprints`. Les deux commandes IPC concernées
/// (`ipc_library::scan_library_duplicates` et `ipc_library::library_stats`) enchaînent désormais
/// `load_dup_scan_rows` / `build_fingerprints` / `group_duplicates` / `persist_fingerprints`
/// elles-mêmes, de façon à ne tenir le verrou que sur la brève lecture et la brève écriture.
///
/// Garder ce raccourci hors production est délibéré : il rend les tests de `dedup` lisibles
/// (un appel au lieu de quatre) sans laisser un chemin qui reprendrait la mauvaise habitude.
/// `#[cfg(test)]` fait échouer la compilation de tout futur appelant de production, au lieu de le
/// laisser passer.
#[cfg(test)]
pub fn scan_library_duplicates(conn: &Connection) -> rusqlite::Result<Vec<DupGroup>> {
    let rows = load_dup_scan_rows(conn)?;
    let built = build_fingerprints(&rows);
    if !built.to_persist.is_empty() {
        persist_fingerprints(conn, &built.to_persist);
    }
    Ok(group_duplicates(&rows, &built.fps))
}

/// Name key for a track derived from its FILENAME only (no tag read — cheap). Uses the
/// filename parser when the name is clean, else normalizes the whole stem.
fn key_for_path(path: &str) -> String {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    match naming::parse_filename(stem) {
        Some((a, t, _)) => naming::name_key(&a, &t),
        None => naming::name_key("", stem),
    }
}

/// Pending track ids whose name key collides with another pending or filed track. Pure
/// string work over the `tracks` table — no file I/O, no migration. Drives the queue badge.
pub fn name_dups(conn: &Connection) -> rusqlite::Result<HashSet<i64>> {
    let mut stmt =
        conn.prepare("SELECT id, path, status FROM tracks WHERE status IN ('pending','filed')")?;
    let rows: Vec<(i64, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    // key -> list of (id, is_pending)
    let mut groups: HashMap<String, Vec<(i64, bool)>> = HashMap::new();
    for (id, path, status) in rows {
        groups
            .entry(key_for_path(&path))
            .or_default()
            .push((id, status == "pending"));
    }
    let mut dups = HashSet::new();
    for (_key, group) in groups {
        if group.len() >= 2 {
            for (id, is_pending) in group {
                if is_pending {
                    dups.insert(id);
                }
            }
        }
    }
    Ok(dups)
}

/// The best duplicate match for `track_id` by name (other pending or filed track sharing its
/// name key). `None` if no name collides. Slice A returns `kind = "name"`; the acoustic layer
/// (slice B) upgrades to `both` when the sound confirms.
pub fn find_duplicate(conn: &Connection, track_id: i64) -> rusqlite::Result<Option<DupMatch>> {
    let path: String = match conn.query_row(
        "SELECT path FROM tracks WHERE id=?1",
        params![track_id],
        |r| r.get(0),
    ) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let key = key_for_path(&path);

    let mut stmt = conn.prepare(
        "SELECT id, path, status, folder, filename FROM tracks
         WHERE status IN ('pending','filed') AND id<>?1",
    )?;
    let rows: Vec<CandRow> = stmt
        .query_map(params![track_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Prefer a filed match (it's "already in your library") over another pending one.
    let mut best: Option<CandRow> = None;
    for (id, cand_path, status, folder, filename) in rows {
        if key_for_path(&cand_path) != key {
            continue;
        }
        let is_filed = status == "filed";
        let take = match &best {
            None => true,
            Some((_, _, bstatus, _, _)) => is_filed && bstatus != "filed",
        };
        if take {
            best = Some((id, cand_path, status, folder, filename));
            if is_filed {
                break; // strongest by-name signal
            }
        }
    }

    let Some((id, cand_path, status, folder, filename)) = best else {
        return Ok(None);
    };

    // Confirm by sound: compare cached/lazy fingerprints. `both` if the sound agrees, else
    // `name` (names match but the recording differs, or audio unreadable — "à vérifier").
    let (kind, score) = match (
        get_or_compute_fp(conn, track_id, &path),
        get_or_compute_fp(conn, id, &cand_path),
    ) {
        (Some(fa), Some(fb)) => {
            let s = fingerprint::similarity(&fa, &fb);
            if s >= fingerprint::MATCH_THRESHOLD {
                ("both", s)
            } else {
                ("name", s)
            }
        }
        _ => ("name", 1.0),
    };

    Ok(Some(DupMatch {
        id,
        status,
        folder,
        filename,
        kind: kind.to_string(),
        score,
    }))
}

/// Fetch a track's fingerprint from the `tracks.fingerprint` cache, or compute it from the
/// file and cache it. `None` if the audio can't be fingerprinted (short/corrupt/missing).
fn get_or_compute_fp(conn: &Connection, track_id: i64, path: &str) -> Option<Vec<u32>> {
    let cached: Option<String> = conn
        .query_row(
            "SELECT fingerprint FROM tracks WHERE id=?1",
            params![track_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    if let Some(s) = cached {
        if !s.is_empty() {
            return Some(fingerprint::decode(&s));
        }
    }
    match fingerprint::compute_for_path(path) {
        Ok(fp) => {
            let _ = conn.execute(
                "UPDATE tracks SET fingerprint=?2 WHERE id=?1",
                params![track_id, fingerprint::encode(&fp)],
            );
            Some(fp)
        }
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors shared/contracts.ts's `DupGroupMember`. Exhaustive destructure (no `..`): fails
    /// to compile if a field is added/removed/renamed on the Rust struct — the forcing function
    /// to also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn dup_group_member_shape_matches_contracts_ts() {
        let v = DupGroupMember {
            id: 0,
            path: String::new(),
            filename: None,
            folder: None,
            format: None,
            bitrate: None,
            duration: None,
            truncated: false,
            recommend_keep: false,
            reason: None,
        };
        let DupGroupMember {
            id,
            path,
            filename,
            folder,
            format,
            bitrate,
            duration,
            truncated,
            recommend_keep,
            reason,
        } = v;
        let _ = (
            id,
            path,
            filename,
            folder,
            format,
            bitrate,
            duration,
            truncated,
            recommend_keep,
            reason,
        );
    }

    /// Mirrors shared/contracts.ts's `DupGroup`. Phase 2 —
    /// docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn dup_group_shape_matches_contracts_ts() {
        let v = DupGroup {
            members: Vec::new(),
            similarity: 0.0,
        };
        let DupGroup {
            members,
            similarity,
        } = v;
        let _ = (members, similarity);
    }

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn add(conn: &Connection, path: &str, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO tracks(path, filename, status) VALUES(?1, ?2, ?3)",
            params![
                path,
                Path::new(path).file_name().and_then(|n| n.to_str()),
                status
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn name_dups_flags_pending_homonyms() {
        let conn = db();
        let a = add(&conn, "/dl/Larry Heard - Mystery of Love.mp3", "pending");
        let b = add(&conn, "/dl/larry_heard mystery of love.flac", "pending");
        let _c = add(&conn, "/dl/Chez Damier - Can You Feel It.aiff", "pending");
        let dups = name_dups(&conn).unwrap();
        assert!(dups.contains(&a) && dups.contains(&b));
        assert_eq!(dups.len(), 2); // c is unique
    }

    #[test]
    fn name_dups_flags_pending_against_filed() {
        let conn = db();
        let p = add(&conn, "/dl/Theo Parrish - Falling Up.mp3", "pending");
        let _f = add(&conn, "/lib/Theo Parrish - Falling Up.aiff", "filed");
        let dups = name_dups(&conn).unwrap();
        assert!(dups.contains(&p));
        assert_eq!(dups.len(), 1); // only the pending one is flagged
    }

    #[test]
    fn find_duplicate_prefers_filed_match() {
        let conn = db();
        let cur = add(&conn, "/dl/Theo Parrish - Falling Up.mp3", "pending");
        let _other_pending = add(&conn, "/dl2/theo parrish falling up.wav", "pending");
        conn.execute(
            "UPDATE tracks SET folder='House' WHERE path='/lib/x.aiff'",
            [],
        )
        .ok();
        let filed = add(&conn, "/lib/Theo Parrish - Falling Up.aiff", "filed");
        conn.execute(
            "UPDATE tracks SET folder='House' WHERE id=?1",
            params![filed],
        )
        .unwrap();

        let m = find_duplicate(&conn, cur).unwrap().unwrap();
        assert_eq!(m.id, filed);
        assert_eq!(m.status, "filed");
        assert_eq!(m.folder.as_deref(), Some("House"));
        assert_eq!(m.kind, "name");
    }

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        std::path::Path::new(&p).exists().then_some(p)
    }

    #[test]
    fn find_duplicate_confirms_by_sound() {
        // Two encodings of the same recording, named to share a name key → name match AND
        // sound match → kind "both".
        let (Some(mp3), Some(flac)) = (fixture("real_320.mp3"), fixture("real_lossless.flac"))
        else {
            eprintln!("skip: no fixtures");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("Sweep Test - Tone.mp3");
        let b = dir.path().join("Sweep Test - Tone.flac");
        std::fs::copy(&mp3, &a).unwrap();
        std::fs::copy(&flac, &b).unwrap();
        let id_a = add(&conn, a.to_str().unwrap(), "pending");
        let _id_b = add(&conn, b.to_str().unwrap(), "pending");

        let m = find_duplicate(&conn, id_a).unwrap().unwrap();
        assert_eq!(
            m.kind, "both",
            "same recording, same name → sound-confirmed"
        );
        // fingerprint cached on both after the comparison
        let cached: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM tracks WHERE id=?1",
                params![id_a],
                |r| r.get(0),
            )
            .unwrap();
        assert!(cached.is_some_and(|s| !s.is_empty()));
    }

    #[test]
    fn find_duplicate_none_when_unique() {
        let conn = db();
        let cur = add(&conn, "/dl/Unique Artist - Unique Title.mp3", "pending");
        add(&conn, "/dl/Someone Else - Other Song.mp3", "pending");
        assert!(find_duplicate(&conn, cur).unwrap().is_none());
    }

    #[test]
    fn scan_library_duplicates_groups_filed_tracks_by_sound() {
        let (Some(mp3), Some(flac)) = (fixture("real_320.mp3"), fixture("real_lossless.flac"))
        else {
            eprintln!("skip: no fixtures");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mp3");
        let b = dir.path().join("b.flac");
        std::fs::copy(&mp3, &a).unwrap();
        std::fs::copy(&flac, &b).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format, bitrate, duration) \
             VALUES(?1, 'a.mp3', 'filed', 'mp3', 320, 30.0)",
            params![a.to_str().unwrap()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format, bitrate, duration) \
             VALUES(?1, 'b.flac', 'filed', 'flac', 1411, 30.0)",
            params![b.to_str().unwrap()],
        )
        .unwrap();
        // a lone unrelated filed track must not be grouped
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format) \
             VALUES('/lib/lone.wav', 'lone.wav', 'filed', 'wav')",
            [],
        )
        .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();

        assert_eq!(groups.len(), 1, "only the a/b pair forms a group");
        let g = &groups[0];
        assert_eq!(g.members.len(), 2);
        assert!(g.similarity >= fingerprint::MATCH_THRESHOLD);
        let keep = g.members.iter().find(|m| m.recommend_keep).unwrap();
        assert_eq!(
            keep.format.as_deref(),
            Some("flac"),
            "lossless wins over lossy"
        );
        assert!(keep.reason.is_some());
        assert_eq!(g.members.iter().filter(|m| m.recommend_keep).count(), 1);
    }

    #[test]
    fn scan_library_duplicates_recommend_keep_prefers_higher_bitrate_when_same_lossiness() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(1, '/lib/low.mp3', 'low.mp3', 'filed', 'mp3', 128, 30.0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(2, '/lib/high.mp3', 'high.mp3', 'filed', 'mp3', 320, 30.0, 0)",
            [],
        )
        .unwrap();
        // Fake-match the pair directly via a shared cached fingerprint (bypasses real decode).
        let fp = fingerprint::encode(&[1, 2, 3, 4, 5, 6, 7, 8]);
        conn.execute(
            "UPDATE tracks SET fingerprint=?1 WHERE id IN (1,2)",
            params![fp],
        )
        .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();

        assert_eq!(groups.len(), 1);
        let keep = groups[0].members.iter().find(|m| m.recommend_keep).unwrap();
        assert_eq!(keep.id, 2, "same lossiness → higher bitrate wins");
    }

    #[test]
    fn scan_library_duplicates_duration_prefilter_skips_far_apart() {
        // Same cached fingerprint on both, but durations 30s vs 200s (> 2s tol) → the pre-filter
        // must skip the comparison so they are NOT grouped. Guards against a wrong match by
        // fingerprint alone when the recordings are plainly different lengths.
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(1, '/lib/short.mp3', 'short.mp3', 'filed', 'mp3', 320, 30.0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(2, '/lib/long.mp3', 'long.mp3', 'filed', 'mp3', 320, 200.0, 0)",
            [],
        )
        .unwrap();
        let fp = fingerprint::encode(&[1, 2, 3, 4, 5, 6, 7, 8]);
        conn.execute(
            "UPDATE tracks SET fingerprint=?1 WHERE id IN (1,2)",
            params![fp],
        )
        .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();
        assert!(
            groups.is_empty(),
            "durations 170s apart must not be grouped"
        );
    }

    #[test]
    fn scan_library_duplicates_duration_prefilter_allows_close() {
        // Same cached fingerprint, durations within tolerance (30.0 vs 31.5) → still grouped.
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(1, '/lib/a.mp3', 'a.mp3', 'filed', 'mp3', 320, 30.0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(2, '/lib/b.mp3', 'b.mp3', 'filed', 'mp3', 320, 31.5, 0)",
            [],
        )
        .unwrap();
        let fp = fingerprint::encode(&[1, 2, 3, 4, 5, 6, 7, 8]);
        conn.execute(
            "UPDATE tracks SET fingerprint=?1 WHERE id IN (1,2)",
            params![fp],
        )
        .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();
        assert_eq!(
            groups.len(),
            1,
            "durations within 2s tolerance stay grouped"
        );
        assert_eq!(groups[0].members.len(), 2);
    }

    #[test]
    fn scan_library_duplicates_ignores_pending_and_lone_tracks() {
        let conn = db();
        add(&conn, "/dl/pending.mp3", "pending");
        add(&conn, "/lib/lone.flac", "filed");
        let groups = scan_library_duplicates(&conn).unwrap();
        assert!(groups.is_empty());
    }
}
