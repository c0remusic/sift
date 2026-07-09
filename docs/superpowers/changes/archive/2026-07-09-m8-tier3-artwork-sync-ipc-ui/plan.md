# M8 Tier 3 — câblage IPC + hook filing + écran UI (synchro pochette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the already-shipped `sync_track_artwork` engine (`src-tauri/src/rekordbox_masterdb.rs:1288`) to the app: detect (read-only) when Sift writes a NEW cover onto a file linked to Rekordbox, list the candidates, and overwrite the 3 cached artwork files only after explicit user confirmation.

**Architecture:** A new shared detector (`actions::detect_masterdb_artwork_sync_if_linked` / `_with_index`) is called by the same 3 sites that already call the Tier 3 metadata detector (`filing.rs::commit_file`, `ipc_filing.rs::apply_tags`, `ipc_library.rs::update_metadata_inner`) — but only when `cover_path` is actually `Some` on that call (unlike metadata, which always fires). `filing.rs` reuses its already-loaded `master.db` index (no 3rd decrypt per commit). Detected candidates persist in a new table keyed by Sift `track_id`, storing `cover_path` (a string, not image bytes) — the file is re-read fresh at apply time. 4 IPC commands mirror Tier 3 metadata's exactly. A 4th section on the Rekordbox page (`frontend/rekordbox-view.ts`) mirrors the existing 3 sections' conventions.

**Tech Stack:** Rust (rusqlite, Tauri commands, `image` crate already added by the engine plan), vanilla TypeScript (no framework), SQLite migrations.

## Global Constraints

- Never auto-apply a write — every write requires `confirmAction()` in the UI (never `window.confirm()`).
- `sync_track_artwork` refuses to run while Rekordbox is open (`MasterDbError::RekordboxRunning`) — this plan never bypasses that guard.
- A failed row in a batch must never stop the rest of the batch (continue-on-failure).
- The detector fires ONLY when the call site's `cover_path` is `Some` on that specific write — an edit that only changes artist/title must never produce an artwork sync candidate.
- `cover_path` is stored as a string, not resolved bytes — `apply_artwork_syncs` re-reads the file from disk at apply time and fails explicitly (row stays `pending`) if it's gone.
- Design reference: `docs/superpowers/changes/2026-07-09-m8-tier3-artwork-sync-ipc-ui/design.md`.
- Prior art (byte-identical conventions to mirror): `src-tauri/src/actions.rs` (`detect_masterdb_metadata_sync_if_linked`/`_with_index`, `resolve_masterdb_index_if_linked`), `src-tauri/src/rekordbox_repairs.rs` (Tier 3 metadata IPC section, `humanize_masterdb_error`), `src-tauri/src/filing.rs:569-591` (post-commit loop).

---

### Task 1: Migration v14 — `rekordbox_masterdb_artwork_syncs` table

**Files:**
- Modify: `src-tauri/src/db.rs` (append to `MIGRATIONS`, update the two `table_count` assertions)

**Interfaces:**
- Produces: table `rekordbox_masterdb_artwork_syncs` with columns `id, action_id, track_id, rekordbox_track_id, candidate_track_ids, cover_path, status, detected_at, applied_at`, `UNIQUE(track_id)`.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/db.rs`, update the existing test (same convention as v13 — do not add a new one):

```rust
    #[test]
    fn migrations_create_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // v4 adds `settings`, v6 adds `track_genres`, v11 adds `rekordbox_masterdb_repairs`,
        // v13 adds `rekordbox_masterdb_metadata_syncs`, v14 adds `rekordbox_masterdb_artwork_syncs`
        assert_eq!(table_count(&conn).unwrap(), 10);
    }
```

Update `migrations_are_idempotent`'s assertion from `9` to `10` in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations_create_all_tables -- --nocapture`
Expected: FAIL — `9` vs expected `10`.

- [ ] **Step 3: Add the migration**

In `src-tauri/src/db.rs`, append to the `MIGRATIONS` array (after the v13 entry, before the closing `];`):

```rust
    // v14 — M8 Tier 3 IPC wiring (artwork): candidate master.db artwork syncs detected read-only
    // whenever Sift writes a NEW cover onto a file linked to Rekordbox (filing, apply_tags,
    // update_metadata) — only when cover_path is actually Some on that write, unlike v13's
    // metadata syncs which always fire. Keyed by Sift track_id, replaced on every fresh cover.
    // cover_path is a string (the source JPEG path), never resolved image bytes — re-read fresh
    // at apply time so a stale/moved file fails loudly instead of syncing wrong bytes.
    r#"
    CREATE TABLE rekordbox_masterdb_artwork_syncs (
        id INTEGER PRIMARY KEY,
        action_id INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        rekordbox_track_id TEXT,
        candidate_track_ids TEXT,
        cover_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        UNIQUE(track_id)
    );
    CREATE INDEX idx_rkbmdb_artsync_status ON rekordbox_masterdb_artwork_syncs(status);
    "#,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migrations_create_all_tables migrations_are_idempotent migrations_bring_db_to_latest_version -- --nocapture`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(m8): migration v14 pour rekordbox_masterdb_artwork_syncs"
