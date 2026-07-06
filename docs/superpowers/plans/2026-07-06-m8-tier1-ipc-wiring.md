# M8 Tier 1 IPC Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-proven `repair_track_path` write engine
(`src-tauri/src/rekordbox_masterdb.rs`) to the rest of Sift: detect
candidate `master.db` path repairs read-only on every filing move, persist
them, and let the user list/apply/dismiss them via 3 new IPC commands.

**Architecture:** A new SQLite table (`rekordbox_masterdb_repairs`) holds
candidate repairs. Detection piggybacks on the existing filing hook that
already patches the linked Rekordbox XML (`actions::maybe_repair_rekordbox_xml`)
— same guard, same call sites, but read-only against `master.db` (never
writes it). Applying a repair is a separate, explicitly user-triggered IPC
command that calls the existing `repair_track_path` engine with a
per-row-isolated, timestamped backup directory.

**Tech Stack:** Rust (`rusqlite`, existing `rekordbox_masterdb` engine),
`chrono` (already a dependency since the engine plan) for the backup
timestamp, TypeScript mirror in `shared/contracts.ts` + `frontend/ipc.ts`
(no UI screen — that consumes these wrappers in a later, separate plan).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-06-m8-tier1-ipc-wiring-design.md`
  — every exact value below (SQL, error strings, backup path shape) is
  copied from there, not re-derived.
- **Detection never writes `master.db`** — only a read via the existing
  `read_rekordbox_masterdb`, plus a write to Sift's own DB.
- **Applying a repair is never automatic** — only the 3 new IPC commands
  touch `master.db`, and only when explicitly called with specific `ids`.
- Ambiguous matches (`track_id = NULL`, `candidate_track_ids` populated)
  are never auto-resolved — only listed and dismissable.
- `cargo test`/`cargo clippy` must never run concurrently with an active
  `tauri dev` process in this repo.
- Every new `#[tauri::command]` needs a plain `_inner` function
  (testable without a Tauri `State`/`AppHandle`), matching the existing
  `link_rekordbox_xml_inner`/`rekordbox_status_inner` convention in
  `ipc_library.rs`.

---

## File Structure

- **Modify `src-tauri/src/db.rs`** — new v11 migration adding the
  `rekordbox_masterdb_repairs` table; update the two tests that assert a
  literal table count.
- **Modify `src-tauri/src/actions.rs`** — new `detect_masterdb_repair_if_linked`
  (the read-only detection logic, mirrors `repair_rekordbox_xml_if_linked`)
  and `maybe_detect_masterdb_repair` (the guard wrapper, mirrors
  `maybe_repair_rekordbox_xml`), wired into `record_with_meta`.
- **Modify `src-tauri/src/filing.rs`** — `commit_file`'s deferred
  post-commit hook loop gains the same call, which requires capturing each
  row's `action_id` from the transaction (currently discarded).
- **Modify `src-tauri/src/ipc_library.rs`** — new M8 section: 3 commands +
  their `_inner` functions + `PendingMasterdbRepair`/`ApplyRepairOutcome`.
- **Modify `src-tauri/src/lib.rs`** — register the 3 new commands.
- **Modify `shared/contracts.ts`** — mirror the 2 new response types.
- **Modify `frontend/ipc.ts`** — 3 new wrapper functions.

---

### Task 1: DB migration — `rekordbox_masterdb_repairs` table

**Files:**
- Modify: `src-tauri/src/db.rs:122-128` (append v11 to `MIGRATIONS`)
- Modify: `src-tauri/src/db.rs:182-187` (`migrations_create_all_tables`)
- Modify: `src-tauri/src/db.rs:189-195` (`migrations_are_idempotent`)
- Test: `src-tauri/src/db.rs` (`mod tests`, new test)

