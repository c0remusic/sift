# M8 Tier 2 IPC Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-proven `detect_playlist_duplicates`/`dedup_playlist_group`
write engine (`src-tauri/src/rekordbox_masterdb.rs`) to the rest of Sift via
2 new IPC commands: an on-demand scan and an explicit, per-group dedup.

**Architecture:** Unlike Tier 1 (which persists candidate repairs in a
Sift-owned table because detection happens at filing time and must survive
until the user reviews it later), Tier 2 duplicates are a pre-existing
condition of the Rekordbox library itself, unrelated to anything Sift does —
so there is nothing to persist. `rekordbox_masterdb_scan_playlist_duplicates`
reads `master.db` fresh on every call (same "resolve pioneer_dir from the
linked XML" pattern Tier 1's `read_masterdb_path_map` already uses) and
returns the live result. `rekordbox_masterdb_dedup_playlist_group` takes back
exactly the group the frontend got from a scan (no server-side id/cache
needed) and applies it. No DB migration, no `actions.rs`/`filing.rs` changes
— this plan touches only `ipc_library.rs`, `lib.rs`, and the TS mirror.

**Tech Stack:** Rust (`rusqlite`, the existing `rekordbox_masterdb` Tier 2
engine, `chrono` already a dependency), TypeScript mirror in
`shared/contracts.ts` + `frontend/ipc.ts` (no UI screen — a later, separate
plan, matching Tier 1's own IPC → UI split).

## Global Constraints

- `detect_playlist_duplicates`/`dedup_playlist_group` are defined in
  `src-tauri/src/rekordbox_masterdb.rs` (Tier 2 engine plan,
  `docs/superpowers/plans/2026-07-08-m8-tier2-playlist-dedup-rust.md`,
  already merged) — this plan only wires them, it does not modify their
  logic.
- `rekordbox_masterdb.rs`'s internal types (`PlaylistDuplicateGroup`,
  `PlaylistDuplicateEntry`, `MasterDbError`) are deliberately **not**
  `Serialize` (see that module's own doc comment on `MasterDbError`: "converted
  to `String`/a local IPC-side type at any future IPC boundary rather than
  derived `Serialize` directly") — this plan follows the same convention Tier
  1 already established (`PendingMasterdbRepair`/`CandidateTrack`/
  `ApplyRepairOutcome` are all `ipc_library.rs`-local types, not the
  engine's own types with `Serialize` bolted on). Define local DTOs here,
  do not add `#[derive(Serialize)]` to the engine module's types.
- **Dedup is never automatic** — only the new
  `rekordbox_masterdb_dedup_playlist_group` command touches `master.db`, and
  only for the exact group the caller passes in.
- Reuse the existing `app_data_dir()/rekordbox-backups/` backup root
  convention (same as Tier 1's `rekordbox_masterdb_apply_repairs`) — do not
  invent a new backup location.
- `cargo test`/`cargo clippy` must never run concurrently with an active
  `tauri dev` process in this repo.
- Every new `#[tauri::command]` needs a plain `_inner` function (testable
  without a Tauri `State`/`AppHandle`), matching the existing
  `rekordbox_masterdb_apply_repairs_inner` convention in `ipc_library.rs`.
- No new dependencies.

---

## File Structure

- **Modify `src-tauri/src/ipc_library.rs`** — new section after the existing
  M8 Tier 1 section (after `rekordbox_masterdb_apply_repairs`, before
  `#[cfg(test)] mod rekordbox_tests`): 2 DTOs, 2 commands + their `_inner`
  functions, 2 new `humanize_masterdb_error` match arms.
- **Modify `src-tauri/src/lib.rs`** — register the 2 new commands.
- **Modify `shared/contracts.ts`** — mirror the 2 new DTOs.
- **Modify `frontend/ipc.ts`** — 2 new wrapper functions.

---

### Task 1: Scan command — `rekordbox_masterdb_scan_playlist_duplicates`

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (new section after
  `rekordbox_masterdb_apply_repairs`, before `#[cfg(test)]`)
- Test: `src-tauri/src/ipc_library.rs` (`mod rekordbox_tests`)

**Interfaces:**
- Consumes: `crate::rekordbox_masterdb::{detect_playlist_duplicates,
  PlaylistDuplicateGroup, PlaylistDuplicateEntry}` (existing, Tier 2 engine),
  `crate::settings::{get, REKORDBOX_XML_PATH}` (existing).
- Produces:
  ```rust
  pub struct PlaylistDuplicateEntryDto {
      pub song_playlist_id: String,
      pub track_no: i64,
  }
  pub struct PlaylistDuplicateGroupDto {
      pub playlist_id: String,
      pub content_id: String,
      pub keep: PlaylistDuplicateEntryDto,
      pub remove: Vec<PlaylistDuplicateEntryDto>,
  }
  pub fn rekordbox_masterdb_scan_playlist_duplicates(conn: State<'_, Mutex<Connection>>) -> Result<Vec<PlaylistDuplicateGroupDto>, String>
  ```
  Task 2 consumes `PlaylistDuplicateGroupDto` as the input to
  `rekordbox_masterdb_dedup_playlist_group` (the frontend passes back
  exactly the group it got from this scan).

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/ipc_library.rs`'s existing `mod rekordbox_tests` block
(after the existing tests, before its closing `}` at the end of the file —
this module already has a `seed_pioneer_dir(dir: &Path) -> PathBuf` helper
that copies `tests/fixtures/rekordbox_master.db`, which now contains the
Tier 2 fixture's duplicate playlist entry — reuse it as-is):

```rust
    #[test]
    fn scan_playlist_duplicates_finds_the_fixture_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].playlist_id, "50000001");
        assert_eq!(groups[0].content_id, "40000001");
        assert_eq!(groups[0].keep.song_playlist_id, "60000001");
        assert_eq!(groups[0].keep.track_no, 1);
        assert_eq!(groups[0].remove.len(), 1);
        assert_eq!(groups[0].remove[0].song_playlist_id, "60000003");
        assert_eq!(groups[0].remove[0].track_no, 3);
    }

    #[test]
    fn scan_playlist_duplicates_fails_fast_when_no_xml_linked() {
        let conn = db();
        let err = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap_err();
        assert_eq!(err, "aucun XML Rekordbox lié — relie un fichier avant de synchroniser");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scan_playlist_duplicates -- --nocapture`
Expected: FAIL with `cannot find function 'rekordbox_masterdb_scan_playlist_duplicates_inner' in this scope`.

- [ ] **Step 3: Implement the DTOs and the scan command**

Add to `src-tauri/src/ipc_library.rs`, right after `rekordbox_masterdb_apply_repairs`
(after its closing `}`, before `#[cfg(test)] mod rekordbox_tests`):

