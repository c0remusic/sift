# M8 Tier 2 — Playlist duplicate-entry dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `src-tauri/src/rekordbox_masterdb.rs` with a Tier 2 write
engine that detects and removes duplicate `djmdSongPlaylist` entries (the
same track appearing more than once in the same Rekordbox playlist), reusing
Tier 1's proven safety chain (guard/backup/decrypt/transaction/re-encrypt/
atomic-write/verify/rollback) — no new infrastructure, no new dependencies.

**Architecture:** One detection function (`detect_playlist_duplicates`,
read-only, groups `djmdSongPlaylist` rows by `(PlaylistID, ContentID)`) and
one write function (`dedup_playlist_group`, one duplicate group per call,
mirroring `repair_track_path`'s one-operation-per-call shape so a future IPC
layer can loop over groups with per-group isolation exactly like
`ipc_library::rekordbox_masterdb_apply_repairs` already does for Tier 1).
Every extra occurrence beyond the first (lowest `TrackNo`) is deleted; the
kept occurrence is never touched. Only the global `agentRegistry` USN counter
is bumped, once per deleted row — no row-level USN stamp is needed for a
`DELETE` (there is no surviving row to stamp), matching what the real
`pyrekordbox` source's `autoincrement_local_update_count` does generically
for any instance in its unit-of-work, deletions included (see
`~/Desktop/sift-masterdb-write-probe/FINDINGS-m8-spike-2.md`, section 5).

**Tech Stack:** Same as Tier 1 — `rusqlite` (`serialize`/`deserialize`
features), `aes`/`cbc`/`hmac`/`sha2`/`pbkdf2`, `sysinfo`, `chrono`. **Zero new
dependencies** — Tier 1 already added everything this plan needs.

## Global Constraints

- MSRV 1.77.2 (`src-tauri/Cargo.toml:9`) — no new dependencies added by this
  plan, so nothing new to verify against it.
- **Sift never creates a playlist in Rekordbox** (M8 brainstorm decision,
  `docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`,
  Tier 2 section) — this plan only ever `DELETE`s existing
  `djmdSongPlaylist` rows, never `INSERT`s new ones, never touches
  `djmdPlaylist` at all.
- **No `TrackNo` renumbering** — deliberately out of scope. Removing a
  duplicate can leave a gap in `TrackNo` ordering (e.g. 1, 2, 4 after
  removing 3); Rekordbox does not require contiguous `TrackNo` values, and
  renumbering belongs to the broader "sync an existing playlist's full
  membership/order" feature the design doc keeps separate from dedup.
- **Never flip `Analysed`/`AnalysisUpdated`/`CueUpdated`** (M8 non-negotiable
  rule) — not touched by this plan; it only ever touches `djmdSongPlaylist`
  and `agentRegistry`.
- **Refuse to write if Rekordbox is running** — reuses the existing
  `is_rekordbox_running` guard, called first, before any file I/O.
- **Backup before any write, round-trip verify after, rollback as a
  first-class path on verification failure** — reuses
  `backup_rekordbox_files`/`restore_rekordbox_backup` unchanged.
- No IPC wiring, no UI in this plan — explicitly deferred, matching Tier 1's
  own plan boundary and the design doc's "Intégration app" section (UI design
  differed to a session dedicated to it, once the engine is proven).