**Interfaces:**
- Produces: table `rekordbox_masterdb_repairs(id, action_id, track_id,
  candidate_track_ids, from_path, to_path, status, detected_at, applied_at)`,
  `UNIQUE(action_id)`, index on `status`. Consumed by Tasks 2 and 4.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/db.rs` (after
`tracks_has_m2b_columns`, i.e. after line 235's closing `}`):

```rust
    #[test]
    fn rekordbox_masterdb_repairs_table_has_expected_columns() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('rekordbox_masterdb_repairs')")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for c in [
            "id", "action_id", "track_id", "candidate_track_ids", "from_path",
            "to_path", "status", "detected_at", "applied_at",
        ] {
            assert!(cols.contains(&c.to_string()), "rekordbox_masterdb_repairs missing column {c}");
        }
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb_repairs_table_has_expected_columns -- --nocapture`
Expected: FAIL — `no such table: rekordbox_masterdb_repairs`.

- [ ] **Step 3: Add the migration**

In `src-tauri/src/db.rs`, replace lines 122-128 (the v10 entry plus the
closing `];`):

```rust
    // v10 — composite indexes for the dashboard/facet queries: folder facets filter on
    // (status='filed', folder) and the "à re-sourcer" card on (status='filed', verdict).
    r#"
    CREATE INDEX IF NOT EXISTS idx_tracks_status_folder ON tracks(status, folder);
    CREATE INDEX IF NOT EXISTS idx_tracks_status_verdict ON tracks(status, verdict);
    "#,
];
```

with:

```rust
    // v10 — composite indexes for the dashboard/facet queries: folder facets filter on
    // (status='filed', folder) and the "à re-sourcer" card on (status='filed', verdict).
    r#"
    CREATE INDEX IF NOT EXISTS idx_tracks_status_folder ON tracks(status, folder);
    CREATE INDEX IF NOT EXISTS idx_tracks_status_verdict ON tracks(status, verdict);
    "#,
    // v11 — M8 Tier 1 IPC wiring: candidate master.db path repairs detected read-only on
    // filing (docs/superpowers/specs/2026-07-06-m8-tier1-ipc-wiring-design.md). track_id is
    // NULL when 2+ djmdContent rows matched the same from_path (ambiguous, never auto-repaired
    // — see candidate_track_ids). UNIQUE(action_id): a second detection pass for the same
    // journaled move never duplicates the row.
    r#"
    CREATE TABLE rekordbox_masterdb_repairs (
        id INTEGER PRIMARY KEY,
        action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
        track_id TEXT,
        candidate_track_ids TEXT,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        UNIQUE(action_id)
    );
    CREATE INDEX idx_rkbmdb_repairs_status ON rekordbox_masterdb_repairs(status);
    "#,
];
```

- [ ] **Step 4: Update the two tests asserting a literal table count**

Replace (line 182-187):

```rust
    #[test]
    fn migrations_create_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        assert_eq!(table_count(&conn).unwrap(), 7); // v4 adds `settings`, v6 adds `track_genres`
    }
```

with:

```rust
    #[test]
    fn migrations_create_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // v4 adds `settings`, v6 adds `track_genres`, v11 adds `rekordbox_masterdb_repairs`
        assert_eq!(table_count(&conn).unwrap(), 8);
    }
```

Replace (line 189-195):

```rust
    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // second run must not error or duplicate
        assert_eq!(table_count(&conn).unwrap(), 7);
    }
```

with:

```rust
    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // second run must not error or duplicate
        assert_eq!(table_count(&conn).unwrap(), 8);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml db:: -- --nocapture`
Expected: PASS — all `db.rs` tests, including the 3 touched/added here.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(db): add rekordbox_masterdb_repairs table (v11 migration)"
```

---

### Task 2: Detection — `actions.rs`

**Files:**
- Modify: `src-tauri/src/actions.rs:53-65` (`record_with_meta`)
- Modify: `src-tauri/src/actions.rs` (new functions, placed after
  `maybe_repair_rekordbox_xml`, i.e. after line 119)
- Test: `src-tauri/src/actions.rs` (`mod tests`)

**Interfaces:**
- Consumes: `crate::settings::{get, REKORDBOX_XML_PATH}` (existing),
  `crate::rekordbox_masterdb::read_rekordbox_masterdb` (existing, returns
  `Result<RekordboxIndex, MasterDbError>` where `RekordboxIndex.tracks: Vec<RekordboxTrack>`
  and `RekordboxTrack{track_id: String, folder_path: String}`), the
  `rekordbox_masterdb_repairs` table (Task 1).