```rust
// ── M8 Tier 2: playlist duplicate-entry dedup ─────────────────────────────────

/// One `djmdSongPlaylist` row involved in a duplicate group — mirrors
/// `rekordbox_masterdb::PlaylistDuplicateEntry` field-for-field, kept as a
/// separate IPC-local type per this module's `Serialize`-boundary convention
/// (see `humanize_masterdb_error`'s doc comment for the same rationale
/// applied to `MasterDbError`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistDuplicateEntryDto {
    pub song_playlist_id: String,
    pub track_no: i64,
}

impl From<crate::rekordbox_masterdb::PlaylistDuplicateEntry> for PlaylistDuplicateEntryDto {
    fn from(e: crate::rekordbox_masterdb::PlaylistDuplicateEntry) -> Self {
        Self { song_playlist_id: e.song_playlist_id, track_no: e.track_no }
    }
}

impl From<PlaylistDuplicateEntryDto> for crate::rekordbox_masterdb::PlaylistDuplicateEntry {
    fn from(e: PlaylistDuplicateEntryDto) -> Self {
        Self { song_playlist_id: e.song_playlist_id, track_no: e.track_no }
    }
}

/// A set of `djmdSongPlaylist` rows in the same playlist that reference the
/// same track more than once — mirrors
/// `rekordbox_masterdb::PlaylistDuplicateGroup` field-for-field. Round-trips
/// through the frontend unmodified: a scan returns these, and the exact same
/// shape is passed back to `rekordbox_masterdb_dedup_playlist_group` — no
/// server-side id or cache needed, the group's own fields are the identity.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistDuplicateGroupDto {
    pub playlist_id: String,
    pub content_id: String,
    pub keep: PlaylistDuplicateEntryDto,
    pub remove: Vec<PlaylistDuplicateEntryDto>,
}

impl From<crate::rekordbox_masterdb::PlaylistDuplicateGroup> for PlaylistDuplicateGroupDto {
    fn from(g: crate::rekordbox_masterdb::PlaylistDuplicateGroup) -> Self {
        Self {
            playlist_id: g.playlist_id,
            content_id: g.content_id,
            keep: g.keep.into(),
            remove: g.remove.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<PlaylistDuplicateGroupDto> for crate::rekordbox_masterdb::PlaylistDuplicateGroup {
    fn from(g: PlaylistDuplicateGroupDto) -> Self {
        Self {
            playlist_id: g.playlist_id,
            content_id: g.content_id,
            keep: g.keep.into(),
            remove: g.remove.into_iter().map(Into::into).collect(),
        }
    }
}

/// Plain (testable) implementation of `rekordbox_masterdb_scan_playlist_duplicates`.
fn rekordbox_masterdb_scan_playlist_duplicates_inner(conn: &Connection) -> Result<Vec<PlaylistDuplicateGroupDto>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let groups = crate::rekordbox_masterdb::detect_playlist_duplicates(&pioneer_dir.join("master.db"))
        .map_err(|e| humanize_masterdb_error(&e))?;
    Ok(groups.into_iter().map(Into::into).collect())
}

/// Scans the linked Rekordbox's `master.db` for playlists containing the
/// same track more than once. Read-only — never touches `master.db`. Called
/// fresh on demand (no persistence): unlike Tier 1's candidate repairs,
/// duplicate playlist entries are a pre-existing library condition, not
/// something Sift's own actions cause, so there's nothing to detect
/// mid-filing or store until later review.
#[tauri::command]
pub fn rekordbox_masterdb_scan_playlist_duplicates(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<PlaylistDuplicateGroupDto>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_scan_playlist_duplicates_inner(&conn)
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, find the line
`ipc_library::rekordbox_masterdb_apply_repairs,` (added by the Tier 1 IPC
wiring plan) and add right after it:

```rust
            ipc_library::rekordbox_masterdb_scan_playlist_duplicates,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all tests in `ipc_library.rs`'s `rekordbox_tests` module,