```

---

### Task 2: Shared detector `detect_masterdb_artwork_sync_if_linked` / `_with_index`

**Files:**
- Modify: `src-tauri/src/actions.rs` (add the detector functions + tests, near `detect_masterdb_metadata_sync_with_index`)

**Interfaces:**
- Consumes: `resolve_masterdb_index_if_linked` (existing, `actions.rs:168`), `crate::rekordbox_masterdb::RekordboxIndex`.
- Produces:
  ```rust
  pub fn detect_masterdb_artwork_sync_if_linked(conn: &Connection, lookup_path: &str, track_id: i64, cover_path: &str, action_id: i64);
  pub fn detect_masterdb_artwork_sync_with_index(conn: &Connection, index: &crate::rekordbox_masterdb::RekordboxIndex, lookup_path: &str, track_id: i64, cover_path: &str, action_id: i64);
  ```
  Later tasks (filing.rs, apply_tags, update_metadata) call these directly.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/actions.rs`, inside `mod tests` (near the existing `detect_masterdb_metadata_sync_*` tests, reusing `db()`/`seed_pioneer_dir_with_fixture`/`seed_sift_track` already defined there):

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_masterdb_artwork_sync -- --nocapture`
Expected: FAIL to compile — the functions don't exist yet.

- [ ] **Step 3: Implement the detector**

Add to `src-tauri/src/actions.rs` (near `detect_masterdb_metadata_sync_with_index`, after it):

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_masterdb_artwork_sync -- --nocapture`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/actions.rs
git commit -m "feat(m8): detecteur partage detect_masterdb_artwork_sync_if_linked"
```

---

### Task 3: Wire `filing.rs::commit_file` to the artwork detector

**Files:**
- Modify: `src-tauri/src/filing.rs` (`commit_file`'s post-commit loop, `~line 569-591`)

**Interfaces:**
- Consumes: `actions::detect_masterdb_artwork_sync_with_index` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/filing.rs`'s `#[cfg(test)] mod tests` (near `commit_file_conformant_detects_masterdb_metadata_sync`), reusing `seed_pioneer_dir_with_fixture`/`patch_fixture_folder_path` already defined there:

```rust
    #[test]
    fn commit_file_conformant_detects_masterdb_artwork_sync_only_when_cover_changes() {
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

        // No cover_path set on this track's metadata row — commit must NOT create an artwork
        // sync candidate, only a metadata one (already covered by the sibling test).
        let res = file_track(&conn, &root, "{artist} - {title}", id, "House", None, Some(Canonical {
            artist: "Larry Heard".into(), title: "Can You Feel It".into(), version: None,
            confidence: crate::naming::Confidence::Green,
        }), false).unwrap();
        let _ = res;

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "no cover_path on this track — must not create an artwork sync candidate");
    }

    #[test]
    fn commit_file_conformant_detects_masterdb_artwork_sync_when_cover_present() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        conn.execute(
            "INSERT INTO metadata(track_id, cover_path) VALUES (?1, '/cache/covers/999.jpg')
             ON CONFLICT(track_id) DO UPDATE SET cover_path=excluded.cover_path",
            params![id],
        ).unwrap();

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let res = file_track(&conn, &root, "{artist} - {title}", id, "House", None, Some(Canonical {
            artist: "Larry Heard".into(), title: "Can You Feel It".into(), version: None,
            confidence: crate::naming::Confidence::Green,
        }), false).unwrap();
        let _ = res;

        let (cover_path, status): (String, String) = conn
            .query_row(
                "SELECT cover_path, status FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected an artwork sync candidate");
        assert_eq!(cover_path, "/cache/covers/999.jpg");
        assert_eq!(status, "pending");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_conformant_detects_masterdb_artwork_sync -- --nocapture`
Expected: the "when cover present" test FAILs (no row found — detector never called). The "only when cover changes" test currently already passes vacuously (no such call exists yet) — that's fine, it becomes a real regression guard once Step 3 lands.

- [ ] **Step 3: Wire the call**

In `src-tauri/src/filing.rs`, extend `commit_file`'s post-commit loop (the `if matches!(fs.kind, "move" | "convert")` block that already builds `MetadataSyncValues`):

```rust
    let masterdb_index = actions::resolve_masterdb_index_if_linked(conn);
    for (fs, action_id) in log.iter().zip(action_ids.iter()) {
        actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to));
        if let Some(index) = &masterdb_index {
            actions::maybe_detect_masterdb_repair_with_index(conn, index, fs.kind, Some(&fs.from), Some(&fs.to), *action_id);
            if matches!(fs.kind, "move" | "convert") {
                let (genre, label) = actions::sanitize_genre_label(&plan.extras.genres, plan.extras.label.as_deref());
                let values = actions::MetadataSyncValues {
                    artist: Some(plan.canonical.artist.clone()),
                    title: Some(naming::tag_title(&plan.canonical)),
                    label,
                    year: plan.extras.year,
                    genre,
                };
                actions::detect_masterdb_metadata_sync_with_index(conn, index, &fs.from, plan.track_id, &values, *action_id);
                if let Some(cover_path) = &plan.extras.cover_path {
                    actions::detect_masterdb_artwork_sync_with_index(conn, index, &fs.from, plan.track_id, cover_path, *action_id);
                }
            }
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commit_file_conformant_detects_masterdb_artwork_sync -- --nocapture`
Expected: PASS (2/2).

- [ ] **Step 5: Run the whole filing.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib filing:: -- --nocapture`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/filing.rs
git commit -m "feat(m8): commit_file detecte les candidats de synchro pochette Tier 3"
```

---

### Task 4: Wire `update_metadata_inner` (`ipc_library.rs`) to the artwork detector

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (`update_metadata_inner`, `~line 29-72`)