- Produces:
  - `pub fn maybe_detect_masterdb_repair(conn: &Connection, kind: &str, from_path: Option<&str>, to_path: Option<&str>, action_id: i64)`
  - `pub fn detect_masterdb_repair_if_linked(conn: &Connection, from_path: &str, to_path: &str, action_id: i64)`
  Both consumed by Task 3 (`filing.rs`).

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block in `src-tauri/src/actions.rs` (this module
already has a `fn db() -> Connection` helper at line 442 — reuse it; add
these after the existing tests, before the module's closing `}`):

```rust
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

        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", 42);

        let (action_id, track_id, candidates, status): (i64, String, Option<String>, String) = conn
            .query_row(
                "SELECT action_id, track_id, candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("one repair row inserted");
        assert_eq!(action_id, 42);
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

        detect_masterdb_repair_if_linked(&conn, "D:/nowhere/nope.mp3", "D:/somewhere/else.mp3", 1);

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

        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", 7);

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
        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", 1);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_repairs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn detect_masterdb_repair_second_call_same_action_id_does_not_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let xml_path = seed_pioneer_dir_with_fixture(&tmp.path().join("pioneer"));
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", 9);
        detect_masterdb_repair_if_linked(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", 9);

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_repairs", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }
```

Note: `detect_masterdb_repair_ambiguous_on_two_matches` needs two tiny
test-only helpers exposed from `rekordbox_masterdb.rs` — `decrypt_masterdb`/
`encrypt_masterdb` are already `fn`/`pub(crate) fn` respectively but not
reachable the way this test needs (mutating then re-encrypting a modified
buffer). Add these two thin `#[cfg(test)] pub(crate)` wrappers to
`src-tauri/src/rekordbox_masterdb.rs`, right after the existing
`encrypt_masterdb` function (after its closing `}`):

```rust
#[cfg(test)]
pub(crate) fn decrypt_masterdb_for_test(raw: &[u8]) -> Vec<u8> {
    decrypt_masterdb(raw).expect("decrypt fixture for test setup")
}

#[cfg(test)]
pub(crate) fn encrypt_masterdb_for_test(plaintext: &[u8]) -> Vec<u8> {
    encrypt_masterdb(plaintext).expect("encrypt fixture for test setup")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_masterdb_repair -- --nocapture`
Expected: FAIL with `cannot find function 'detect_masterdb_repair_if_linked' in this scope`.

- [ ] **Step 3: Implement the detection functions**

Add to `src-tauri/src/actions.rs`, right after `maybe_repair_rekordbox_xml`
(after line 119):

```rust
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

/// Read-only detection: if a Rekordbox XML is linked, look up the sibling `master.db` (same
/// directory — `master.db` and `masterPlaylists6.xml` are always siblings, confirmed by the
/// M8 spikes) for `djmdContent` rows whose `FolderPath` equals `from_path`, and record a
/// candidate repair row — `pending` (exactly one match) or `ambiguous` (2+ matches, the real
/// duplicate-path scenario the M8 spikes found in a real library). Never writes `master.db`
/// itself. Any failure (no XML linked, `master.db` unreadable) is a silent no-op — detecting a
/// candidate repair must never fail the filing action that triggered it, same contract as
/// `repair_rekordbox_xml_if_linked`.
pub fn detect_masterdb_repair_if_linked(conn: &Connection, from_path: &str, to_path: &str, action_id: i64) {
    let Ok(Some(xml_path)) = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH) else {
        return;
    };
    let Some(pioneer_dir) = std::path::Path::new(&xml_path).parent() else {
        return;
    };
    let master_db_path = pioneer_dir.join("master.db");
    let index = match crate::rekordbox_masterdb::read_rekordbox_masterdb(&master_db_path) {
        Ok(idx) => idx,
        Err(e) => {
            log::error!("masterdb repair detection: {} unreadable: {e}", master_db_path.display());
            return;
        }
    };
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
```

- [ ] **Step 4: Wire the immediate (non-batch) call site**

In `src-tauri/src/actions.rs`, replace lines 53-65 (`record_with_meta`):

```rust
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
    Ok(id)
}
```

with:

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml actions:: -- --nocapture`
and: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
Expected: PASS — all `actions.rs` tests (including the 5 new ones) and all
`rekordbox_masterdb.rs` tests (the 2 new `#[cfg(test)]` wrappers don't
change any existing test's behavior).

- [ ] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/actions.rs src-tauri/src/rekordbox_masterdb.rs
git commit -m "feat(actions): detect master.db path-repair candidates read-only on filing"
```

---

### Task 3: Wire the deferred (batch filing) call site — `filing.rs`

**Files:**
- Modify: `src-tauri/src/filing.rs:536-567` (`commit_file`)
- Test: `src-tauri/src/filing.rs` (`mod tests`)

**Interfaces:**
- Consumes: `actions::maybe_detect_masterdb_repair` (Task 2).
- Produces: no new public interface — this task only fixes `commit_file`'s
  internal action-id plumbing so the hook fires with the *correct*
  `action_id` per filesystem effect, not a placeholder.

- [ ] **Step 1: Write the failing test**

Add to the `mod tests` block in `src-tauri/src/filing.rs` (after the
existing tests, before the module's closing `}`):

```rust
    #[test]
    fn commit_file_detects_masterdb_repair_with_correct_action_id() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();

        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"),
            pioneer_dir.join("master.db"),
        )
        .unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES('irrelevant', 'pending')", [])
            .unwrap();
        let track_id = conn.last_insert_rowid();

        let plan = FilePlan {
            track_id,
            batch_id: "b1".to_string(),
            source: "irrelevant-source".to_string(),
            dest: "irrelevant-dest".to_string(),
            conformant: false,
            target: Target::Mp3320,
            canonical: Canonical {
                artist: "A".to_string(),
                title: "T".to_string(),
                version: None,
                confidence: naming::Confidence::Green,
            },
            bin_rel: "House".to_string(),
            extras: TagExtras { label: None, year: None, genres: vec![], cover_path: None },
        };
        let log = vec![FsLog {
            kind: "move",
            from: "D:/FIXTURE/track1.mp3".to_string(),
            to: "D:/FIXTURE/renamed/track1.flac".to_string(),
            meta: None,
        }];

        commit_file(&conn, &plan, log).expect("commit_file");

        let action_id: i64 = conn
            .query_row(
                "SELECT id FROM actions WHERE type='move' AND from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| r.get(0),
            )
            .expect("move action row exists");

        let (repair_action_id, repair_track_id, status): (i64, String, String) = conn
            .query_row(
                "SELECT action_id, track_id, status FROM rekordbox_masterdb_repairs WHERE from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("repair row created");
        assert_eq!(
            repair_action_id, action_id,
            "the repair row must reference the SAME action_id commit_file just created for this row"
        );
        assert_eq!(repair_track_id, "40000001");
        assert_eq!(status, "pending");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_detects_masterdb_repair_with_correct_action_id -- --nocapture`
Expected: FAIL — `assertion failed` (no `rekordbox_masterdb_repairs` row
exists yet, since `commit_file` never calls the new detection hook).

- [ ] **Step 3: Wire the deferred call site**

In `src-tauri/src/filing.rs`, replace lines 536-567 (from
`let db_result: Result<(), FilingError> = (|| {` through the closing
`Ok(FileResult { path: plan.dest.clone(), batch_id: plan.batch_id.clone() });`
is NOT included — stop before that final line, which stays unchanged):

```rust
    let db_result: Result<(), FilingError> = (|| {
        let tx = conn.unchecked_transaction()?;
        for fs in &log {
            actions::record_row_only(
                &tx, &plan.batch_id, Some(plan.track_id), fs.kind, Some(&fs.from), Some(&fs.to), fs.meta.as_deref(),
            )?;
        }
        tx.execute(
            "UPDATE tracks SET status='filed', folder=?2, target_format=?3, confidence=?4 WHERE id=?1",
            params![plan.track_id, plan.bin_rel, target_str(plan.target), conf],
        )?;
        save_metadata(&tx, plan.track_id, &plan.canonical)?;
        tx.commit()?;
        Ok(())
    })();

    if let Err(e) = db_result {
        // Transaction already rolled back the DB rows; reverse the filesystem effects too so
        // nothing is left half-filed.
        rollback_fs(&log);
        return Err(FilingError::Db(e.to_string()));
    }

    // A track just became 'filed' — invalidate the dashboard duplicate-count cache. The cache key
    // (COUNT, MAX(id) of filed) misses an in-place re-filing that leaves both unchanged, so we
    // invalidate explicitly rather than rely on the key changing (coordination with R1's cache).
    crate::library::invalidate_duplicate_count_cache();

    // Committed — now (and only now) patch a linked Rekordbox XML for the move/convert rows.
    for fs in &log {
        actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to));
    }
```

with:

```rust
    let db_result: Result<Vec<i64>, FilingError> = (|| {
        let tx = conn.unchecked_transaction()?;
        let mut action_ids = Vec::with_capacity(log.len());
        for fs in &log {
            let id = actions::record_row_only(
                &tx, &plan.batch_id, Some(plan.track_id), fs.kind, Some(&fs.from), Some(&fs.to), fs.meta.as_deref(),
            )?;
            action_ids.push(id);
        }
        tx.execute(
            "UPDATE tracks SET status='filed', folder=?2, target_format=?3, confidence=?4 WHERE id=?1",
            params![plan.track_id, plan.bin_rel, target_str(plan.target), conf],
        )?;
        save_metadata(&tx, plan.track_id, &plan.canonical)?;
        tx.commit()?;
        Ok(action_ids)
    })();

    let action_ids = match db_result {
        Ok(ids) => ids,
        Err(e) => {
            // Transaction already rolled back the DB rows; reverse the filesystem effects too so
            // nothing is left half-filed.
            rollback_fs(&log);
            return Err(FilingError::Db(e.to_string()));
        }
    };

    // A track just became 'filed' — invalidate the dashboard duplicate-count cache. The cache key
    // (COUNT, MAX(id) of filed) misses an in-place re-filing that leaves both unchanged, so we
    // invalidate explicitly rather than rely on the key changing (coordination with R1's cache).
    crate::library::invalidate_duplicate_count_cache();

    // Committed — now (and only now) patch a linked Rekordbox XML for the move/convert rows, and
    // detect (read-only) any master.db repair candidates for the same rows (M8 Tier 1 IPC wiring).
    for (fs, action_id) in log.iter().zip(action_ids.iter()) {
        actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to));
        actions::maybe_detect_masterdb_repair(conn, fs.kind, Some(&fs.from), Some(&fs.to), *action_id);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml filing:: -- --nocapture`
Expected: PASS — all `filing.rs` tests, including the new one. This also
re-runs every pre-existing `commit_file`-dependent test (via `file_track`)
unchanged — the `db_result` type change is entirely internal to
`commit_file`, so nothing outside this function's body should be affected.

- [ ] **Step 5: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/filing.rs
git commit -m "feat(filing): wire master.db repair detection into the batch-filing commit path"
```

