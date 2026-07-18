# M8 Tier 3 — câblage IPC + hook filing + écran UI (synchro metadata) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the already-shipped `sync_track_metadata` engine (`src-tauri/src/rekordbox_masterdb.rs`) to the app: detect (read-only) when Sift retags a file linked to Rekordbox, list the candidates, and write `master.db` only after explicit user confirmation.

**Architecture:** A new shared detector (`actions::detect_masterdb_metadata_sync_if_linked`) is called directly by the 3 sites that write ID3 tags (`filing.rs`, `apply_tags`, `update_metadata`) — never threaded through the generic `record_with_meta` hook signature. Detected candidates persist in a new table keyed by Sift `track_id` (replaced on every new retag, not accumulated). 4 IPC commands expose list/apply/dismiss/resolve-ambiguous. A 3rd section on the Rekordbox page (`frontend/sift-live.ts`) mirrors Tier 1/2's UI conventions exactly.

**Tech Stack:** Rust (rusqlite, Tauri commands), vanilla TypeScript (no framework), SQLite migrations.

## Global Constraints

- Never auto-apply a `master.db` write — every write requires `confirmAction()` in the UI (never `window.confirm()`).
- `sync_track_metadata` refuses to run while Rekordbox is open (`MasterDbError::RekordboxRunning`) — this plan never bypasses that guard.
- A failed row in a batch must never stop the rest of the batch (continue-on-failure, same as Tier 1/2).
- No file re-read for the values to sync — each of the 3 call sites passes the tag values it just wrote in memory.
- `filing.rs::FilePlan`/`FsLog` fields are **private** to `filing.rs` — any new detection call that needs them must be made from *inside* `filing.rs`, never by passing `&FilePlan` across a module boundary.
- Design reference: `docs/superpowers/specs/2026-07-09-m8-tier3-metadata-sync-ipc-ui-design.md` (approved, corrected post adversarial review, commit `4434807`).

---

### Task 1: Migration v13 — `rekordbox_masterdb_metadata_syncs` table

**Files:**
- Modify: `src-tauri/src/db.rs` (append to `MIGRATIONS`, update `migrations_create_all_tables`/`migrations_are_idempotent` table-count assertions)

**Interfaces:**
- Produces: table `rekordbox_masterdb_metadata_syncs` with columns `id, action_id, track_id, rekordbox_track_id, candidate_track_ids, new_artist, new_title, new_label, new_year, new_genre, status, detected_at, applied_at`, `UNIQUE(track_id)`.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/db.rs`, update the existing test (do not add a new one — this asserts the whole migration set, same convention as when v11 was added):

```rust
    #[test]
    fn migrations_create_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // v4 adds `settings`, v6 adds `track_genres`, v11 adds `rekordbox_masterdb_repairs`,
        // v13 adds `rekordbox_masterdb_metadata_syncs`
        assert_eq!(table_count(&conn).unwrap(), 9);
    }