**Interfaces:**
- Consumes: `actions::detect_masterdb_artwork_sync_if_linked` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/ipc_library.rs`'s test module (mirroring `update_metadata_calls_masterdb_metadata_sync_detection_when_linked`, reusing its exact fixture-patching setup):

```rust
    #[test]
    fn update_metadata_calls_masterdb_artwork_sync_detection_only_when_cover_edited() {
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

        // (1) Edit WITHOUT touching the cover — no artwork candidate expected.
        let edit_no_cover = crate::metadata::MetadataEdit {
            artist: "New Artist".to_string(), title: "New Title".to_string(),
            label: None, year: None, genres: vec![], cover_path: None,
        };
        update_metadata_inner(&conn, track_id, edit_no_cover).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", rusqlite::params![track_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "no cover_path in this edit — must not create an artwork sync candidate");

        // (2) Edit WITH a new cover — artwork candidate expected.
        let edit_with_cover = crate::metadata::MetadataEdit {
            artist: "New Artist".to_string(), title: "New Title".to_string(),
            label: None, year: None, genres: vec![], cover_path: Some("/cache/covers/999.jpg".to_string()),
        };
        update_metadata_inner(&conn, track_id, edit_with_cover).unwrap();
        let cover_path: String = conn.query_row("SELECT cover_path FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1", rusqlite::params![track_id], |r| r.get(0)).unwrap();
        assert_eq!(cover_path, "/cache/covers/999.jpg");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_metadata_calls_masterdb_artwork_sync -- --nocapture`
Expected: FAIL — no row found after step (2) (detector never called).

- [ ] **Step 3: Wire the call**

In `src-tauri/src/ipc_library.rs`, extend `update_metadata_inner` (after the existing metadata-sync detection call, step (6)):

```rust
    // (7) M8 Tier 3 (pochette): only when THIS edit actually changed the cover — unlike the
    // metadata detector above, which always fires.
    if let Some(cover_path) = &edit.cover_path {
        actions::detect_masterdb_artwork_sync_if_linked(conn, &path, track_id, cover_path, action_id);
    }

    Ok(batch_id)
```

(This replaces the existing `Ok(batch_id)` at the end of the function — the new block goes immediately before it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_metadata_calls_masterdb_artwork_sync -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Run the whole ipc_library.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib ipc_library:: -- --nocapture`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc_library.rs
git commit -m "feat(m8): update_metadata detecte les candidats de synchro pochette Tier 3"
```

---

### Task 5: Wire `apply_tags` (`ipc_filing.rs`) to the artwork detector

**Files:**
- Modify: `src-tauri/src/ipc_filing.rs` (`apply_tags`, `~line 194-244`)

**Interfaces:**
- Consumes: `actions::detect_masterdb_artwork_sync_if_linked` (Task 2).

**Note on testability:** same limitation as the metadata wiring (Task 5 of the sibling plan) — `apply_tags` has no `_inner` split (locks the connection twice around a disk write, by design). The gating condition itself (`extras.cover_path.is_some()`) is a plain field read, not worth its own pure-function extraction — this task's only test is the manual end-to-end check in Task 10.

- [ ] **Step 1: Wire the call**

In `src-tauri/src/ipc_filing.rs`, extend `apply_tags`'s existing second locked block (right after the Task-2-era `detect_masterdb_metadata_sync_if_linked` call):

```rust
        // M8 Tier 3: detect (read-only) a metadata sync candidate when linked to Rekordbox.
        let values = metadata_sync_values_for_apply_tags(&edited, &extras);
        actions::detect_masterdb_metadata_sync_if_linked(&conn, &path, track_id, &values, action_id);

        // M8 Tier 3 (pochette): only when this track actually has a stored cover — apply_tags
        // never changes the cover itself (it just re-applies whatever's already in `extras`), so
        // this only matters the first time a cover exists and hasn't been synced yet.
        if let Some(cover_path) = &extras.cover_path {
            actions::detect_masterdb_artwork_sync_if_linked(&conn, &path, track_id, cover_path, action_id);
        }
```

- [ ] **Step 2: Run the whole ipc_filing.rs test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib ipc_filing:: -- --nocapture`
Expected: PASS, no regression (this task adds no new unit test — see the testability note above).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ipc_filing.rs
git commit -m "feat(m8): apply_tags detecte les candidats de synchro pochette Tier 3"
```

---

### Task 6: `humanize_masterdb_error` — 4 new artwork error variants

**Files:**
- Modify: `src-tauri/src/rekordbox_repairs.rs` (`humanize_masterdb_error`, `~line 61-83`)

**Interfaces:**
- Consumes: `MasterDbError::{NoArtworkPath, ArtworkVariantMissing, ArtworkWriteVerificationFailedRolledBack, ArtworkWriteVerificationFailedRollbackFailed}` (already defined by the engine plan, `rekordbox_masterdb.rs`).

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/rekordbox_repairs.rs`'s `mod tests`:

```rust
    #[test]
    fn humanize_masterdb_error_covers_artwork_variants() {
        use crate::rekordbox_masterdb::MasterDbError;
        assert!(humanize_masterdb_error(&MasterDbError::NoArtworkPath { track_id: "40000001".to_string() }).contains("40000001"));
        assert!(humanize_masterdb_error(&MasterDbError::ArtworkVariantMissing { path: "C:/x/artwork_m.jpg".to_string() }).contains("artwork_m.jpg"));
        assert!(humanize_masterdb_error(&MasterDbError::ArtworkWriteVerificationFailedRolledBack("dim mismatch".to_string())).contains("dim mismatch"));
        assert!(humanize_masterdb_error(&MasterDbError::ArtworkWriteVerificationFailedRollbackFailed("dim mismatch".to_string())).contains("intervention manuelle"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml humanize_masterdb_error_covers_artwork_variants -- --nocapture`
Expected: FAIL — the 4 variants currently fall through to the catch-all `other => other.to_string()` arm, which doesn't contain the human phrases asserted above (e.g. no `"intervention manuelle"` substring).

- [ ] **Step 3: Add the 4 match arms**

In `src-tauri/src/rekordbox_repairs.rs`, extend `humanize_masterdb_error`'s `match e` (insert before the `other => other.to_string()` catch-all):

```rust
        MasterDbError::NoArtworkPath { track_id } => format!(
            "la piste {track_id} n'a pas de pochette dans master.db — aucune synchro possible"
        ),
        MasterDbError::ArtworkVariantMissing { path } => format!(
            "fichier pochette manquant côté Rekordbox ({path}) — bibliothèque peut-être corrompue ou jamais scannée"
        ),
        MasterDbError::ArtworkWriteVerificationFailedRolledBack(m) => format!(
            "l'écriture de la pochette a échoué à la vérification, la sauvegarde a été restaurée automatiquement : {m}"
        ),
        MasterDbError::ArtworkWriteVerificationFailedRollbackFailed(m) => format!(
            "l'écriture ET la restauration de la pochette ont échoué — intervention manuelle nécessaire : {m}"
        ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml humanize_masterdb_error_covers_artwork_variants -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rekordbox_repairs.rs
git commit -m "feat(m8): humanize_masterdb_error couvre les 4 variantes pochette"
```

---

### Task 7: IPC commands — `pending_artwork_syncs`, `dismiss_artwork_sync`, `resolve_ambiguous_artwork_sync`

**Files:**
- Modify: `src-tauri/src/rekordbox_repairs.rs` (new section "M8 Tier 3 (pochette)", after the existing metadata-sync section)
- Modify: `src-tauri/src/ipc_library.rs` (3 thin `#[tauri::command]` wrappers, same pattern as the existing Tier 1/2/3 ones)

**Interfaces:**
- Consumes: existing `CandidateTrack` (`rekordbox_repairs.rs:38`), existing `read_masterdb_path_map` (`rekordbox_repairs.rs:88`).
- Produces:
  ```rust
  pub struct PendingArtworkSync {
      pub id: i64, pub track_id: i64, pub sift_path: String,
      pub rekordbox_track_id: Option<String>, pub candidate_track_ids: Option<String>,
      pub candidate_tracks: Option<Vec<CandidateTrack>>, pub cover_path: String,
      pub status: String, pub detected_at: String,
  }
  fn rekordbox_masterdb_pending_artwork_syncs_inner(conn: &Connection) -> Result<Vec<PendingArtworkSync>, String>;
  fn rekordbox_masterdb_dismiss_artwork_sync_inner(conn: &Connection, id: i64) -> Result<(), String>;
  fn rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String>;
  ```
  Task 8 adds `rekordbox_masterdb_apply_artwork_syncs` in the same section.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/rekordbox_repairs.rs`'s `mod tests`:

```rust
    fn seed_artwork_sync_row(conn: &Connection, track_id: i64, status: &str, rb_track_id: Option<&str>, candidates: Option<&str>, cover_path: &str) -> i64 {
        let action_id = crate::actions::record_row_only(conn, "b1", Some(track_id), "tag_edit", Some("D:/x.mp3"), None, None).unwrap();
        conn.execute(
            "INSERT INTO rekordbox_masterdb_artwork_syncs
                 (action_id, track_id, rekordbox_track_id, candidate_track_ids, cover_path, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![action_id, track_id, rb_track_id, candidates, cover_path, status],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn pending_artwork_syncs_excludes_applied_and_dismissed() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        seed_artwork_sync_row(&conn, track_id, "pending", Some("40000001"), None, "/cache/a.jpg");

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/b.mp3', 'filed')", []).unwrap();
        let track_id_2 = conn.last_insert_rowid();
        let id2 = seed_artwork_sync_row(&conn, track_id_2, "applied", Some("40000002"), None, "/cache/b.jpg");
        conn.execute("UPDATE rekordbox_masterdb_artwork_syncs SET status='dismissed' WHERE id=?1", rusqlite::params![id2]).ok();

        let rows = rekordbox_masterdb_pending_artwork_syncs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "pending");
        assert_eq!(rows[0].cover_path, "/cache/a.jpg");
    }

    #[test]
    fn dismiss_artwork_sync_marks_dismissed() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_artwork_sync_row(&conn, track_id, "pending", Some("40000001"), None, "/cache/a.jpg");

        rekordbox_masterdb_dismiss_artwork_sync_inner(&conn, id).unwrap();

        let rows = rekordbox_masterdb_pending_artwork_syncs_inner(&conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn resolve_ambiguous_artwork_sync_moves_to_pending() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_artwork_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"), "/cache/a.jpg");

        rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(&conn, id, "40000002").unwrap();

        let rows = rekordbox_masterdb_pending_artwork_syncs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "pending");
        assert_eq!(rows[0].rekordbox_track_id.as_deref(), Some("40000002"));
        assert_eq!(rows[0].candidate_track_ids, None);
    }

    #[test]
    fn resolve_ambiguous_artwork_sync_rejects_track_id_outside_candidate_list() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_artwork_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"), "/cache/a.jpg");

        let err = rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(&conn, id, "99999999").unwrap_err();
        assert!(err.contains("invalide"));
    }

    #[test]
    fn resolve_ambiguous_artwork_sync_rejects_row_that_is_not_ambiguous() {
        let conn = db();
        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/a.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_artwork_sync_row(&conn, track_id, "pending", Some("40000001"), None, "/cache/a.jpg");

        let err = rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(&conn, id, "40000001").unwrap_err();
        assert!(err.contains("ambigu"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pending_artwork_syncs dismiss_artwork_sync resolve_ambiguous_artwork_sync -- --nocapture`
Expected: FAIL to compile — none of these functions exist yet.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/rekordbox_repairs.rs`, after the existing "M8 Tier 3: master.db metadata sync candidates" section (before the "M8 Tier 2" section comment):

```rust
// ── M8 Tier 3 (pochette): master.db artwork sync candidates ───────────────────

/// One candidate artwork sync, keyed by Sift `track_id` — a fresh cover before the user applies
/// replaces this row rather than adding another. `cover_path` is the source JPEG path, re-read
/// fresh at apply time (see `rekordbox_masterdb_apply_artwork_syncs`), never resolved bytes.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingArtworkSync {
    pub id: i64,
    pub track_id: i64,
    pub sift_path: String,
    pub rekordbox_track_id: Option<String>,
    pub candidate_track_ids: Option<String>,
    pub candidate_tracks: Option<Vec<CandidateTrack>>,
    pub cover_path: String,
    pub status: String,
    pub detected_at: String,
}

/// Plain (testable) implementation of `rekordbox_masterdb_pending_artwork_syncs`.
pub(crate) fn rekordbox_masterdb_pending_artwork_syncs_inner(conn: &Connection) -> Result<Vec<PendingArtworkSync>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.track_id, t.path, s.rekordbox_track_id, s.candidate_track_ids, s.cover_path, s.status, s.detected_at
             FROM rekordbox_masterdb_artwork_syncs s
             JOIN tracks t ON t.id = s.track_id
             WHERE s.status IN ('pending', 'ambiguous')
             ORDER BY s.detected_at",
        )
        .map_err(|e| e.to_string())?;
    let mut rows: Vec<PendingArtworkSync> = stmt
        .query_map([], |r| {
            Ok(PendingArtworkSync {
                id: r.get(0)?,
                track_id: r.get(1)?,
                sift_path: r.get(2)?,
                rekordbox_track_id: r.get(3)?,
                candidate_track_ids: r.get(4)?,
                candidate_tracks: None,
                cover_path: r.get(5)?,
                status: r.get(6)?,
                detected_at: r.get(7)?,
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

/// Plain (testable) implementation of `rekordbox_masterdb_dismiss_artwork_sync`.
pub(crate) fn rekordbox_masterdb_dismiss_artwork_sync_inner(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("UPDATE rekordbox_masterdb_artwork_syncs SET status='dismissed' WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Plain (testable) implementation of `rekordbox_masterdb_resolve_ambiguous_artwork_sync`.
pub(crate) fn rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String> {
    let (candidate_track_ids, status): (Option<String>, String) = conn
        .query_row(
            "SELECT candidate_track_ids, status FROM rekordbox_masterdb_artwork_syncs WHERE id=?1",
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
        "UPDATE rekordbox_masterdb_artwork_syncs SET rekordbox_track_id=?1, candidate_track_ids=NULL, status='pending' WHERE id=?2",
        rusqlite::params![chosen_track_id, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Register the thin `#[tauri::command]` wrappers in `ipc_library.rs`**

Add to `src-tauri/src/ipc_library.rs`, near the existing Tier 3 metadata wrappers (`rekordbox_masterdb_pending_metadata_syncs` etc.):

```rust
/// Candidate `master.db` artwork syncs detected so far, excluding ones already `applied` or
/// `dismissed`.
#[tauri::command]
pub fn rekordbox_masterdb_pending_artwork_syncs(conn: State<'_, Mutex<Connection>>) -> Result<Vec<crate::rekordbox_repairs::PendingArtworkSync>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_pending_artwork_syncs_inner(&conn)
}

/// Mark a pending/ambiguous artwork sync as dismissed.
#[tauri::command]
pub fn rekordbox_masterdb_dismiss_artwork_sync(conn: State<'_, Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_dismiss_artwork_sync_inner(&conn, id)
}

/// Resolves an ambiguous artwork sync by manually picking the correct `master.db` candidate.
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous_artwork_sync(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_resolve_ambiguous_artwork_sync_inner(&conn, id, &chosen_track_id)
}
```

Check the top of `src-tauri/src/ipc_library.rs` — if `PendingMetadataSync` or other `rekordbox_repairs` types are already referenced via a `use crate::rekordbox_repairs::{...}` import, add `PendingArtworkSync` to that same import instead of qualifying it inline as `crate::rekordbox_repairs::PendingArtworkSync` above (match whatever style the file already uses for the Tier 3 metadata equivalents — check before choosing).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pending_artwork_syncs dismiss_artwork_sync resolve_ambiguous_artwork_sync -- --nocapture`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/rekordbox_repairs.rs src-tauri/src/ipc_library.rs
git commit -m "feat(m8): commandes IPC pending/dismiss/resolve_ambiguous pour Tier 3 pochette"
```

---

### Task 8: IPC command — `apply_artwork_syncs`

**Files:**
- Modify: `src-tauri/src/rekordbox_repairs.rs` (same new section, after Task 7's code)
- Modify: `src-tauri/src/ipc_library.rs` (thin wrapper)
- Modify: `src-tauri/src/lib.rs` (register the 4 new commands)

**Interfaces:**
- Consumes: `crate::rekordbox_masterdb::sync_track_artwork` (existing, `rekordbox_masterdb.rs:1288`), `humanize_masterdb_error` (Task 6).
- Produces:
  ```rust
  pub struct ApplyArtworkSyncOutcome { pub id: i64, pub ok: bool, pub error: Option<String> }
  #[tauri::command] pub fn rekordbox_masterdb_apply_artwork_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<ApplyArtworkSyncOutcome>, String>;
  ```

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/rekordbox_repairs.rs`'s `mod tests`. These need real artwork files on disk (the engine refuses `ArtworkVariantMissing` otherwise) — write a small local JPEG helper (this test module has no access to `rekordbox_masterdb.rs`'s private `mod tests` helpers, same discipline as 3 pre-existing local `fixture()`/`toast()` duplicates elsewhere in this codebase):

```rust
    fn tiny_jpeg(w: u32, h: u32) -> Vec<u8> {
        use image::ImageEncoder;
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([5, 5, 5]));
        let mut buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90)
            .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8)
            .unwrap();
        buf
    }

    #[test]
    fn apply_artwork_syncs_applies_pending_row() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/rekordbox_master.db"), pioneer_dir.join("master.db")).unwrap();
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // track 40000001's fixture ImagePath: /PIONEER/Artwork/aaaa/artwork.jpg — seed the 3
        // variant files the engine expects to already exist.
        let share_dir = pioneer_dir.join("share/PIONEER/Artwork/aaaa");
        std::fs::create_dir_all(&share_dir).unwrap();
        std::fs::write(share_dir.join("artwork.jpg"), tiny_jpeg(100, 100)).unwrap();
        std::fs::write(share_dir.join("artwork_m.jpg"), tiny_jpeg(50, 50)).unwrap();
        std::fs::write(share_dir.join("artwork_s.jpg"), tiny_jpeg(20, 20)).unwrap();

        let cover_dir = tmp.path().join("covers");
        std::fs::create_dir_all(&cover_dir).unwrap();
        let cover_path = cover_dir.join("new_cover.jpg");
        std::fs::write(&cover_path, tiny_jpeg(300, 300)).unwrap();

        conn.execute("INSERT INTO tracks(path, status) VALUES('D:/FIXTURE/track1.mp3', 'filed')", []).unwrap();
        let track_id = conn.last_insert_rowid();
        let id = seed_artwork_sync_row(&conn, track_id, "pending", Some("40000001"), None, cover_path.to_str().unwrap());

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_artwork_syncs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].ok, "expected ok, got error: {:?}", outcomes[0].error);

        let status: String = conn.query_row("SELECT status FROM rekordbox_masterdb_artwork_syncs WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "applied");
        assert_eq!(image::image_dimensions(share_dir.join("artwork.jpg")).unwrap(), (100, 100));
    }

    #[test]
    fn apply_artwork_syncs_fails_loudly_when_source_cover_file_is_gone() {
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
        let missing_cover = tmp.path().join("does-not-exist.jpg");
        let id = seed_artwork_sync_row(&conn, track_id, "pending", Some("40000001"), None, missing_cover.to_str().unwrap());

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_artwork_syncs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].ok);
        assert!(outcomes[0].error.as_deref().unwrap().contains("n'existe plus"));

        let status: String = conn.query_row("SELECT status FROM rekordbox_masterdb_artwork_syncs WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "pending", "a failed row must stay pending, retryable");
    }

    #[test]
    fn apply_artwork_syncs_rejects_ambiguous_row_without_calling_engine() {
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
        let id = seed_artwork_sync_row(&conn, track_id, "ambiguous", None, Some("40000001,40000002"), "/cache/a.jpg");

        let backup_root = tmp.path().join("backups");
        let outcomes = rekordbox_masterdb_apply_artwork_syncs_inner(&conn, &backup_root, &[id]).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].ok);
        assert!(outcomes[0].error.as_deref().unwrap().contains("ambigu"));

        let status: String = conn.query_row("SELECT status FROM rekordbox_masterdb_artwork_syncs WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap();
        assert_eq!(status, "ambiguous", "must not have been touched");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml apply_artwork_syncs -- --nocapture`
Expected: FAIL to compile — `rekordbox_masterdb_apply_artwork_syncs_inner` not defined.

- [ ] **Step 3: Implement**

Add after Task 7's code in `src-tauri/src/rekordbox_repairs.rs`:

```rust
/// Result of attempting to apply one pending artwork sync.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApplyArtworkSyncOutcome {
    pub id: i64,
    pub ok: bool,
    pub error: Option<String>,
}