---

### Task 4: IPC commands, registration, and TS mirror

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (new imports, new section after
  the existing M7 section, i.e. after line 224)
- Modify: `src-tauri/src/lib.rs:129` (register 3 commands)
- Modify: `shared/contracts.ts` (after line 302, the end of the M7 section)
- Modify: `frontend/ipc.ts` (after line 274, the end of the M7 section)
- Test: `src-tauri/src/ipc_library.rs` (`mod rekordbox_tests`)

**Interfaces:**
- Consumes: `crate::rekordbox_masterdb::{read_rekordbox_masterdb, repair_track_path,
  PathRepair, MasterDbError}` (existing), `crate::settings::{get, REKORDBOX_XML_PATH}`
  (existing), the `rekordbox_masterdb_repairs` table (Task 1).
- Produces: `#[tauri::command]` fns `rekordbox_masterdb_pending_repairs`,
  `rekordbox_masterdb_apply_repairs`, `rekordbox_masterdb_dismiss_repair`;
  types `PendingMasterdbRepair`, `ApplyRepairOutcome`. Nothing later in this
  plan consumes these — the next plan (the UI screen) does.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/ipc_library.rs`'s existing `mod rekordbox_tests` block
(after the existing tests, before its closing `}` at the end of the file):

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: FAIL with `cannot find function 'rekordbox_masterdb_pending_repairs_inner' in this scope`
(and similarly for the other two `_inner` functions).

- [ ] **Step 3: Add imports**

In `src-tauri/src/ipc_library.rs`, replace the top imports (lines 1-7):

```rust
//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::library::{self, LibraryFacets, LibraryFilter, LibraryTrack};
use crate::metadata::{self, MetadataEdit};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;
```

with:

```rust
//! IPC surface for the M6b library browser: read-only listing + facets of filed tracks,
//! plus the `update_metadata` command for inline editing in the Bibliothèque.
use crate::library::{self, LibraryFacets, LibraryFilter, LibraryTrack};
use crate::metadata::{self, MetadataEdit};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
```

- [ ] **Step 4: Implement the types and `_inner` functions**

Add to `src-tauri/src/ipc_library.rs`, right after `export_rekordbox_xml`
(after line 224, before `#[cfg(test)]`):