```

Also update `migrations_are_idempotent`'s assertion from `8` to `9` in the same file (it duplicates the same count).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations_create_all_tables -- --nocapture`
Expected: FAIL — `assertion left == right` (`8` vs expected `9`, since the migration doesn't exist yet).

- [ ] **Step 3: Add the migration**

In `src-tauri/src/db.rs`, append to the `MIGRATIONS` array (after the v12 entry, before the closing `];`):

```rust
    // v13 — M8 Tier 3 IPC wiring: candidate master.db metadata syncs detected read-only
    // whenever Sift writes ID3 tags on a file linked to Rekordbox (filing, apply_tags,
    // update_metadata). Keyed by Sift track_id (not action_id like v11's repairs table) —
    // a retag before the user syncs replaces the pending candidate, it never accumulates.
    // rekordbox_track_id is NULL when 2+ djmdContent rows matched the same path (ambiguous,
    // never auto-resolved — see candidate_track_ids).
    r#"
    CREATE TABLE rekordbox_masterdb_metadata_syncs (
        id INTEGER PRIMARY KEY,
        action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        rekordbox_track_id TEXT,
        candidate_track_ids TEXT,
        new_artist TEXT,
        new_title TEXT,
        new_label TEXT,
        new_year INTEGER,
        new_genre TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        UNIQUE(track_id)
    );
    CREATE INDEX idx_rkbmdb_metasync_status ON rekordbox_masterdb_metadata_syncs(status);
    "#,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations_create_all_tables migrations_are_idempotent migrations_bring_db_to_latest_version -- --nocapture`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(m8): migration v13 pour rekordbox_masterdb_metadata_syncs"
```

---

### Task 2: Shared detector `detect_masterdb_metadata_sync_if_linked`

**Files:**
- Modify: `src-tauri/src/actions.rs` (add `MetadataSyncValues` struct + the detector function + tests)

**Interfaces:**
- Consumes: `crate::settings::REKORDBOX_XML_PATH`, `crate::rekordbox_masterdb::read_rekordbox_masterdb(&Path) -> Result<RekordboxIndex, MasterDbError>` (`RekordboxIndex { tracks: Vec<RekordboxTrack> }`, `RekordboxTrack { track_id: String, folder_path: String }`).
- Produces:
  ```rust
  pub struct MetadataSyncValues {
      pub artist: Option<String>,
      pub title: Option<String>,
      pub label: Option<String>,
      pub year: Option<i64>,
      pub genre: Option<String>,
  }

  pub fn detect_masterdb_metadata_sync_if_linked(
      conn: &Connection,
      lookup_path: &str,
      track_id: i64,
      values: &MetadataSyncValues,
      action_id: i64,
  )
  ```
  Later tasks (filing.rs, apply_tags, update_metadata) call this directly.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/actions.rs`, inside `mod tests` (near the existing `detect_masterdb_repair_*` tests, reusing `db()`/`seed_pioneer_dir_with_fixture` already defined there):

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_masterdb_metadata_sync -- --nocapture`
Expected: FAIL to compile — `detect_masterdb_metadata_sync_if_linked`/`MetadataSyncValues` not defined.

- [ ] **Step 3: Implement the detector**

Add to `src-tauri/src/actions.rs` (near `detect_masterdb_repair_if_linked`, after it):

```rust
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

/// M8 Tier 3: read-only detection, mirroring `detect_masterdb_repair_if_linked`'s guard and
/// 0/1/2+ match branches exactly, but writing to `rekordbox_masterdb_metadata_syncs` (keyed by
/// Sift `track_id`, `UNIQUE(track_id)` — a second call for the same track REPLACES the row via
/// `ON CONFLICT DO UPDATE`, preserving `id` so any reference already shown in the UI this render
/// stays valid) instead of `rekordbox_masterdb_repairs`.
///
/// Called directly by the 3 sites that write ID3 tags — `filing.rs`'s post-commit loop,
/// `apply_tags`, and `update_metadata` — right after each obtains its own `action_id`. Never
/// threaded through `record_with_meta`'s generic signature.
pub fn detect_masterdb_metadata_sync_if_linked(
    conn: &Connection,
    lookup_path: &str,
    track_id: i64,
    values: &MetadataSyncValues,
    action_id: i64,
) {
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
            log::error!("masterdb metadata sync detection: {} unreadable: {e}", master_db_path.display());
            return;
        }
    };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_masterdb_metadata_sync -- --nocapture`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions.rs
git commit -m "feat(m8): detecteur partage detect_masterdb_metadata_sync_if_linked"
```

---

### Task 3: Wire `filing.rs::commit_file` to the detector