including the 2 new ones.

- [ ] **Step 6: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): add rekordbox_masterdb_scan_playlist_duplicates command"
```

---

### Task 2: Dedup command + error humanization + TS mirror

**Files:**
- Modify: `src-tauri/src/ipc_library.rs` (2 new `humanize_masterdb_error`
  match arms, 1 new command + `_inner`)
- Modify: `src-tauri/src/lib.rs` (register 1 command)
- Modify: `shared/contracts.ts` (mirror the 2 DTOs from Task 1)
- Modify: `frontend/ipc.ts` (2 new wrapper functions)
- Test: `src-tauri/src/ipc_library.rs` (`mod rekordbox_tests`)

**Interfaces:**
- Consumes: `crate::rekordbox_masterdb::dedup_playlist_group` (existing,
  Tier 2 engine), `PlaylistDuplicateGroupDto` (Task 1).
- Produces:
  ```rust
  pub fn rekordbox_masterdb_dedup_playlist_group(app: AppHandle, conn: State<'_, Mutex<Connection>>, group: PlaylistDuplicateGroupDto) -> Result<(), String>
  ```

- [ ] **Step 1: Write the failing tests**

Add to `mod rekordbox_tests`, after Task 1's 2 new tests:

```rust
    #[test]
    fn dedup_playlist_group_command_removes_the_duplicate() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        let group = groups[0].clone();

        let backup_root = tmp.path().join("backups");
        rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group).unwrap();

        let after = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert!(after.is_empty(), "duplicate must be gone after dedup");
        assert!(
            backup_root.exists(),
            "a backup must have been created before the write"
        );
    }

    #[test]
    fn dedup_playlist_group_command_fails_fast_when_no_xml_linked() {
        let conn = db();
        let group = PlaylistDuplicateGroupDto {
            playlist_id: "50000001".to_string(),
            content_id: "40000001".to_string(),
            keep: PlaylistDuplicateEntryDto { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntryDto { song_playlist_id: "60000003".to_string(), track_no: 3 }],
        };
        let backup_root = tempfile::tempdir().unwrap().path().join("backups");
        let err = rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group).unwrap_err();
        assert_eq!(err, "aucun XML Rekordbox lié — relie un fichier avant de synchroniser");
    }

    #[test]
    fn dedup_playlist_group_command_humanizes_stale_group_error() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        // A group referencing a song_playlist_id that doesn't exist — simulates the
        // library having changed since the scan that produced this group.
        let stale_group = PlaylistDuplicateGroupDto {
            playlist_id: "50000001".to_string(),
            content_id: "40000001".to_string(),
            keep: PlaylistDuplicateEntryDto { song_playlist_id: "60000001".to_string(), track_no: 1 },
            remove: vec![PlaylistDuplicateEntryDto { song_playlist_id: "99999999".to_string(), track_no: 9 }],
        };
        let backup_root = tmp.path().join("backups");
        let err = rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, stale_group).unwrap_err();
        assert!(
            err.contains("99999999"),
            "error should name the missing row so the user understands what changed: {err}"
        );
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dedup_playlist_group_command -- --nocapture`
Expected: FAIL with `cannot find function 'rekordbox_masterdb_dedup_playlist_group_inner' in this scope`.

- [ ] **Step 3: Add error humanization for the 2 Tier 2 error variants**

In `src-tauri/src/ipc_library.rs`, in `humanize_masterdb_error`, replace:

```rust
        MasterDbError::WriteVerificationFailedRollbackFailed(m) => format!(
            "l'écriture ET la restauration de la sauvegarde ont échoué — intervention manuelle nécessaire : {m}"
        ),
        other => other.to_string(),
    }
}
```

with:

```rust
        MasterDbError::WriteVerificationFailedRollbackFailed(m) => format!(
            "l'écriture ET la restauration de la sauvegarde ont échoué — intervention manuelle nécessaire : {m}"
        ),
        MasterDbError::NoDuplicatesToRemove => {
            "aucun doublon à supprimer dans ce groupe — la bibliothèque a peut-être changé depuis le scan".to_string()
        }
        MasterDbError::SongPlaylistEntryNotFound { song_playlist_id } => format!(
            "entrée de playlist {song_playlist_id} introuvable — la bibliothèque Rekordbox a peut-être changé depuis le scan"
        ),
        other => other.to_string(),
    }
}
```

- [ ] **Step 4: Implement the dedup command**

Add to `src-tauri/src/ipc_library.rs`, right after
`rekordbox_masterdb_scan_playlist_duplicates` (Task 1's command):

```rust
/// Plain (testable) implementation of `rekordbox_masterdb_dedup_playlist_group`.
/// `backup_root` is the caller-resolved base directory for backups
/// (production: `app_data_dir()/rekordbox-backups`), same convention as
/// `rekordbox_masterdb_apply_repairs_inner`.
fn rekordbox_masterdb_dedup_playlist_group_inner(
    conn: &Connection,
    backup_root: &Path,
    group: PlaylistDuplicateGroupDto,
) -> Result<(), String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;

    let batch_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = backup_root.join(&batch_stamp).join(format!("{}-{}", group.playlist_id, group.content_id));

    crate::rekordbox_masterdb::dedup_playlist_group(pioneer_dir, &backup_dir, &group.into())
        .map_err(|e| humanize_masterdb_error(&e))
}