- Never copy real personal data into the committed fixture — synthetic data
  only (`scripts/make-rekordbox-fixture.py`'s existing rule).
- `cargo test`/`cargo clippy` must never run concurrently with an active
  `tauri dev` (corrupts the incremental cache — project rule). If another
  session has `tauri dev` running against this same repo, run with
  `CARGO_TARGET_DIR` pointed at a scratch directory instead of the shared
  `target/`.
- The real-copy verification task (Task 4) requires Rekordbox **closed**
  (the engine's own guard refuses otherwise) — check `tasklist | grep -i
  rekordbox` (Windows) before running it, and ask before closing Rekordbox
  if it's open; never close another running app without asking first.

---

## File Structure

- **Modify `scripts/make-rekordbox-fixture.py`** — add one duplicate
  `djmdSongPlaylist` row so the fixture has a genuine dedup scenario baked
  in, following the same "regenerate when schema/data needs to change"
  convention Tier 1 established for this script.
- **Modify `src-tauri/tests/fixtures/rekordbox_master.db`** — regenerated
  binary fixture (adds one row, existing rows unchanged).
- **Modify `src-tauri/src/rekordbox_masterdb.rs`** — extended in place (no
  split), same convention as Tier 1: new `MasterDbError` variants, two new
  public types (`PlaylistDuplicateEntry`, `PlaylistDuplicateGroup`), two new
  public functions (`detect_playlist_duplicates`, `dedup_playlist_group`).

---

### Task 1: Extend the fixture with a duplicate playlist entry

**Files:**
- Modify: `scripts/make-rekordbox-fixture.py`
- Modify: `src-tauri/tests/fixtures/rekordbox_master.db` (regenerated binary)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`, new test)

**Interfaces:**
- Produces: fixture `djmdSongPlaylist` now has 3 rows instead of 2 — the
  existing `("60000001", "50000001", "40000001", 1)` and
  `("60000002", "50000001", "40000002", 2)` are unchanged, plus a new
  `("60000003", "50000001", "40000001", 3)` — track `40000001` now appears
  twice in playlist `50000001` (`TrackNo` 1 and 3), a genuine duplicate
  scenario. Every other existing test (`reads_fixture_tracks`,
  `fixture_has_tier1_write_columns`, all `repair_track_path_*` tests) reads
  only `djmdContent`/`agentRegistry`, never `djmdSongPlaylist` — unaffected.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/rekordbox_masterdb.rs` (right
after the closing `}` of `fixture_has_tier1_write_columns`, i.e. after line
797):

```rust
    #[test]
    fn fixture_has_a_playlist_duplicate() {
        let raw = std::fs::read(FIXTURE).expect("read fixture bytes");
        let plaintext = decrypt_masterdb(&raw).expect("decrypt fixture");
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        let len = plaintext.len();
        conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
            .expect("deserialize fixture");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM djmdSongPlaylist WHERE PlaylistID = '50000001' AND ContentID = '40000001'",
                [],
                |row| row.get(0),
            )
            .expect("query djmdSongPlaylist");
        assert_eq!(count, 2, "fixture must have track 40000001 twice in playlist 50000001");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml fixture_has_a_playlist_duplicate -- --nocapture`
Expected: FAIL — `assertion 'left == right' failed... left: 1, right: 2`
(today's fixture only has one entry for that pair).

- [ ] **Step 3: Add the duplicate row to the fixture script**

In `scripts/make-rekordbox-fixture.py`, replace the `djmdSongPlaylist` insert
block:

```python
conn.executemany(
    "INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?)",
    [
        ("60000001", "50000001", "40000001", 1),
        ("60000002", "50000001", "40000002", 2),
    ],
)
```

with:

```python
conn.executemany(
    "INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?)",
    [
        ("60000001", "50000001", "40000001", 1),
        ("60000002", "50000001", "40000002", 2),
        # Duplicate: track 40000001 also appears at TrackNo 3 — M8 Tier 2
        # dedup fixture scenario (keep 60000001, remove 60000003).
        ("60000003", "50000001", "40000001", 3),
    ],
)
```

Run: `python scripts/make-rekordbox-fixture.py`
Expected output: `wrote .../rekordbox_master.db <size> bytes` (size grows
slightly from the extra row; exact byte count depends on SQLite's B-tree
layout, not asserted here).

- [ ] **Step 4: Run tests to verify everything still passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — 20 non-ignored tests (up from 19) plus the same 1
`#[ignore]`d real-copy gate from the WAL fix session (21 total).

- [ ] **Step 5: Commit**

```bash
git add scripts/make-rekordbox-fixture.py src-tauri/tests/fixtures/rekordbox_master.db src-tauri/src/rekordbox_masterdb.rs
git commit -m "test(rekordbox_masterdb): add a duplicate playlist entry to the fixture"
```

---

### Task 2: `detect_playlist_duplicates` — read-only detection

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (two new public structs, one
  new public function, inserted after `PathRepair`'s closing `}` at line
  229, before `impl std::error::Error for MasterDbError {}` — actually
  after the `RekordboxIndex`/`PathRepair` block, i.e. right after line 229)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: `decrypt_masterdb`, `Connection` (both already in this file).