```rust
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
    pub from_path: String,
    pub to_path: String,
    /// "pending" | "ambiguous".
    pub status: String,
    pub detected_at: String,
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
    let rows = stmt
        .query_map([], |r| {
            Ok(PendingMasterdbRepair {
                id: r.get(0)?,
                track_id: r.get(1)?,
                candidate_track_ids: r.get(2)?,
                from_path: r.get(3)?,
                to_path: r.get(4)?,
                status: r.get(5)?,
                detected_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
```

- [ ] **Step 5: Register the commands**

In `src-tauri/src/lib.rs`, replace line 129
(`ipc_library::export_rekordbox_xml,`):

```rust
            ipc_library::export_rekordbox_xml,
```

with:

```rust
            ipc_library::export_rekordbox_xml,
            ipc_library::rekordbox_masterdb_pending_repairs,
            ipc_library::rekordbox_masterdb_apply_repairs,
            ipc_library::rekordbox_masterdb_dismiss_repair,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all tests in `ipc_library.rs`'s `rekordbox_tests` module,
including the 8 new ones.

- [ ] **Step 7: Run the full backend suite and clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — no regressions anywhere (this is the last backend task in
this plan).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 8: Add the TypeScript mirror**

In `shared/contracts.ts`, after line 302 (the end of the M7
`RekordboxLinkStatus` interface, before its trailing blank line), add:

```typescript
// ---- M8 Tier 1 master.db path-repair candidates (mirror of src-tauri/src/ipc_library.rs) ----