/// Removes every extra occurrence in `group.remove` from the linked
/// Rekordbox's `master.db`, keeping `group.keep` untouched — the explicit,
/// user-confirmed write step for one duplicate group returned by
/// `rekordbox_masterdb_scan_playlist_duplicates`. Never invoked
/// automatically. `group` should be exactly what the frontend received from
/// a scan; if the library changed since then (e.g. the row was already
/// removed), the write engine's own verification catches it and this
/// returns a humanized error rather than silently doing nothing or the
/// wrong thing.
#[tauri::command]
pub fn rekordbox_masterdb_dedup_playlist_group(
    app: AppHandle,
    conn: State<'_, Mutex<Connection>>,
    group: PlaylistDuplicateGroupDto,
) -> Result<(), String> {
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("rekordbox-backups");
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_dedup_playlist_group_inner(&conn, &backup_root, group)
}
```

- [ ] **Step 5: Register the command**

In `src-tauri/src/lib.rs`, right after the
`ipc_library::rekordbox_masterdb_scan_playlist_duplicates,` line added in
Task 1, add:

```rust
            ipc_library::rekordbox_masterdb_dedup_playlist_group,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all tests, including the 3 new ones from this task.

- [ ] **Step 7: Run the full backend suite and clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — no regressions anywhere (last backend task in this plan).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 8: Add the TypeScript mirror**