- Produces:
  ```rust
  pub struct PlaylistDuplicateEntry {
      pub song_playlist_id: String,
      pub track_no: i64,
  }

  pub struct PlaylistDuplicateGroup {
      pub playlist_id: String,
      pub content_id: String,
      pub keep: PlaylistDuplicateEntry,
      pub remove: Vec<PlaylistDuplicateEntry>,
  }

  pub fn detect_playlist_duplicates(path: &Path) -> Result<Vec<PlaylistDuplicateGroup>, MasterDbError>
  ```
  Task 3 consumes `PlaylistDuplicateGroup` as the input to
  `dedup_playlist_group`, and calls `detect_playlist_duplicates` again
  afterward to verify a specific group is gone.

- [ ] **Step 1: Write the failing test**

Add to `mod tests`:

```rust
    #[test]
    fn detect_playlist_duplicates_finds_the_fixture_duplicate() {
        let groups = detect_playlist_duplicates(Path::new(FIXTURE)).expect("detect");
        assert_eq!(groups.len(), 1, "fixture has exactly one duplicate group");
        let g = &groups[0];
        assert_eq!(g.playlist_id, "50000001");
        assert_eq!(g.content_id, "40000001");
        assert_eq!(g.keep.song_playlist_id, "60000001");
        assert_eq!(g.keep.track_no, 1);
        assert_eq!(g.remove.len(), 1);
        assert_eq!(g.remove[0].song_playlist_id, "60000003");
        assert_eq!(g.remove[0].track_no, 3);
    }

    #[test]
    fn detect_playlist_duplicates_ignores_non_duplicated_entries() {
        let groups = detect_playlist_duplicates(Path::new(FIXTURE)).expect("detect");
        // Track 40000002 appears exactly once (TrackNo 2, playlist 50000001)
        // — must not show up as a group.
        assert!(!groups
            .iter()
            .any(|g| g.content_id == "40000002"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_playlist_duplicates -- --nocapture`
Expected: FAIL with `cannot find function 'detect_playlist_duplicates' in this scope`.

- [ ] **Step 3: Implement the types and the detection function**

In `src-tauri/src/rekordbox_masterdb.rs`, add right after `PathRepair`'s
closing `}` (after line 229):

```rust
/// One `djmdSongPlaylist` row involved in a duplicate group — either the
/// occurrence being kept or one being removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistDuplicateEntry {
    /// Rekordbox `djmdSongPlaylist.ID` of this row.
    pub song_playlist_id: String,
    /// Rekordbox `djmdSongPlaylist.TrackNo` of this row.
    pub track_no: i64,
}

/// A set of `djmdSongPlaylist` rows in the same playlist that reference the
/// same track more than once. `keep` is the occurrence with the lowest
/// `TrackNo` (kept untouched by `dedup_playlist_group`); `remove` is every
/// other occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaylistDuplicateGroup {
    /// Rekordbox `djmdPlaylist.ID` the duplicated entries belong to.
    pub playlist_id: String,
    /// Rekordbox `djmdContent.ID` that appears more than once in this playlist.
    pub content_id: String,
    /// The occurrence that survives (lowest `TrackNo`).
    pub keep: PlaylistDuplicateEntry,
    /// Every other occurrence — these are what `dedup_playlist_group` deletes.
    pub remove: Vec<PlaylistDuplicateEntry>,
}

/// Scans `djmdSongPlaylist` for `(PlaylistID, ContentID)` pairs that appear
/// more than once — the same track added twice (or more) to the same
/// playlist. Read-only, mirroring `read_rekordbox_masterdb`'s shape (decrypt
/// → deserialize → query, no write).
pub fn detect_playlist_duplicates(path: &Path) -> Result<Vec<PlaylistDuplicateGroup>, MasterDbError> {
    let raw = std::fs::read(path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT ID, PlaylistID, ContentID, TrackNo FROM djmdSongPlaylist ORDER BY PlaylistID, ContentID, TrackNo")
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut all = Vec::new();
    for row in rows {
        all.push(row.map_err(|e| MasterDbError::Sqlite(e.to_string()))?);
    }

    // Rows are sorted by (PlaylistID, ContentID, TrackNo), so duplicates of
    // the same (PlaylistID, ContentID) pair are always contiguous — a single
    // linear scan finds every group without a HashMap.
    let mut groups: Vec<PlaylistDuplicateGroup> = Vec::new();
    let mut i = 0;
    while i < all.len() {
        let (keep_id, playlist_id, content_id, keep_track_no) = &all[i];
        let mut j = i + 1;
        let mut remove = Vec::new();
        while j < all.len() && &all[j].1 == playlist_id && &all[j].2 == content_id {
            remove.push(PlaylistDuplicateEntry {
                song_playlist_id: all[j].0.clone(),
                track_no: all[j].3,
            });
            j += 1;
        }
        if !remove.is_empty() {
            groups.push(PlaylistDuplicateGroup {
                playlist_id: playlist_id.clone(),
                content_id: content_id.clone(),
                keep: PlaylistDuplicateEntry {
                    song_playlist_id: keep_id.clone(),
                    track_no: *keep_track_no,
                },
                remove,
            });
        }
        i = j;
    }
    Ok(groups)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all tests including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add detect_playlist_duplicates"
```