/// Attempts one artwork sync row. Never calls `sync_track_artwork` for a row that isn't `pending`
/// with a known `rekordbox_track_id`; never syncs stale bytes — `cover_path` is re-read from disk
/// here, at apply time, not at detection time.
fn apply_one_artwork_sync(conn: &Connection, pioneer_dir: &Path, backup_root: &Path, batch_stamp: &str, id: i64) -> ApplyArtworkSyncOutcome {
    let row = conn.query_row(
        "SELECT rekordbox_track_id, cover_path, status FROM rekordbox_masterdb_artwork_syncs WHERE id=?1",
        rusqlite::params![id],
        |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    let (rekordbox_track_id, cover_path, status) = match row {
        Ok(v) => v,
        Err(e) => return ApplyArtworkSyncOutcome { id, ok: false, error: Some(e.to_string()) },
    };

    let Some(rekordbox_track_id) = rekordbox_track_id.filter(|_| status == "pending") else {
        return ApplyArtworkSyncOutcome {
            id,
            ok: false,
            error: Some("piste ambiguë ou déjà traitée — résolution manuelle requise".to_string()),
        };
    };

    let cover_bytes = match std::fs::read(&cover_path) {
        Ok(b) => b,
        Err(_) => {
            return ApplyArtworkSyncOutcome {
                id,
                ok: false,
                error: Some(format!("le fichier de pochette source n'existe plus — {cover_path}")),
            };
        }
    };

    let backup_dir = backup_root.join(batch_stamp).join(id.to_string());
    match crate::rekordbox_masterdb::sync_track_artwork(pioneer_dir, &backup_dir, &rekordbox_track_id, &cover_bytes) {
        Ok(()) => {
            if let Err(e) = conn.execute(
                "UPDATE rekordbox_masterdb_artwork_syncs SET status='applied', applied_at=datetime('now') WHERE id=?1",
                rusqlite::params![id],
            ) {
                return ApplyArtworkSyncOutcome { id, ok: false, error: Some(e.to_string()) };
            }
            ApplyArtworkSyncOutcome { id, ok: true, error: None }
        }
        Err(e) => ApplyArtworkSyncOutcome { id, ok: false, error: Some(humanize_masterdb_error(&e)) },
    }
}

/// Plain (testable) implementation of `rekordbox_masterdb_apply_artwork_syncs`.
pub(crate) fn rekordbox_masterdb_apply_artwork_syncs_inner(conn: &Connection, backup_root: &Path, ids: &[i64]) -> Result<Vec<ApplyArtworkSyncOutcome>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;

    let batch_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut outcomes = Vec::with_capacity(ids.len());
    for &id in ids {
        outcomes.push(apply_one_artwork_sync(conn, pioneer_dir, backup_root, &batch_stamp, id));
    }
    Ok(outcomes)
}
```

- [ ] **Step 4: Add the thin wrapper in `ipc_library.rs`**

```rust
/// Applies the given pending/ambiguous artwork sync `id`s against the linked Rekordbox's cached
/// artwork files, one at a time. Never invoked automatically. Backups land under
/// `app_data_dir()/rekordbox-backups/<batch timestamp>/<id>/`, same convention as the other tiers.
#[tauri::command]
pub fn rekordbox_masterdb_apply_artwork_syncs(app: AppHandle, conn: State<'_, Mutex<Connection>>, ids: Vec<i64>) -> Result<Vec<crate::rekordbox_repairs::ApplyArtworkSyncOutcome>, String> {
    let backup_root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::rekordbox_repairs::rekordbox_masterdb_apply_artwork_syncs_inner(&conn, &backup_root, &ids)
}
```

- [ ] **Step 5: Register the 4 new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find `tauri::generate_handler![...]` (search for `rekordbox_masterdb_apply_metadata_syncs` — already registered) and add next to it:

```rust
            ipc_library::rekordbox_masterdb_pending_artwork_syncs,
            ipc_library::rekordbox_masterdb_apply_artwork_syncs,
            ipc_library::rekordbox_masterdb_dismiss_artwork_sync,
            ipc_library::rekordbox_masterdb_resolve_ambiguous_artwork_sync,