**Files:**
- Modify: `src-tauri/src/filing.rs` (`commit_file`'s post-commit loop, `~line 571-574`)

**Interfaces:**
- Consumes: `actions::detect_masterdb_metadata_sync_if_linked` (Task 2), `actions::MetadataSyncValues`.
- Produces: nothing new — `commit_file`'s signature is unchanged.

Recall (from the design's adversarial review): `commit_file` never calls `record_with_meta` — it journals via `record_row_only` inside its transaction, then loops post-commit over `(FsLog, action_id)` pairs restricted to `kind ∈ {move, convert}`. The detector call goes directly in that same loop, building `MetadataSyncValues` from `plan.canonical`/`plan.extras` (both private fields, accessible here because this code lives in `filing.rs` itself).

**Fixture note:** this module's own tests (`seed_track`/`fixture()`, `filing.rs:686-706`) use real
audio files under `fixtures/` (gitignored — see project memory `sift-worktree-fixtures-gitignored`;
these tests skip gracefully via `eprintln!("skip: no fixture"); return;` when absent), so a seeded
track's path is a real tempdir path, never the literal `"D:/FIXTURE/track1.mp3"` the static
`tests/fixtures/rekordbox_master.db` fixture hardcodes. Patch the `master.db` fixture's
`FolderPath` to the real seeded path instead — same `decrypt_masterdb_for_test`/
`encrypt_masterdb_for_test` technique `actions.rs`'s ambiguous-match test already uses.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/filing.rs`'s `#[cfg(test)] mod tests` (near `files_conformant_mp3_by_moving`, `filing.rs:746`):

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

    /// Patches the fixture's track_id "40000001" FolderPath to `path` — same technique as
    /// actions.rs's detect_masterdb_repair_ambiguous_on_two_matches test.
    fn patch_fixture_folder_path(pioneer_dir: &std::path::Path, path: &str) {
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2.deserialize_read_exact(rusqlite::MAIN_DB, std::io::Cursor::new(plaintext), len, false).unwrap();
        conn2.execute("UPDATE djmdContent SET FolderPath=?1 WHERE ID='40000001'", params![path]).unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();
    }

    #[test]
    fn commit_file_conformant_detects_masterdb_metadata_sync() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let res = file_track(&conn, &root, "{artist} - {title}", id, "House", None, Some(Canonical {
            artist: "Larry Heard".into(), title: "Can You Feel It".into(), version: None,
            confidence: crate::naming::Confidence::Green,
        }), false).unwrap();
        let _ = res;

        let (new_artist, status): (Option<String>, String) = conn
            .query_row(
                "SELECT new_artist, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected a metadata sync candidate");
        assert_eq!(status, "pending");
        assert_eq!(new_artist.as_deref(), Some("Larry Heard"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_conformant_detects_masterdb_metadata_sync -- --nocapture`
Expected: FAIL — no row found in `rekordbox_masterdb_metadata_syncs` (detector never called yet).

- [ ] **Step 3: Wire the call**

In `src-tauri/src/filing.rs`, modify `commit_file`'s post-commit loop:

```rust
    // Committed — now (and only now) patch a linked Rekordbox XML for the move/convert rows, and
    // detect (read-only) any master.db repair candidates for the same rows (M8 Tier 1 IPC wiring),
    // plus (M8 Tier 3) any metadata sync candidate for the tags this commit just wrote.
    for (fs, action_id) in log.iter().zip(action_ids.iter()) {
        actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to));
        actions::maybe_detect_masterdb_repair(conn, fs.kind, Some(&fs.from), Some(&fs.to), *action_id);
        if matches!(fs.kind, "move" | "convert") {
            let genre = if plan.extras.genres.is_empty() { None } else { Some(plan.extras.genres.join("; ")) };
            let values = actions::MetadataSyncValues {
                artist: Some(plan.canonical.artist.clone()),
                title: Some(naming::tag_title(&plan.canonical)),
                label: plan.extras.label.clone(),
                year: plan.extras.year,
                genre,
            };
            actions::detect_masterdb_metadata_sync_if_linked(conn, &fs.from, plan.track_id, &values, *action_id);
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_conformant_detects_masterdb_metadata_sync -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Add the non-conformant (encode) regression test**

This regression matters specifically because the non-conformant path has NO `tag_edit` `FsLog` row
at all (see `filing.rs::execute_file`'s non-conformant branch) — the detection must still fire off
the `convert` row, not silently skip because there was no `tag_edit`. Mirrors
`files_flac_by_converting_to_aiff_and_trashing_original` (`filing.rs:842`):

```rust
    #[test]
    fn commit_file_non_conformant_detects_masterdb_metadata_sync() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_lossless.flac", "src.flac") else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let res = file_track(&conn, &root, "{artist} - {title}", id, "House", None, Some(Canonical {
            artist: "Theo Parrish".into(), title: "Falling Up".into(), version: None,
            confidence: crate::naming::Confidence::Green,
        }), false).unwrap();
        let _ = res;

        let (new_artist, status): (Option<String>, String) = conn
            .query_row(
                "SELECT new_artist, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected a metadata sync candidate on the non-conformant (convert) path");
        assert_eq!(status, "pending");
        assert_eq!(new_artist.as_deref(), Some("Theo Parrish"));
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_non_conformant_detects_masterdb_metadata_sync -- --nocapture`
Expected: PASS (the Step 3 code already covers both `kind`s — this test should pass without further implementation changes; if it doesn't, the bug is in how `plan.extras`/`plan.canonical` are populated for the non-conformant path, not in the detection call itself).

- [ ] **Step 6: Run the whole filing.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib filing:: -- --nocapture`
Expected: PASS, no regression on existing filing tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/filing.rs
git commit -m "feat(m8): commit_file detecte les candidats de synchro metadata Tier 3"
```

---

### Task 4: `update_metadata` — journal a `tag_edit`, return `batch_id`, call the detector

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (`update_metadata`, `~line 29-61`)

**Interfaces:**
- Consumes: `crate::tagging::read_tags_full`/`restore_tags`/`TagsSnapshot` (already used by `apply_tags`), `crate::filing::new_batch_id` (`pub(crate)`), `crate::actions::{record_with_meta, detect_masterdb_metadata_sync_if_linked, MetadataSyncValues}`.
- Produces: `update_metadata` signature changes from `Result<(), String>` to `Result<String, String>` (returns `batch_id`). Every caller of this Tauri command (only the frontend) must be updated in Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/ipc_library.rs`'s `#[cfg(test)] mod rekordbox_tests` (the file's only test
module today — despite its name, it's fine to add general `ipc_library` tests here too). Add a
local `fixture()` helper first (same as `tagging.rs:216-223`/`filing.rs:686-693`), then the tests:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_metadata_journals update_metadata_calls_masterdb -- --nocapture`
Expected: FAIL to compile — `update_metadata_inner` not defined yet (today `update_metadata` is a `#[tauri::command]` directly, no `_inner` split).

- [ ] **Step 3: Split `update_metadata` into `_inner` + command, add journaling + detection**

Replace the current `update_metadata` command in `src-tauri/src/ipc_library.rs` with:

```rust
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
```

Add `actions` to this file's imports if not already present: check the top of `src-tauri/src/ipc_library.rs` — if `use crate::actions;` (or similar) is missing, add it next to the existing `use crate::library::...`/`use crate::metadata::...` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_metadata_journals update_metadata_calls_masterdb -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Run the whole ipc_library.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib ipc_library:: -- --nocapture`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc_library.rs
git commit -m "fix(bibliotheque): update_metadata journalise un tag_edit revertable + detecte Tier 3"
```

---

### Task 5: Wire `apply_tags` to the detector

**Files:**
- Modify: `src-tauri/src/ipc_filing.rs` (`apply_tags`, `~line 182-227`)

**Interfaces:**
- Consumes: `actions::detect_masterdb_metadata_sync_if_linked`, `actions::MetadataSyncValues` (Task 2).

**Note on testability:** `apply_tags` is a `#[tauri::command]` taking `AppHandle`/`State` and has
zero existing tests in this codebase (no `_inner` split, unlike every Tier 1/2/3 IPC command) — it
also deliberately locks the connection **twice**, releasing it around the disk tag-write
(`ipc_filing.rs`'s own comment: "a disk read must not freeze every other DB user — same split as
apply_tags"). Collapsing that into a single `_inner(conn: &Connection, ...)` like `update_metadata`
(Task 4) would hold the DB mutex across a disk write in production — a real regression on a
documented discipline, not just a test-convenience refactor. So this task does **not** introduce an
`apply_tags_inner`. Instead, the value-building step is factored into its own pure function
(deterministic, no I/O, no lock) which Step 1 unit-tests directly — `detect_masterdb_metadata_sync_if_linked`'s
DB-side behavior itself is already exhaustively covered by Task 2's tests. The full wiring
(`apply_tags` → detector → row appears) gets its end-to-end check manually in Task 10 (Revue →
"Appliquer les tags" on a track linked to Rekordbox), the same way the rest of this codebase already
treats anything gated behind a live Tauri `AppHandle`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/ipc_filing.rs`'s test module:

```rust
    #[test]
    fn metadata_sync_values_for_apply_tags_maps_fields_and_joins_genres() {
        let edited = crate::naming::Canonical {
            artist: "Larry Heard".to_string(),
            title: "Mystery of Love".to_string(),
            version: None,
            confidence: crate::naming::Confidence::Green,
        };
        let extras = filing::TagExtras {
            label: Some("Alleviated".to_string()),
            year: Some(1985),
            genres: vec!["House".to_string(), "Deep House".to_string()],
            cover_path: None,
        };

        let values = metadata_sync_values_for_apply_tags(&edited, &extras);

        assert_eq!(values.artist.as_deref(), Some("Larry Heard"));
        assert_eq!(values.title.as_deref(), Some("Mystery of Love"));
        assert_eq!(values.label.as_deref(), Some("Alleviated"));
        assert_eq!(values.year, Some(1985));
        assert_eq!(values.genre.as_deref(), Some("House; Deep House"));
    }

    #[test]
    fn metadata_sync_values_for_apply_tags_empty_genres_is_none() {
        let edited = crate::naming::Canonical {
            artist: "A".to_string(), title: "B".to_string(), version: None,
            confidence: crate::naming::Confidence::Green,
        };
        let extras = filing::TagExtras::default();
        let values = metadata_sync_values_for_apply_tags(&edited, &extras);
        assert_eq!(values.genre, None);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml metadata_sync_values_for_apply_tags -- --nocapture`
Expected: FAIL to compile — `metadata_sync_values_for_apply_tags` not defined.

- [ ] **Step 3: Extract the pure helper + wire it into `apply_tags`**

In `src-tauri/src/ipc_filing.rs`, add this function near `apply_tags` (before it):

```rust
/// Builds the M8 Tier 3 `MetadataSyncValues` from an apply_tags edit — factored out as a pure
/// function (no I/O, no lock) so the value-mapping is unit-testable without a Tauri AppHandle/State.
fn metadata_sync_values_for_apply_tags(edited: &Canonical, extras: &filing::TagExtras) -> actions::MetadataSyncValues {
    let genre = if extras.genres.is_empty() { None } else { Some(extras.genres.join("; ")) };
    actions::MetadataSyncValues {
        artist: Some(edited.artist.clone()),
        title: Some(crate::naming::tag_title(edited)),
        label: extras.label.clone(),
        year: extras.year,
        genre,
    }
}
```

Then modify `apply_tags`'s existing second locked block (`ipc_filing.rs:220-224`, which today only
calls `record_with_meta` and discards its `Result<i64, _>` return):

```rust
    // (4) Journal the snapshot as a revertable tag_edit (from_path = the file, to_path = NULL). No
    // status change, no move — the revert just rewrites the old tags back.
    let meta = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let batch_id = filing::new_batch_id(track_id);
    {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let action_id = actions::record_with_meta(&conn, &batch_id, Some(track_id), "tag_edit", Some(&path), None, Some(&meta))
            .map_err(|e| e.to_string())?;

        // M8 Tier 3: detect (read-only) a metadata sync candidate when linked to Rekordbox.
        let values = metadata_sync_values_for_apply_tags(&edited, &extras);
        actions::detect_masterdb_metadata_sync_if_linked(&conn, &path, track_id, &values, action_id);
    }
    app.emit("queue:changed", ()).ok();
    Ok(batch_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml metadata_sync_values_for_apply_tags -- --nocapture`
Expected: PASS (2/2).

- [ ] **Step 5: Run the whole ipc_filing.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib ipc_filing:: -- --nocapture`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc_filing.rs
git commit -m "feat(m8): apply_tags detecte les candidats de synchro metadata Tier 3"
```

---

### Task 6: IPC commands — `pending_metadata_syncs`, `dismiss_metadata_sync`, `resolve_ambiguous_metadata_sync`

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (new section "M8 Tier 3: metadata sync candidates", near the Tier 1/2 sections)

**Interfaces:**
- Consumes: existing `CandidateTrack` struct (`ipc_library.rs:253`, reused as-is — field names `track_id`/`folder_path`), existing `read_masterdb_path_map` (`ipc_library.rs:303`).
- Produces:
  ```rust
  pub struct PendingMetadataSync {
      pub id: i64,
      pub track_id: i64,
      pub sift_path: String,
      pub rekordbox_track_id: Option<String>,
      pub candidate_track_ids: Option<String>,
      pub candidate_tracks: Option<Vec<CandidateTrack>>,
      pub new_artist: Option<String>,
      pub new_title: Option<String>,
      pub new_label: Option<String>,
      pub new_year: Option<i64>,
      pub new_genre: Option<String>,
      pub status: String,
      pub detected_at: String,
  }
  #[tauri::command] pub fn rekordbox_masterdb_pending_metadata_syncs(conn: State<'_, Mutex<Connection>>) -> Result<Vec<PendingMetadataSync>, String>;
  #[tauri::command] pub fn rekordbox_masterdb_dismiss_metadata_sync(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String>;
  #[tauri::command] pub fn rekordbox_masterdb_resolve_ambiguous_metadata_sync(conn: State<'_, Mutex<Connection>>, id: i64, chosen_track_id: String) -> Result<(), String>;
  ```
  Task 7 adds `rekordbox_masterdb_apply_metadata_syncs` in the same section.
  Task 9 (frontend) registers all 4 in `src-tauri/src/lib.rs`'s `tauri::generate_handler!` list.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/ipc_library.rs`'s `mod rekordbox_tests`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pending_metadata_syncs dismiss_metadata_sync resolve_ambiguous_metadata_sync -- --nocapture`
Expected: FAIL to compile — none of these functions exist yet.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/ipc_library.rs`, after the Tier 1 `rekordbox_masterdb_apply_repairs` section (before the `// ── M8 Tier 2` comment):

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pending_metadata_syncs dismiss_metadata_sync resolve_ambiguous_metadata_sync -- --nocapture`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc_library.rs
git commit -m "feat(m8): commandes IPC pending/dismiss/resolve_ambiguous pour Tier 3"
```

---

### Task 7: IPC command — `apply_metadata_syncs`

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (same M8 Tier 3 section, after Task 6's code)

**Interfaces:**
- Consumes: `crate::rekordbox_masterdb::{sync_track_metadata, MetadataSync}`, `humanize_masterdb_error` (existing, `ipc_library.rs:276`).
- Produces:
  ```rust
  pub struct ApplyMetadataSyncOutcome { pub id: i64, pub ok: bool, pub error: Option<String> }
  #[tauri::command] pub fn rekordbox_masterdb_apply_metadata_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<ApplyMetadataSyncOutcome>, String>;
  ```

- [ ] **Step 1: Write the failing tests**

Add to `mod rekordbox_tests`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml apply_metadata_syncs -- --nocapture`
Expected: FAIL to compile — `rekordbox_masterdb_apply_metadata_syncs_inner` not defined.

- [ ] **Step 3: Implement**

Add after Task 6's code in `src-tauri/src/ipc_library.rs`:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml apply_metadata_syncs -- --nocapture`
Expected: PASS (3/3).

- [ ] **Step 5: Register the 4 new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` macro call (search for `rekordbox_masterdb_apply_repairs` — it's already registered there) and add the 4 new command names next to it:

```rust
            ipc_library::rekordbox_masterdb_pending_metadata_syncs,
            ipc_library::rekordbox_masterdb_apply_metadata_syncs,
            ipc_library::rekordbox_masterdb_dismiss_metadata_sync,
            ipc_library::rekordbox_masterdb_resolve_ambiguous_metadata_sync,
```

- [ ] **Step 6: Full backend build + test + clippy**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (catches the `lib.rs` registration).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no regression on the full suite.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(m8): commande IPC apply_metadata_syncs, enregistrement lib.rs"
```

---

### Task 8: Frontend types + `ipc.ts` wrappers + `update_metadata` signature fix

**Files:**
- Modify: `shared/contracts.ts` (add types)
- Modify: `frontend/ipc.ts` (add wrappers, fix `updateMetadata`'s return type)
- Modify: `frontend/library-detail.ts` (`doSave`, real undo toast)

**Interfaces:**
- Produces (TS): `PendingMetadataSync`, `ApplyMetadataSyncOutcome` interfaces; `rekordboxMasterdbPendingMetadataSyncs()`, `rekordboxMasterdbApplyMetadataSyncs(ids)`, `rekordboxMasterdbDismissMetadataSync(id)`, `rekordboxMasterdbResolveAmbiguousMetadataSync(id, chosenTrackId)`.

- [ ] **Step 1: Add types to `shared/contracts.ts`**

After the existing `ApplyRepairOutcome` interface (`shared/contracts.ts:323-327`, before the Tier 2 comment), add:

```typescript
// ---- M8 Tier 3 master.db metadata sync candidates (mirror of src-tauri/src/ipc_library.rs) ----

export interface PendingMetadataSync {
  id: number;
  track_id: number;
  sift_path: string;
  rekordbox_track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  new_artist: string | null;
  new_title: string | null;
  new_label: string | null;
  new_year: number | null;
  new_genre: string | null;
  status: "pending" | "ambiguous";
  detected_at: string;
}

export interface ApplyMetadataSyncOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}
```

- [ ] **Step 2: Add wrappers + fix `updateMetadata` in `frontend/ipc.ts`**

In the `import type { ... } from "../shared/contracts"` block (`frontend/ipc.ts:3-32`), add `PendingMetadataSync` and `ApplyMetadataSyncOutcome` next to the existing `PendingMasterdbRepair`/`ApplyRepairOutcome` imports.

Change the existing `updateMetadata` (`frontend/ipc.ts:257-258`):

```typescript
export const updateMetadata = (trackId: number, edit: MetadataEdit): Promise<string> =>
  invoke("update_metadata", { trackId, edit });
```

After the existing `rekordboxMasterdbResolveAmbiguous` wrapper (`frontend/ipc.ts:297-298`), add:

```typescript
export const rekordboxMasterdbPendingMetadataSyncs = (): Promise<PendingMetadataSync[]> =>
  invoke("rekordbox_masterdb_pending_metadata_syncs");

export const rekordboxMasterdbApplyMetadataSyncs = (ids: number[]): Promise<ApplyMetadataSyncOutcome[]> =>
  invoke("rekordbox_masterdb_apply_metadata_syncs", { ids });

export const rekordboxMasterdbDismissMetadataSync = (id: number): Promise<void> =>
  invoke("rekordbox_masterdb_dismiss_metadata_sync", { id });

export const rekordboxMasterdbResolveAmbiguousMetadataSync = (id: number, chosenTrackId: string): Promise<void> =>
  invoke("rekordbox_masterdb_resolve_ambiguous_metadata_sync", { id, chosenTrackId });
```

- [ ] **Step 3: Real undo in `library-detail.ts`**

In `frontend/library-detail.ts`, add `revertBatch` to the import (`frontend/library-detail.ts:6-12`):

```typescript
import {
  updateMetadata,
  identify,
  applyIdentity,
  openUrl,
  trashTrack,
  revertBatch,
} from "./ipc";
```

Extend the local `toast()` function (`frontend/library-detail.ts:34-43`) to accept an optional undo, mirroring `filing.ts:1575`:

```typescript
/** A transient bottom-right toast, with an optional "Undo" action (mirrors filing.ts). */
function toast(message: string, undo?: boolean, onUndo?: () => void): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.innerHTML =
    `<span>${esc(message)}</span>` +
    (undo ? '<button data-fil="undo" class="sift-toast-undo">Annuler</button>' : "");
  document.body.appendChild(el);
  if (undo && onUndo) {
    el.querySelector('[data-fil="undo"]')?.addEventListener("click", () => {
      el.remove();
      onUndo();
    });
  }
  setTimeout(() => el.remove(), 6000);
}
```

In `doSave` (`frontend/library-detail.ts:249-288`), replace the success branch's `toast("Enregistré")`:

```typescript
  try {
    const batchId = await updateMetadata(st.track.id, e);
    // Reflect saved values back into the open track + notify the list.
    st.track.artist = e.artist;
    st.track.title = e.title;
    st.track.label = e.label;
    st.track.year = e.year;
    st.track.genres = e.genres;
    if (st.pendingCover) {
      st.track.cover_path = st.pendingCover;
      st.track.has_cover = true;
      st.pendingCover = null;
    }
    notifyChanged(st.track);
    toast("Enregistré", true, () => {
      void revertBatch(batchId).catch((err: unknown) => console.error("revert_batch failed", err));
    });
  } catch (err) {
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts.ts frontend/ipc.ts frontend/library-detail.ts
git commit -m "feat(m8): types+wrappers IPC Tier 3, bouton Annuler reel pour l'edition Bibliotheque"
```

---

### Task 9: UI section on the Rekordbox page

**Files:**
- Modify: `frontend/sift-live.ts` (imports, module-level state, `metadataSyncsSectionHtml`, `renderRekordboxLive`, click handler)

**Interfaces:**
- Consumes: Task 8's `ipc.ts` wrappers + `shared/contracts.ts` types.

- [ ] **Step 1: Imports**

In `frontend/sift-live.ts`'s existing `import { ... } from "./ipc"` block (`~line 3-37`, alongside `rekordboxMasterdbPendingRepairs` etc.), add:

```typescript
  rekordboxMasterdbPendingMetadataSyncs,
  rekordboxMasterdbApplyMetadataSyncs,
  rekordboxMasterdbDismissMetadataSync,
  rekordboxMasterdbResolveAmbiguousMetadataSync,
```

In the `import type { ... } from "../shared/contracts"` block (`~line 38-48`, alongside `PendingMasterdbRepair`, `CandidateTrack`), add:

```typescript
  PendingMetadataSync,
  ApplyMetadataSyncOutcome,
```

- [ ] **Step 2: Module-level selection/error state**

Near the existing `mdbRepairSel`/`mdbErrorById` declarations (`frontend/sift-live.ts:111-117`), add:

```typescript
// M8 Tier 3 metadata-syncs section state — same module-level, filtered-not-reset discipline as
// mdbRepairSel (sift-live.ts:114).
const mdsSyncSel = new Set<number>();
const mdsErrorById = new Map<number, string>();
```

- [ ] **Step 3: `metadataSyncsSectionHtml`**

After `masterdbRepairsSectionHtml` (`frontend/sift-live.ts:1711-1788`), add:

```typescript
/** M8 Tier 3 section: lists master.db metadata sync candidates detected passively whenever Sift
 * writes ID3 tags on a file linked to Rekordbox (filing, "Appliquer les tags", édition
 * Bibliothèque — see docs/superpowers/plans/2026-07-09-m8-tier3-metadata-sync-ipc-ui.md).
 * Independent of masterdbRepairsSectionHtml/playlistDuplicatesSectionHtml — 3 separate sections,
 * never merged. Renders "" when nothing pending/ambiguous. */
function metadataSyncsSectionHtml(rows: PendingMetadataSync[]): string {
  if (rows.length === 0) return "";
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdsSyncSel]) if (!liveIds.has(id)) mdsSyncSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");

  const diffLine = (label: string, value: string | number | null) =>
    value == null ? "" : `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${label}: ${esc(String(value))}</div>`;

  const infoBlock = (r: PendingMetadataSync) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.sift_path)}</div>` +
    diffLine("Artiste", r.new_artist) +
    diffLine("Titre", r.new_title) +
    diffLine("Label", r.new_label) +
    diffLine("Année", r.new_year) +
    diffLine("Genre", r.new_genre) +
    (mdsErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdsErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingMetadataSync): CandidateTrack[] =>
    r.candidate_tracks && r.candidate_tracks.length
      ? r.candidate_tracks
      : (r.candidate_track_ids || "")
          .split(",")
          .filter(Boolean)
          .map((track_id) => ({ track_id, folder_path: null }));

  const ambiguousRows = ambiguous
    .map((r) => {
      const candidateBtns = candidateList(r)
        .map(
          (c) =>
            `<button data-sift="mdsresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${infoBlock(r)}` +
        `<button data-sift="mdsdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRows = pending
    .map((r) => {
      const checked = mdsSyncSel.has(r.id);
      return (
        `<div class="bx-row" data-sift="mdspick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
          checked ? "background:var(--overlay-hover)" : ""
        }">` +
        `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
        infoBlock(r) +
        `<button data-sift="mdsdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
        `</div>`
      );
    })
    .join("");

  const applyBar =
    mdsSyncSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="mdsapply" style="font-weight:500">Appliquer la sélection (${mdsSyncSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Synchros metadata master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}
```

- [ ] **Step 4: Wire into `renderRekordboxLive`**

In `renderRekordboxLive` (`frontend/sift-live.ts:1825-1886`), after the existing `dedupSection` block and before `content.innerHTML = ...`:

```typescript
  let metadataSyncSection = "";
  try {
    const syncs = await rekordboxMasterdbPendingMetadataSyncs();
    metadataSyncSection = metadataSyncsSectionHtml(syncs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_metadata_syncs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection + dedupSection + metadataSyncSection;
```

(replacing the existing final line that omits `metadataSyncSection`.)

- [ ] **Step 5: Click handler**

In the same delegated click handler that already handles `mdbpick`/`mdbdismiss`/`mdbresolve`/`mdbapply`/`mdbdedup` (`frontend/sift-live.ts:2437-2528`), add 4 new branches right after the existing `mdbdedup` branch, before the closing `}` of the `if/else if` chain:

```typescript
    } else if (act === "mdspick") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      if (mdsSyncSel.has(id)) {
        mdsSyncSel.delete(id);
      } else {
        mdsSyncSel.add(id);
        mdsErrorById.delete(id);
      }
      void renderRekordboxLive();
    } else if (act === "mdsdismiss") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      void (async () => {
        try {
          await rekordboxMasterdbDismissMetadataSync(id);
        } catch (e) {
          console.error("rekordbox_masterdb_dismiss_metadata_sync failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "mdsresolve") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      const trackId = el.dataset.track || "";
      void (async () => {
        try {
          await rekordboxMasterdbResolveAmbiguousMetadataSync(id, trackId);
        } catch (e) {
          console.error("rekordbox_masterdb_resolve_ambiguous_metadata_sync failed", e);
          toast("Choix impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "mdsapply") {
      e.stopPropagation();
      const ids = [...mdsSyncSel];
      if (!ids.length) return;
      void (async () => {
        const proceed = await confirmAction(
          `Appliquer ${ids.length} synchro${ids.length > 1 ? "s" : ""} de metadata dans master.db ? Ferme Rekordbox avant de continuer.`,
          "Appliquer",
        );
        if (!proceed) return;
        try {
          const outcomes: ApplyMetadataSyncOutcome[] = await rekordboxMasterdbApplyMetadataSyncs(ids);
          let ok = 0;
          for (const o of outcomes) {
            mdsSyncSel.delete(o.id);
            if (o.ok) {
              mdsErrorById.delete(o.id);
              ok++;
            } else {
              mdsErrorById.set(o.id, o.error || "échec inconnu");
            }
          }
          const failed = outcomes.length - ok;
          toast(failed > 0 ? `${ok} synchro(s) appliquée(s), ${failed} échouée(s)` : `${ok} synchro(s) appliquée(s)`);
        } catch (e) {
          console.error("rekordbox_masterdb_apply_metadata_syncs failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "feat(m8): ecran synchro metadata Tier 3 sur la page Rekordbox"
```

---

### Task 10: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests PASS (no regression on the ~305+ existing tests plus the ~15 new ones from this plan).

- [ ] **Step 2: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 3: Frontend type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Confirm no concurrent `tauri dev`**

Before running any `cargo` command above, verify no other session has `npm run tauri dev` active on this repo (shared `target/` cache corruption risk — see project memory `avoid-concurrent-cargo-tauri-dev`). If one is running, ask the user before proceeding.

- [ ] **Step 5: Manual verification note**

This plan cannot itself verify the UI in the real `tauri dev` window (code gated `inTauri`, per project convention). After all tasks land, ask the user to open `tauri dev`, link a test Rekordbox XML, retag a linked track (via Ranger, "Appliquer les tags", or a Bibliothèque edit), and confirm the new "Synchros metadata master.db en attente" section appears on the Rekordbox page with the expected diff, and that applying it (with Rekordbox closed) succeeds.

- [ ] **Step 6: Update `docs/plan-implementation.md`'s M8 section**

Append a paragraph to the M8 section (after the existing Tier 3 paragraph ending "câblage IPC, hook de détection au filing, écran UI") recording that this IPC/hook/UI wiring is now shipped — mirror the phrasing style of the Tier 1/Tier 2 "livré" paragraphs already in that file.

- [ ] **Step 7: Update `docs/INDEX.json`**

Add an entry to the `"plans"` array for `docs/superpowers/plans/2026-07-09-m8-tier3-metadata-sync-ipc-ui.md`, same format as the neighboring M8 Tier 1/2 plan entries.

- [ ] **Step 8: Commit**

```bash
git add docs/plan-implementation.md docs/INDEX.json
git commit -m "docs(m8): Tier 3 IPC+UI livre, met a jour statut + index"
```