---

### Task 3: `dedup_playlist_group` — the Tier 2 write engine

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (two new `MasterDbError`
  variants + Display arms, one new function)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`)

**Interfaces:**
- Consumes: `is_rekordbox_running`, `backup_rekordbox_files`,
  `restore_rekordbox_backup`, `decrypt_masterdb`, `encrypt_masterdb`,
  `detect_playlist_duplicates` (Task 2), `PlaylistDuplicateGroup` (Task 2).
- Produces:
  ```rust
  pub fn dedup_playlist_group(
      pioneer_dir: &Path,
      backup_dir: &Path,
      group: &PlaylistDuplicateGroup,
  ) -> Result<(), MasterDbError>
  ```
  Public (not `pub(crate)`) — same reasoning as `repair_track_path`: this is
  the Tier 2 engine's entry point, ready for a future IPC command, not added
  in this plan.

**Deliberate scope note (read before writing tests):** this function never
touches `djmdPlaylist` or `masterPlaylists6.xml`, and never renumbers
`TrackNo` on the surviving rows in the same playlist — see the "No `TrackNo`
renumbering" global constraint above.

- [ ] **Step 1: Add the new `MasterDbError` variants**

In `src-tauri/src/rekordbox_masterdb.rs`, in the `MasterDbError` enum, right
after the `WriteVerificationFailedRollbackFailed(String)` variant (before
the enum's closing `}` at line 158), add:

```rust
    /// `dedup_playlist_group` was called with a group that has nothing to
    /// remove — the caller should have filtered this out via
    /// `detect_playlist_duplicates` first.
    NoDuplicatesToRemove,
    /// A `djmdSongPlaylist.ID` from `PlaylistDuplicateGroup::remove` no
    /// longer matched any row at delete time (already removed by something
    /// else since detection ran).
    SongPlaylistEntryNotFound {
        /// The `djmdSongPlaylist.ID` that was not found.
        song_playlist_id: String,
    },
```

In the matching `impl std::fmt::Display for MasterDbError` block, right
after the `WriteVerificationFailedRollbackFailed(m)` arm (before the match's
closing `}` at line 191), add:

```rust
            MasterDbError::NoDuplicatesToRemove => {
                write!(f, "dedup_playlist_group called with an empty remove list")
            }
            MasterDbError::SongPlaylistEntryNotFound { song_playlist_id } => {
                write!(f, "no djmdSongPlaylist row with ID {song_playlist_id}")
            }