```

- [ ] **Step 6: Full backend build + test + clippy**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no regression.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/rekordbox_repairs.rs src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(m8): commande IPC apply_artwork_syncs, enregistrement lib.rs"
```

---

### Task 9: Frontend types + `ipc.ts` wrappers

**Files:**
- Modify: `shared/contracts.ts` (add types)
- Modify: `frontend/ipc.ts` (add wrappers)

**Interfaces:**
- Produces (TS): `PendingArtworkSync`, `ApplyArtworkSyncOutcome` interfaces; `rekordboxMasterdbPendingArtworkSyncs()`, `rekordboxMasterdbApplyArtworkSyncs(ids)`, `rekordboxMasterdbDismissArtworkSync(id)`, `rekordboxMasterdbResolveAmbiguousArtworkSync(id, chosenTrackId)`.

- [ ] **Step 1: Add types to `shared/contracts.ts`**

After the existing `ApplyMetadataSyncOutcome` interface, add:

```typescript
// ---- M8 Tier 3 master.db artwork sync candidates (mirror of src-tauri/src/rekordbox_repairs.rs) ----

export interface PendingArtworkSync {
  id: number;
  track_id: number;
  sift_path: string;
  rekordbox_track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  cover_path: string;
  status: "pending" | "ambiguous";
  detected_at: string;
}

export interface ApplyArtworkSyncOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}
```

