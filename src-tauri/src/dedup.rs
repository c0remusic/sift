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

/// Group every `filed` track into duplicate clusters by acoustic fingerprint similarity
/// (reuses the same cache + threshold as `find_duplicate`). O(n²) fingerprint comparisons —
/// fine at library-browsing scale; revisit only if profiling shows it matters.
pub fn scan_library_duplicates(conn: &Connection) -> rusqlite::Result<Vec<DupGroup>> {
    struct Row {
        id: i64,
        path: String,
        filename: Option<String>,
        folder: Option<String>,
        format: Option<String>,
        bitrate: Option<i64>,
        duration: Option<f64>,
        truncated: bool,
    }
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, folder, format, bitrate, duration, truncated \
         FROM tracks WHERE status='filed'",
    )?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                path: r.get(1)?,
                filename: r.get(2)?,
                folder: r.get(3)?,
                format: r.get(4)?,
                bitrate: r.get(5)?,
                duration: r.get(6)?,
                truncated: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let fps: Vec<Option<Vec<u32>>> = rows
        .iter()
        .map(|r| get_or_compute_fp(conn, r.id, &r.path))
        .collect();

    let n = rows.len();
    let mut parent: Vec<usize> = (0..n).collect();
    let mut min_sim: HashMap<usize, f32> = HashMap::new();
    for i in 0..n {
        let Some(fi) = &fps[i] else { continue };
        for j in (i + 1)..n {
            let Some(fj) = &fps[j] else { continue };
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
    Ok(out)
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
    let path: String = match conn
        .query_row("SELECT path FROM tracks WHERE id=?1", params![track_id], |r| r.get(0))
    {
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
    let (kind, score) =
        match (get_or_compute_fp(conn, track_id, &path), get_or_compute_fp(conn, id, &cand_path)) {
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

    Ok(Some(DupMatch { id, status, folder, filename, kind: kind.to_string(), score }))
}

/// Fetch a track's fingerprint from the `tracks.fingerprint` cache, or compute it from the
/// file and cache it. `None` if the audio can't be fingerprinted (short/corrupt/missing).
fn get_or_compute_fp(conn: &Connection, track_id: i64, path: &str) -> Option<Vec<u32>> {
    let cached: Option<String> = conn
        .query_row("SELECT fingerprint FROM tracks WHERE id=?1", params![track_id], |r| r.get(0))
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

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn add(conn: &Connection, path: &str, status: &str) -> i64 {
        conn.execute(
            "INSERT INTO tracks(path, filename, status) VALUES(?1, ?2, ?3)",
            params![path, Path::new(path).file_name().and_then(|n| n.to_str()), status],
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
        conn.execute("UPDATE tracks SET folder='House' WHERE path='/lib/x.aiff'", []).ok();
        let filed = add(&conn, "/lib/Theo Parrish - Falling Up.aiff", "filed");
        conn.execute("UPDATE tracks SET folder='House' WHERE id=?1", params![filed]).unwrap();

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
        assert_eq!(m.kind, "both", "same recording, same name → sound-confirmed");
        // fingerprint cached on both after the comparison
        let cached: Option<String> = conn
            .query_row("SELECT fingerprint FROM tracks WHERE id=?1", params![id_a], |r| r.get(0))
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
        assert_eq!(keep.format.as_deref(), Some("flac"), "lossless wins over lossy");
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
        conn.execute("UPDATE tracks SET fingerprint=?1 WHERE id IN (1,2)", params![fp])
            .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();

        assert_eq!(groups.len(), 1);
        let keep = groups[0].members.iter().find(|m| m.recommend_keep).unwrap();
        assert_eq!(keep.id, 2, "same lossiness → higher bitrate wins");
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