```

- [ ] **Step 2: Write the failing test**

Add to `mod tests`:

```rust
    #[test]
    fn dedup_playlist_group_removes_extra_entries_and_bumps_usn() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let groups = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect");
        assert_eq!(groups.len(), 1);
        let group = groups[0].clone();

        dedup_playlist_group(&pioneer_dir, &backup_dir, &group).expect("dedup");

        // No more duplicates for this (playlist, content) pair.
        let after = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect after");
        assert!(!after
            .iter()
            .any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id));

        // The kept row is still there, untouched.
        let index = read_rekordbox_masterdb(&pioneer_dir.join("master.db")).expect("reread");
        assert_eq!(index.tracks.len(), 3, "djmdContent must be untouched by a playlist dedup");

        // Backup exists and matches the original fixture.
        let backed_up = std::fs::read(backup_dir.join("master.db")).expect("read backup");
        let original = std::fs::read(FIXTURE).expect("read fixture");
        assert_eq!(backed_up, original);
    }

    #[test]
    fn dedup_playlist_group_rejects_empty_remove_list() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let empty_group = PlaylistDuplicateGroup {
            playlist_id: "50000001".to_string(),
            content_id: "40000002".to_string(),
            keep: PlaylistDuplicateEntry { song_playlist_id: "60000002".to_string(), track_no: 2 },
            remove: vec![],
        };
        let err = dedup_playlist_group(&pioneer_dir, &backup_dir, &empty_group).unwrap_err();
        assert_eq!(err, MasterDbError::NoDuplicatesToRemove);
    }

    #[test]
    fn dedup_playlist_group_rejects_unknown_song_playlist_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pioneer_dir = tmp.path().join("pioneer");
        let backup_dir = tmp.path().join("backup");
        std::fs::create_dir_all(&pioneer_dir).expect("mkdir pioneer");
        std::fs::copy(FIXTURE, pioneer_dir.join("master.db")).expect("copy fixture as master.db");
        std::fs::write(pioneer_dir.join("masterPlaylists6.xml"), b"<DJ_PLAYLISTS/>")
            .expect("write fake xml");

        let bogus_group = PlaylistDuplicateGroup {
            playlist_id: "50000001".to_string(),
            content_id: "40000001".to_string(),
            keep: PlaylistDuplicateEntry { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntry {
                song_playlist_id: "99999999".to_string(),
                track_no: 9,
            }],
        };
        let err = dedup_playlist_group(&pioneer_dir, &backup_dir, &bogus_group).unwrap_err();
        assert_eq!(
            err,
            MasterDbError::SongPlaylistEntryNotFound { song_playlist_id: "99999999".to_string() }
        );
    }
```

This requires `PlaylistDuplicateGroup`/`PlaylistDuplicateEntry` to derive
`Clone` (already specified in Task 2) so `groups[0].clone()` works.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dedup_playlist_group -- --nocapture`
Expected: FAIL with `cannot find function 'dedup_playlist_group' in this scope`.

- [ ] **Step 4: Implement `dedup_playlist_group`**

Add after `repair_track_path`'s closing `}` (after line 702):

```rust
/// Removes every extra occurrence in `group.remove` from `djmdSongPlaylist`,
/// keeping `group.keep` untouched, per the M8 Tier 2 design
/// (`docs/superpowers/specs/2026-07-06-m8-masterdb-write-path-rust-design-v2.md`,
/// Tier 2 section). Bumps the global `agentRegistry` USN counter once per
/// deleted row — a deleted row has no `rb_local_usn` of its own to stamp,
/// unlike `repair_track_path`'s in-place `UPDATE`.
///
/// Deliberately does **not** touch `djmdPlaylist`, `masterPlaylists6.xml`,
/// or `TrackNo` on any surviving row (see this function's module-level scope
/// note).
///
/// Safety sequence: identical to `repair_track_path` — refuse if Rekordbox
/// is running → backup → decrypt → delete inside a transaction → re-encrypt
/// → atomic rename → round-trip verify via `detect_playlist_duplicates` →
/// on verification failure, automatically restore the backup.
pub fn dedup_playlist_group(
    pioneer_dir: &Path,
    backup_dir: &Path,
    group: &PlaylistDuplicateGroup,
) -> Result<(), MasterDbError> {
    if group.remove.is_empty() {
        return Err(MasterDbError::NoDuplicatesToRemove);
    }
    if is_rekordbox_running() {
        return Err(MasterDbError::RekordboxRunning);
    }

    let db_path = pioneer_dir.join("master.db");
    backup_rekordbox_files(pioneer_dir, backup_dir)?;

    let raw = std::fs::read(&db_path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, false)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.6f").to_string();
    let tx = conn.transaction().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    for entry in &group.remove {
        let old_usn: i64 = tx
            .query_row(
                "SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => MasterDbError::RegistryRowMissing,
                other => MasterDbError::Sqlite(other.to_string()),
            })?;
        let new_usn = old_usn + 1;
        tx.execute(
            "UPDATE agentRegistry SET int_1 = ?1, updated_at = ?2 WHERE registry_id = 'localUpdateCount'",
            rusqlite::params![new_usn, now],
        )
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

        let rows_changed = tx
            .execute(
                "DELETE FROM djmdSongPlaylist WHERE ID = ?1",
                rusqlite::params![entry.song_playlist_id],
            )
            .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
        if rows_changed != 1 {
            return Err(MasterDbError::SongPlaylistEntryNotFound {
                song_playlist_id: entry.song_playlist_id.clone(),
            });
        }
    }

    tx.commit().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let plaintext2 = conn
        .serialize(rusqlite::MAIN_DB)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?
        .to_vec();
    let raw2 = encrypt_masterdb(&plaintext2)?;

    let tmp_path = pioneer_dir.join("master.db.sift-write-tmp");
    std::fs::write(&tmp_path, &raw2).map_err(|e| MasterDbError::Io(e.to_string()))?;
    if let Err(e) = std::fs::rename(&tmp_path, &db_path) {
        std::fs::remove_file(&tmp_path).ok();
        return Err(MasterDbError::Io(e.to_string()));
    }

    match detect_playlist_duplicates(&db_path) {
        Ok(remaining) => {
            let still_duplicated = remaining
                .iter()
                .any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id);
            if still_duplicated {
                let msg = format!(
                    "playlist {} / content {} still has duplicates after dedup",
                    group.playlist_id, group.content_id
                );
                match restore_rekordbox_backup(pioneer_dir, backup_dir) {
                    Ok(()) => Err(MasterDbError::WriteVerificationFailedRolledBack(msg)),
                    Err(restore_err) => Err(MasterDbError::WriteVerificationFailedRollbackFailed(
                        format!("{msg}; rollback also failed: {restore_err}"),
                    )),
                }
            } else {
                Ok(())
            }
        }
        Err(read_err) => match restore_rekordbox_backup(pioneer_dir, backup_dir) {
            Ok(()) => Err(MasterDbError::WriteVerificationFailedRolledBack(read_err.to_string())),
            Err(restore_err) => Err(MasterDbError::WriteVerificationFailedRollbackFailed(format!(
                "{read_err}; rollback also failed: {restore_err}"
            ))),
        },
    }
}
```