- [ ] **Step 2: Add wrappers to `frontend/ipc.ts`**

In the `import type { ... } from "../shared/contracts"` block, add `PendingArtworkSync` and `ApplyArtworkSyncOutcome` next to the existing `PendingMetadataSync`/`ApplyMetadataSyncOutcome` imports.

After the existing `rekordboxMasterdbResolveAmbiguousMetadataSync` wrapper, add:

```typescript
export const rekordboxMasterdbPendingArtworkSyncs = (): Promise<PendingArtworkSync[]> =>
  invoke("rekordbox_masterdb_pending_artwork_syncs");

export const rekordboxMasterdbApplyArtworkSyncs = (ids: number[]): Promise<ApplyArtworkSyncOutcome[]> =>
  invoke("rekordbox_masterdb_apply_artwork_syncs", { ids });

export const rekordboxMasterdbDismissArtworkSync = (id: number): Promise<void> =>
  invoke("rekordbox_masterdb_dismiss_artwork_sync", { id });

export const rekordboxMasterdbResolveAmbiguousArtworkSync = (id: number, chosenTrackId: string): Promise<void> =>
  invoke("rekordbox_masterdb_resolve_ambiguous_artwork_sync", { id, chosenTrackId });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add shared/contracts.ts frontend/ipc.ts
git commit -m "feat(m8): types+wrappers IPC Tier 3 pochette"
```