export interface PendingMasterdbRepair {
  id: number;
  track_id: string | null;
  candidate_track_ids: string | null;
  from_path: string;
  to_path: string;
  status: "pending" | "ambiguous";
  detected_at: string;
}

export interface ApplyRepairOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}
```

In `frontend/ipc.ts`, add the import (find the existing import of
`RekordboxLinkStatus` near the top of the file and add the two new types
next to it in the same import statement), then add after line 274 (the end
of the M7 section):

```typescript
// ---- M8 Tier 1 master.db path-repair candidates ----

/** Candidate master.db path repairs detected so far (excludes applied/dismissed). */
export const rekordboxMasterdbPendingRepairs = (): Promise<PendingMasterdbRepair[]> =>
  invoke("rekordbox_masterdb_pending_repairs");

/** Apply the given repair ids against the linked Rekordbox's master.db. Never automatic —
 * only call this after explicit user confirmation. A failure on one id doesn't stop the rest. */
export const rekordboxMasterdbApplyRepairs = (ids: number[]): Promise<ApplyRepairOutcome[]> =>
  invoke("rekordbox_masterdb_apply_repairs", { ids });

/** Mark a pending/ambiguous repair as dismissed — it stops appearing in pending_repairs. */
export const rekordboxMasterdbDismissRepair = (id: number): Promise<void> =>
  invoke("rekordbox_masterdb_dismiss_repair", { id });
```

- [ ] **Step 9: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: clean (no type errors).

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs shared/contracts.ts frontend/ipc.ts
git commit -m "feat(ipc): add rekordbox_masterdb pending/apply/dismiss commands + TS mirror"
```

---

## Self-Review

- **Spec coverage**: table (Task 1), read-only detection at both
  `record_with_meta` and `filing::commit_file` call sites (Tasks 2-3), all 3
  IPC commands with per-row backup isolation, continue-on-failure, the
  ambiguous-skip guard, and the missing-target-file guard (Task 4). The
  exact error-message table and backup-path shape from the design doc are
  reproduced verbatim in Task 4's code, not re-derived. UI/Tier 2/3 are
  explicitly out of scope per the design doc and not touched here.
- **Placeholder scan**: no TBD/TODO; every step has real code, real
  commands, and stated expected output.
- **Type consistency**: `PendingMasterdbRepair`/`ApplyRepairOutcome` field
  names and types match across the Rust struct (Task 4), its `_inner`
  function's `query_map` column order, and the TypeScript mirror (Task 4,
  Step 8). `maybe_detect_masterdb_repair`/`detect_masterdb_repair_if_linked`
  signatures match between their definition (Task 2) and both call sites
  (Task 2's `record_with_meta`, Task 3's `commit_file`).

## After this plan

Not covered here: the Rekordbox page UI (lists `pending_repairs`, previews
the diff, two-click confirmation, calls `apply_repairs`/`dismiss_repair`) —
separate plan, per the brainstorm's agreed IPC → UI → Tier 2 ordering. Tier
2 (playlist sync) and Tier 3 (metadata reload flag, still blocked on the
never-completed spike retest) are untouched.