Also add `Clone` to the `#[derive(...)]` on `PlaylistDuplicateGroup` and
`PlaylistDuplicateEntry` from Task 2 if not already present (Task 2 already
specifies `#[derive(Debug, Clone, PartialEq, Eq)]` on both — verify this
matches before writing new code).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all tests including the 3 new ones.

- [ ] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(rekordbox_masterdb): add dedup_playlist_group, the Tier 2 write engine"
```

---

### Task 4: Real-copy verification gate

**Why this task exists:** Tier 1 shipped without this and it took a
dedicated session (2026-07-08) to discover a real bug (WAL header handling,
`docs/ressources-externes.md` Évaluation 18) that the synthetic fixture never
exercised. Building the same gate into this plan from the start, instead of
discovering the need for it again later.

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`, one new
  `#[ignore]`d test)

**Interfaces:**
- Consumes: `detect_playlist_duplicates`, `dedup_playlist_group` (Task 2/3).
- Produces: nothing new — this is a verification-only test, not production
  code.

**Setup before running this task's test:** a copy of a real Rekordbox
`master.db` under a directory referenced by `SIFT_M8_REAL_COPY_DIR` (see the
existing `repair_track_path_round_trips_on_real_masterdb_copy` test's own
doc comment for the exact env var contract — reuse the same copy directory,
e.g. `~/Desktop/sift-m8-tier1-rust-verify/pioneer/`, no need for a second
copy). Rekordbox must be closed.

- [ ] **Step 1: Write the test**

Add to `mod tests`, right after
`repair_track_path_round_trips_on_real_masterdb_copy`:

```rust
    /// M8 Tier 2 real-data gate, same rationale as Tier 1's
    /// `repair_track_path_round_trips_on_real_masterdb_copy` — a synthetic
    /// fixture proves the engine's SQL is correct, not that it survives a
    /// real Rekordbox B-tree. Unlike Tier 1's test, this one does not
    /// restore the original state afterward: the real copy conveniently
    /// already has a genuine pre-existing duplicate (found while writing
    /// this plan — `docs/ressources-externes.md`, Évaluation 18's
    /// follow-up investigation), and cleaning it up is a harmless,
    /// disposable side effect on a throwaway copy, never the live file.
    ///
    /// `#[ignore]`d for the same reason as Tier 1's — needs
    /// `SIFT_M8_REAL_COPY_DIR` and Rekordbox closed, not runnable in CI.
    #[test]
    #[ignore]
    fn dedup_playlist_group_round_trips_on_real_masterdb_copy() {
        let pioneer_dir = std::path::PathBuf::from(
            std::env::var("SIFT_M8_REAL_COPY_DIR")
                .expect("set SIFT_M8_REAL_COPY_DIR to a folder holding a COPY of master.db + masterPlaylists6.xml"),
        );
        let backup_dir = tempfile::tempdir().expect("tempdir").path().join("backup");

        let groups = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect on real copy");
        assert!(!groups.is_empty(), "expected at least one real duplicate group to dedup");
        let group = groups[0].clone();
        println!(
            "deduping playlist={} content={} keep={} remove={:?}",
            group.playlist_id,
            group.content_id,
            group.keep.song_playlist_id,
            group.remove.iter().map(|e| &e.song_playlist_id).collect::<Vec<_>>()
        );

        dedup_playlist_group(&pioneer_dir, &backup_dir, &group).expect("dedup on real copy");

        let after = detect_playlist_duplicates(&pioneer_dir.join("master.db")).expect("detect after");
        assert!(
            !after.iter().any(|g| g.playlist_id == group.playlist_id && g.content_id == group.content_id),
            "duplicate group must be gone after dedup"
        );

        println!("PASS: deduped 1 real playlist duplicate group on a real master.db copy");
    }