---

### Task 10: UI section on the Rekordbox page

**Files:**
- Modify: `frontend/rekordbox-view.ts` (imports, module-level state, `artworkSyncsSectionHtml`, `renderRekordboxLive`)
- Modify: `frontend/sift-live.ts` (delegated click handler — `mas*` branches, same file/pattern as the existing `mds*` branches)

**Interfaces:**
- Consumes: Task 9's `ipc.ts` wrappers + `shared/contracts.ts` types.

- [ ] **Step 1: Imports + module-level state in `rekordbox-view.ts`**

In `frontend/rekordbox-view.ts`'s `import { ... } from "./ipc"` block, add `rekordboxMasterdbPendingArtworkSyncs` next to `rekordboxMasterdbPendingMetadataSyncs`.

In the `import type { ... } from "../shared/contracts"` block, add `PendingArtworkSync`.

Near the existing `mdsSyncSel`/`mdsErrorById` declarations, add:

```typescript
// M8 Tier 3 (pochette) artwork-syncs section state — same module-level, filtered-not-reset
// discipline as mdsSyncSel.
export const masSyncSel = new Set<number>();
export const masErrorById = new Map<number, string>();
```

- [ ] **Step 2: `artworkSyncsSectionHtml`**

After `metadataSyncsSectionHtml`, add:

```typescript
/** M8 Tier 3 (pochette) section: lists master.db artwork sync candidates detected passively
 * whenever Sift writes a NEW cover onto a file linked to Rekordbox. Independent of
 * metadataSyncsSectionHtml (separate table, separate detector — a text-only retag never lands
 * here). Renders "" when nothing pending/ambiguous. */
function artworkSyncsSectionHtml(rows: PendingArtworkSync[]): string {
  if (rows.length === 0) return "";
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...masSyncSel]) if (!liveIds.has(id)) masSyncSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");

  const coverFileName = (p: string) => p.split(/[\\/]/).pop() || p;

  const infoBlock = (r: PendingArtworkSync) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.sift_path)}</div>` +
    `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Nouvelle pochette : ${esc(coverFileName(r.cover_path))}</div>` +
    (masErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(masErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingArtworkSync): CandidateTrack[] =>
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
            `<button data-sift="masresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${infoBlock(r)}` +
        `<button data-sift="masdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRows = pending
    .map((r) => {
      const checked = masSyncSel.has(r.id);
      return (
        `<div class="bx-row" data-sift="maspick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
          checked ? "background:var(--overlay-hover)" : ""
        }">` +
        `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
        infoBlock(r) +
        `<button data-sift="masdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
        `</div>`
      );
    })
    .join("");

  const applyBar =
    masSyncSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="masapply" style="font-weight:500">Appliquer la sélection (${masSyncSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Synchros pochette master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}
```

- [ ] **Step 3: Wire into `renderRekordboxLive`**

In `renderRekordboxLive` (`frontend/rekordbox-view.ts`), after the existing `metadataSyncSection` block and before the final `content.innerHTML = ...`:

```typescript
  let artworkSyncSection = "";
  try {
    const artworkSyncs = await rekordboxMasterdbPendingArtworkSyncs();
    artworkSyncSection = artworkSyncsSectionHtml(artworkSyncs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_artwork_syncs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection + dedupSection + metadataSyncSection + artworkSyncSection;
```

(replacing the existing final line, which omits `artworkSyncSection`.)

- [ ] **Step 4: Click handler in `sift-live.ts`**

In `frontend/sift-live.ts`'s import from `./rekordbox-view`, add `masSyncSel`, `masErrorById`, `rekordboxMasterdbDismissArtworkSync`, `rekordboxMasterdbResolveAmbiguousArtworkSync`, `rekordboxMasterdbApplyArtworkSyncs` — check whether the IPC wrappers are imported from `./ipc` or re-exported via `./rekordbox-view` in this file already (mirror whichever pattern the existing `mds*` imports use, `frontend/sift-live.ts:73-78`).

In the same delegated click handler that already handles `mdspick`/`mdsdismiss`/`mdsresolve`/`mdsapply` (`frontend/sift-live.ts:1794-1859`), add 4 new branches right after the existing `mdsapply` branch, before the closing `}` of the `if/else if` chain:

```typescript
    } else if (act === "maspick") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      if (masSyncSel.has(id)) {
        masSyncSel.delete(id);
      } else {
        masSyncSel.add(id);
        masErrorById.delete(id);
      }
      void renderRekordboxLive();
    } else if (act === "masdismiss") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      void (async () => {
        try {
          await rekordboxMasterdbDismissArtworkSync(id);
        } catch (e) {
          console.error("rekordbox_masterdb_dismiss_artwork_sync failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "masresolve") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      const trackId = el.dataset.track || "";
      void (async () => {
        try {
          await rekordboxMasterdbResolveAmbiguousArtworkSync(id, trackId);
        } catch (e) {
          console.error("rekordbox_masterdb_resolve_ambiguous_artwork_sync failed", e);
          toast("Choix impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "masapply") {
      e.stopPropagation();
      const ids = [...masSyncSel];
      if (!ids.length) return;
      void (async () => {
        const proceed = await confirmAction(
          `Appliquer ${ids.length} synchro${ids.length > 1 ? "s" : ""} de pochette dans master.db ? Ferme Rekordbox avant de continuer.`,
          "Appliquer",
        );
        if (!proceed) return;
        try {
          const outcomes = await rekordboxMasterdbApplyArtworkSyncs(ids);
          let ok = 0;
          for (const o of outcomes) {
            masSyncSel.delete(o.id);
            if (o.ok) {
              masErrorById.delete(o.id);
              ok++;
            } else {
              masErrorById.set(o.id, o.error || "échec inconnu");
            }
          }
          const failed = outcomes.length - ok;
          toast(failed > 0 ? `${ok} synchro(s) appliquée(s), ${failed} échouée(s)` : `${ok} synchro(s) appliquée(s)`);
        } catch (e) {
          console.error("rekordbox_masterdb_apply_artwork_syncs failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/rekordbox-view.ts frontend/sift-live.ts
git commit -m "feat(m8): ecran synchro pochette Tier 3 sur la page Rekordbox"
```

---

### Task 11: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Confirm no concurrent `tauri dev`**

Before running any `cargo` command below, verify no other session has `npm run tauri dev` active on this repo (shared `target/` cache corruption risk — see project memory `avoid-concurrent-cargo-tauri-dev`). If one is running, ask the user before proceeding.

- [ ] **Step 2: Full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests PASS, no regression.

- [ ] **Step 3: Clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 4: Frontend type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verification note**

This plan cannot itself verify the UI in the real `tauri dev` window (code gated `inTauri`, per project convention). After all tasks land, ask the user to open `tauri dev`, link a test Rekordbox XML, give a linked track a new cover (via Discogs identification, "Appliquer les tags", or a Bibliothèque edit), and confirm the new "Synchros pochette master.db en attente" section appears on the Rekordbox page, and that applying it (with Rekordbox closed) succeeds and the new artwork shows up in Rekordbox after reimport.

- [ ] **Step 6: Update `docs/plan-implementation.md`'s M8 section**

Append a paragraph to the M8 section recording that the artwork sync IPC/hook/UI wiring is now shipped — mirror the phrasing style of the Tier 3 metadata "livré" paragraph already there.

- [ ] **Step 7: Update `docs/INDEX.json`**

Add an entry to the `"specs"` array for `docs/superpowers/changes/2026-07-09-m8-tier3-artwork-sync-ipc-ui/design.md` and to `"plans"` for `.../plan.md`, same format as the neighboring M8 Tier 3 metadata entries (which point at flat `specs/`/`plans/` paths — this chantier uses the `changes/<slug>/` convention instead, per `~/.claude/agent-operating-model.md`; note this explicitly in each entry's `summary` so a reader isn't confused by the path shape difference).

- [ ] **Step 8: Commit**

```bash
git add docs/plan-implementation.md docs/INDEX.json
git commit -m "docs(m8): Tier 3 pochette IPC+UI livre, met a jour statut + index"
```