In `shared/contracts.ts`, find the end of the M8 Tier 1 section (the
`ApplyRepairOutcome` interface added by the Tier 1 IPC wiring plan) and add
right after it:

```typescript
// ---- M8 Tier 2 playlist duplicate-entry dedup (mirror of src-tauri/src/ipc_library.rs) ----

export interface PlaylistDuplicateEntryDto {
  song_playlist_id: string;
  track_no: number;
}

export interface PlaylistDuplicateGroupDto {
  playlist_id: string;
  content_id: string;
  keep: PlaylistDuplicateEntryDto;
  remove: PlaylistDuplicateEntryDto[];
}
```

In `frontend/ipc.ts`, find the existing import of `PendingMasterdbRepair`/
`ApplyRepairOutcome` near the top of the file and add
`PlaylistDuplicateEntryDto`, `PlaylistDuplicateGroupDto` to the same import
statement, then add after the true end of the M8 Tier 1 section — the
`rekordboxMasterdbResolveAmbiguous` wrapper (search for that exact name; it
comes after `rekordboxMasterdbDismissRepair`, right before the
`// ---- M7 USB format utility ----` comment):

```typescript
// ---- M8 Tier 2 playlist duplicate-entry dedup ----

/** Scans the linked Rekordbox's master.db for playlists with the same track
 * added more than once. Read-only, called fresh on demand — nothing persists
 * between calls, unlike Tier 1's candidate repairs. */
export const rekordboxMasterdbScanPlaylistDuplicates = (): Promise<PlaylistDuplicateGroupDto[]> =>
  invoke("rekordbox_masterdb_scan_playlist_duplicates");

/** Removes every extra occurrence in group.remove, keeping group.keep untouched.
 * Pass back exactly the group object received from rekordboxMasterdbScanPlaylistDuplicates —
 * there is no separate id to reference. Never automatic — only call after explicit
 * user confirmation. */
export const rekordboxMasterdbDedupPlaylistGroup = (group: PlaylistDuplicateGroupDto): Promise<void> =>
  invoke("rekordbox_masterdb_dedup_playlist_group", { group });
```

- [ ] **Step 9: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: clean (no type errors).

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs shared/contracts.ts frontend/ipc.ts
git commit -m "feat(ipc): add rekordbox_masterdb_dedup_playlist_group command + TS mirror"
```

---

## Self-Review

- **Spec coverage**: both Tier 2 engine functions (`detect_playlist_duplicates`,
  `dedup_playlist_group`) are wired to IPC (Tasks 1-2), with the same
  `_inner`-function testability convention, the same backup-root
  resolution, and the same humanized-error pattern Tier 1 established. No DB
  migration or filing-hook changes — deliberately, since Tier 2 duplicates
  don't originate from Sift's own actions (see Architecture). UI is
  explicitly out of scope, matching Tier 1's own IPC → UI split.
- **Placeholder scan**: no TBD/TODO; every step has real code, real
  commands, and stated expected output.
- **Type consistency**: `PlaylistDuplicateEntryDto`/`PlaylistDuplicateGroupDto`
  field names and types match across the Rust structs (Task 1), the `From`
  impls converting to/from the engine's own types, the `_inner` functions'
  usage (Task 1-2), and the TypeScript mirror (Task 2, Step 8).
  `rekordbox_masterdb_dedup_playlist_group_inner`'s signature matches
  between its definition (Task 2) and its test calls.

## After this plan

Not covered here: the Rekordbox page UI (lists scanned duplicate groups,
previews the diff, two-click confirmation, calls
`rekordboxMasterdbDedupPlaylistGroup`) — separate plan, per Tier 1's own
IPC → UI ordering. Playlist *membership sync* (beyond dedup — the design
doc's broader Tier 2 scope) and Tier 3 (metadata reload flag, still blocked
on the never-completed spike retest) remain untouched.