```

- [ ] **Step 2: Ensure Rekordbox is closed**

Run (Windows): `tasklist | grep -i rekordbox`
Expected: no output. If Rekordbox is open, ask before closing it — never
close another running app without asking first (per this project's
methodology rules).

- [ ] **Step 3: Run the test**

Run (use an isolated `CARGO_TARGET_DIR` if another session has `tauri dev`
active against this repo — check first):

```
SIFT_M8_REAL_COPY_DIR=<path to the real copy's pioneer dir> cargo test --manifest-path src-tauri/Cargo.toml --lib rekordbox_masterdb -- --ignored --nocapture dedup_playlist_group_round_trips
```

Expected: PASS, printing the deduped group and a `PASS:` line. If it fails,
stop and investigate — do not proceed to Step 4 with a red test (this gate
exists specifically to catch what the fixture can't).

- [ ] **Step 4: Run the full non-ignored suite once more**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all non-ignored tests pass (2 ignored: the Tier 1 and Tier 2
real-copy gates).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs
git commit -m "test(rekordbox_masterdb): add Tier 2 real-copy verification gate"
```

---

## Self-Review

- **Spec coverage**: Tier 2's scope per the design doc ("seulement
  dédupliquer des entrées... pas de création") is fully covered — detection
  (Task 2), removal with the same safety chain as Tier 1 (Task 3), and the
  real-data verification the design doc's own "Séquencement recommandé"
  calls for before considering an M8 tier trustworthy (Task 4, built in from
  the start this time). Playlist *membership sync* (adding/removing tracks
  to match Sift's own state, `TrackNo` reordering) is explicitly **not**
  covered — the design doc scopes that as a separate capability within Tier
  2 that additionally needs a Sift↔Rekordbox playlist correspondence
  mechanism ("à spécifier au moment du plan" — not resolved by this plan,
  which only covers the spike-validated dedup operation).
- **Placeholder scan**: no TBD/TODO; every step has real code and an exact
  command with expected output.
- **Type consistency**: `PlaylistDuplicateEntry { song_playlist_id, track_no }`
  and `PlaylistDuplicateGroup { playlist_id, content_id, keep, remove }` are
  used identically across Task 2's definition, Task 2's tests, Task 3's
  tests, Task 3's `dedup_playlist_group` body, and Task 4's real-copy test.
  `MasterDbError::NoDuplicatesToRemove` and
  `MasterDbError::SongPlaylistEntryNotFound { song_playlist_id }` match their
  usages exactly in Task 3.

## After this plan

Not covered here, left for follow-up sessions:
- IPC command + UI (preview diff, two-click in-app confirmation, journal
  entry + Revert) for Tier 2 — same deferral as Tier 1's own plan, "une
  session dédiée, une fois le moteur prouvé."
- Playlist *membership sync* (beyond dedup) — needs the Sift↔Rekordbox
  playlist correspondence mechanism the design doc leaves open.
- Tier 3 (`TrackInfoUpdated` flag) — still blocked on its own unresolved
  spike retest, unrelated to this plan.
- Real-Rekordbox acceptance check (open the deduped copy in actual
  Rekordbox and confirm it doesn't complain) — Task 4 proves the engine's
  own round-trip, not Rekordbox's opinion of the result. Tier 1 needed
  spike n°3/n°4 for this; Tier 2 should get an equivalent manual check
  before its IPC/UI ships, not before this plan's engine-only scope.
