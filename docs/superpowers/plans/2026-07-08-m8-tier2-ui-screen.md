# M8 Tier 2 UI Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-shipped Tier 2 dedup engine
(`rekordbox_masterdb_scan_playlist_duplicates`/`_dedup_playlist_group`) on
the Rekordbox page, mirroring Tier 1's UI screen exactly in structure and
interaction pattern (card list, two-click `confirmAction()` before any
write, re-render after mutation).

**Architecture:** The shipped `PlaylistDuplicateGroupDto` only carries
Rekordbox's opaque internal IDs (`playlist_id`/`content_id`) — not enough to
show a user anything actionable. Task 1 adds a small, display-only
enrichment step (same pattern Tier 1's own UI plan used for its
`candidate_tracks` field): a new engine read function
`read_playlist_names` (mirrors `read_rekordbox_masterdb`'s shape exactly),
plus reuse of the *already-existing* `read_masterdb_path_map` IPC helper for
track paths — no new track-reading capability needed there. Task 2 renders a
new section on the Rekordbox page, module-level array (not a `Set`/`Map`
keyed by server id — duplicate groups have no server-side id, matching how
the scan itself is stateless) holds the last scan's results, and one button
per group triggers `confirmAction()` → `rekordboxMasterdbDedupPlaylistGroup`
→ re-render.

**Tech Stack:** Rust (`rusqlite`, the existing `rekordbox_masterdb`
module), TypeScript (`frontend/sift-live.ts`, `confirm-modal.ts`'s
`confirmAction`, `toast`). No new dependencies, no new CSS files — reuses
existing tokens/classes (`col-h`, `--color-border-tertiary`,
`--border-radius-md`, `--font-mono`, `--text-*`) exactly as Tier 1's
`masterdbRepairsSectionHtml` already does.

## Global Constraints

- **Never `window.confirm()`/`alert()`** before a write — use `confirmAction()`
  from `frontend/confirm-modal.ts`, the in-app two-click pattern already used
  by Tier 1's `mdbapply` handler (project rule, real WebView2 incident —
  `CLAUDE.md`, "Méthode" section).
- **No side-stripe borders** (`border-left`/`border-right` as accent) —
  project-wide CSS ban. Use the same bordered-box grammar Tier 1's section
  already uses (`border:0.5px solid var(--color-border-tertiary)`).
- **Card grammar**: this is a "Grouped" element (border/tint, no shadow) per
  `docs/design-system-states.md`'s "Grammaire de carte" section — never add
  a `box-shadow` here.
- **Rail buttons stay text-only** — no decorative icon next to the
  "Dédupliquer" label (`CLAUDE.md`, "Front — CSS" section).
- Enrichment (`playlist_name`/`track_path`) is **display-only** — the
  reverse `From<PlaylistDuplicateGroupDto> for PlaylistDuplicateGroup`
  conversion (already shipped) must keep ignoring these fields; the write
  engine itself never needs them.
- `cargo test`/`cargo clippy` must never run concurrently with an active
  `tauri dev` process in this repo; `npx tsc --noEmit` for the frontend task.
- Frontend verification: this UI only renders inside the real Tauri shell
  (`renderRekordboxLive` is gated behind `if (inTauri)` wiring) — a browser
  preview of `app.js` will never exercise it. Per project convention, manual
  `tauri dev` verification is Antoine's own step; this plan's frontend task
  ends at `tsc --noEmit` clean, not a live-render screenshot.

---

## File Structure

- **Modify `src-tauri/src/rekordbox_masterdb.rs`** — new `read_playlist_names`
  read function, placed after `read_rekordbox_masterdb`.
- **Modify `src-tauri/src/ipc_library.rs`** — `PlaylistDuplicateGroupDto`
  gains 2 optional display fields; `rekordbox_masterdb_scan_playlist_duplicates_inner`
  enriches them once per scan (only when the result is non-empty, same
  "resolve once for the whole batch" discipline as Tier 1's
  `candidate_tracks` enrichment).
- **Modify `shared/contracts.ts`** — mirror the 2 new DTO fields.
- **Modify `frontend/sift-live.ts`** — new module-level state, new
  `playlistDuplicatesSectionHtml` render function, wired into
  `renderRekordboxLive`, new `mdbdedup` branch in the delegated `#pa` click
  handler.

---

### Task 1: Backend enrichment — playlist name + track path

**Files:**
- Modify: `src-tauri/src/rekordbox_masterdb.rs` (new function after
  `read_rekordbox_masterdb`, i.e. after its closing `}` at line 615)
- Modify: `src-tauri/src/ipc_library.rs` (extend `PlaylistDuplicateGroupDto`
  at lines 568-574, extend its `From<PlaylistDuplicateGroup>` impl at lines
  576-585, extend `rekordbox_masterdb_scan_playlist_duplicates_inner` at
  lines 599-609)
- Test: `src-tauri/src/rekordbox_masterdb.rs` (`mod tests`),
  `src-tauri/src/ipc_library.rs` (`mod rekordbox_tests`)

**Interfaces:**
- Consumes: `decrypt_masterdb`, `Connection` (existing, same file); the
  already-shipped `read_masterdb_path_map` IPC helper (`ipc_library.rs:303`,
  unchanged — reused as-is for track paths).
- Produces:
  ```rust
  pub fn read_playlist_names(path: &Path) -> Result<std::collections::HashMap<String, String>, MasterDbError>
  ```
  `PlaylistDuplicateGroupDto` gains `playlist_name: Option<String>` and
  `track_path: Option<String>`. Task 2 consumes both directly in the render
  function.

- [ ] **Step 1: Write the failing test for `read_playlist_names`**

Add to the `mod tests` block in `src-tauri/src/rekordbox_masterdb.rs` (after
the closing `}` of `detect_playlist_duplicates_ignores_non_duplicated_entries`):

```rust
    #[test]
    fn read_playlist_names_returns_the_fixture_playlist() {
        let names = read_playlist_names(Path::new(FIXTURE)).expect("read playlist names");
        assert_eq!(names.get("50000001"), Some(&"Fixture Playlist".to_string()));
        assert_eq!(names.len(), 1, "fixture has exactly one playlist");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml read_playlist_names_returns_the_fixture_playlist -- --nocapture`
Expected: FAIL with `cannot find function 'read_playlist_names' in this scope`.

- [ ] **Step 3: Implement `read_playlist_names`**

Add to `src-tauri/src/rekordbox_masterdb.rs`, right after
`read_rekordbox_masterdb`'s closing `}` (after line 615):

```rust
/// Reads `djmdPlaylist.Name` for every playlist in `master.db`, keyed by
/// `ID`. Display-only — never consumed by the detect/write engine itself,
/// which only ever needs playlist `ID`s. Added for the M8 Tier 2 UI screen
/// (`docs/superpowers/plans/2026-07-08-m8-tier2-ui-screen.md`): a duplicate
/// group's `playlist_id`/`content_id` alone aren't actionable information
/// for a user, so the UI needs the human-readable name alongside them.
pub fn read_playlist_names(path: &Path) -> Result<std::collections::HashMap<String, String>, MasterDbError> {
    let raw = std::fs::read(path).map_err(|e| MasterDbError::Io(e.to_string()))?;
    let plaintext = decrypt_masterdb(&raw)?;

    let mut conn = Connection::open_in_memory().map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let len = plaintext.len();
    conn.deserialize_read_exact(rusqlite::MAIN_DB, Cursor::new(plaintext), len, true)
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT ID, Name FROM djmdPlaylist")
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| MasterDbError::Sqlite(e.to_string()))?;

    let mut names = std::collections::HashMap::new();
    for row in rows {
        let (id, name) = row.map_err(|e| MasterDbError::Sqlite(e.to_string()))?;
        names.insert(id, name);
    }
    Ok(names)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml read_playlist_names_returns_the_fixture_playlist -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the enrichment**

Add to `src-tauri/src/ipc_library.rs`'s `mod rekordbox_tests` block, after
`scan_playlist_duplicates_fails_fast_when_no_xml_linked`:

```rust
    #[test]
    fn scan_playlist_duplicates_enriches_with_playlist_name_and_track_path() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let groups = rekordbox_masterdb_scan_playlist_duplicates_inner(&conn).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].playlist_name.as_deref(), Some("Fixture Playlist"));
        assert_eq!(groups[0].track_path.as_deref(), Some("D:/FIXTURE/track1.mp3"));
    }
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scan_playlist_duplicates_enriches -- --nocapture`
Expected: FAIL — `no field 'playlist_name' on type PlaylistDuplicateGroupDto`
(the field doesn't exist yet).

- [ ] **Step 7: Extend the DTO and its conversions**

In `src-tauri/src/ipc_library.rs`, replace lines 562-585 (from the doc
comment above `PlaylistDuplicateGroupDto` through the closing `}` of its
`From<PlaylistDuplicateGroup>` impl):

```rust
/// A set of `djmdSongPlaylist` rows in the same playlist that reference the
/// same track more than once — mirrors
/// `rekordbox_masterdb::PlaylistDuplicateGroup` field-for-field, plus 2
/// display-only fields (`playlist_name`, `track_path`) resolved by the scan
/// command for the UI's benefit. Round-trips through the frontend
/// unmodified: a scan returns these, and the exact same shape is passed
/// back to `rekordbox_masterdb_dedup_playlist_group` — no server-side id or
/// cache needed, the group's own fields are the identity. The write engine
/// only ever reads `playlist_id`/`content_id`/`keep`/`remove` (see the
/// reverse `From` impl below) — `playlist_name`/`track_path` are ignored on
/// that path, never required to be present or correct for a write to
/// succeed.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistDuplicateGroupDto {
    pub playlist_id: String,
    /// `djmdPlaylist.Name`, resolved fresh at scan time. `None` if the
    /// playlist couldn't be found when resolving names (library changed
    /// since detection) — the UI falls back to the raw id.
    pub playlist_name: Option<String>,
    pub content_id: String,
    /// The duplicated track's current `master.db` path, resolved fresh at
    /// scan time. `None` for the same reason as `playlist_name`.
    pub track_path: Option<String>,
    pub keep: PlaylistDuplicateEntryDto,
    pub remove: Vec<PlaylistDuplicateEntryDto>,
}

impl From<crate::rekordbox_masterdb::PlaylistDuplicateGroup> for PlaylistDuplicateGroupDto {
    fn from(g: crate::rekordbox_masterdb::PlaylistDuplicateGroup) -> Self {
        Self {
            playlist_id: g.playlist_id,
            playlist_name: None,
            content_id: g.content_id,
            track_path: None,
            keep: g.keep.into(),
            remove: g.remove.into_iter().map(Into::into).collect(),
        }
    }
}
```

Leave the reverse `impl From<PlaylistDuplicateGroupDto> for
crate::rekordbox_masterdb::PlaylistDuplicateGroup` (currently lines 587-596)
completely unchanged — it already only reads `playlist_id`/`content_id`/
`keep`/`remove`, ignoring any extra fields on the DTO struct automatically.

- [ ] **Step 8: Enrich in `scan_playlist_duplicates_inner`**

Replace lines 598-609 (from the doc comment above
`rekordbox_masterdb_scan_playlist_duplicates_inner` through its closing
`}`):

```rust
/// Plain (testable) implementation of `rekordbox_masterdb_scan_playlist_duplicates`.
/// Enriches with `playlist_name`/`track_path` in one extra pass, only when
/// the scan actually found something — same "resolve once for the whole
/// batch, only when needed" discipline as `rekordbox_masterdb_pending_repairs_inner`'s
/// `candidate_tracks` enrichment.
fn rekordbox_masterdb_scan_playlist_duplicates_inner(conn: &Connection) -> Result<Vec<PlaylistDuplicateGroupDto>, String> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH)
        .map_err(|e| e.to_string())?
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let pioneer_dir = std::path::Path::new(&xml_path)
        .parent()
        .ok_or("aucun XML Rekordbox lié — relie un fichier avant de synchroniser")?;
    let groups = crate::rekordbox_masterdb::detect_playlist_duplicates(&pioneer_dir.join("master.db"))
        .map_err(|e| humanize_masterdb_error(&e))?;
    let mut dtos: Vec<PlaylistDuplicateGroupDto> = groups.into_iter().map(Into::into).collect();

    if !dtos.is_empty() {
        let playlist_names = crate::rekordbox_masterdb::read_playlist_names(&pioneer_dir.join("master.db")).ok();
        let track_paths = read_masterdb_path_map(conn);
        for dto in &mut dtos {
            if let Some(names) = &playlist_names {
                dto.playlist_name = names.get(&dto.playlist_id).cloned();
            }
            if let Some(paths) = &track_paths {
                dto.track_path = paths.get(&dto.content_id).cloned();
            }
        }
    }
    Ok(dtos)
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_masterdb -- --nocapture`
and: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all tests including the 2 new ones. Also re-check
`dedup_playlist_group_command_removes_the_duplicate` and the other Task-2-of-IPC-plan
tests that construct a `PlaylistDuplicateGroupDto` literal by hand (e.g.
`dedup_playlist_group_command_fails_fast_when_no_xml_linked`,
`..._humanizes_stale_group_error`) — they now need
`playlist_name: None, track_path: None` added to their struct literals or
they will fail to compile (missing struct fields). Fix any such literal by
adding those two fields.

- [ ] **Step 10: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/rekordbox_masterdb.rs src-tauri/src/ipc_library.rs
git commit -m "feat(rekordbox): enrich playlist duplicate scan with name + track path"
```

---

### Task 2: UI section + wiring

**Files:**
- Modify: `shared/contracts.ts` (extend `PlaylistDuplicateGroupDto`, added
  by the IPC wiring plan — find it and add 2 fields)
- Modify: `frontend/sift-live.ts` (new module-level state after line 114,
  new render function after `masterdbRepairsSectionHtml`'s closing `}` at
  line 1736, wire into `renderRekordboxLive` at lines 1781-1789, new
  handler branch after the `mdbapply` branch closing `}` at line 2366)

**Interfaces:**
- Consumes: `rekordboxMasterdbScanPlaylistDuplicates`,
  `rekordboxMasterdbDedupPlaylistGroup` (already shipped, `frontend/ipc.ts`),
  `PlaylistDuplicateGroupDto` (extended by Task 1's TS mirror), `confirmAction`
  (already imported, `frontend/confirm-modal.ts`), `toast`, `esc` (already
  used throughout this file).
- Produces: no new exported interface — this is the final consumer.

- [ ] **Step 1: Extend the TypeScript DTO**

In `shared/contracts.ts`, find the `PlaylistDuplicateGroupDto` interface
(added by the IPC wiring plan, in the "M8 Tier 2 playlist duplicate-entry
dedup" section) and replace:

```typescript
export interface PlaylistDuplicateGroupDto {
  playlist_id: string;
  content_id: string;
  keep: PlaylistDuplicateEntryDto;
  remove: PlaylistDuplicateEntryDto[];
}
```

with:

```typescript
export interface PlaylistDuplicateGroupDto {
  playlist_id: string;
  playlist_name: string | null;
  content_id: string;
  track_path: string | null;
  keep: PlaylistDuplicateEntryDto;
  remove: PlaylistDuplicateEntryDto[];
}
```

- [ ] **Step 2: Add module-level state**

In `frontend/sift-live.ts`, right after line 114 (`const mdbErrorById = new
Map<number, string>();`), before `let queueRowHeightCache: number | null =
null;`, add:

```typescript
// M8 Tier 2 playlist-dedup section state — stateless on the backend (no server-side id,
// see the IPC wiring plan's Architecture note), so the frontend keeps the last scan result
// itself and references entries by array index from the DOM. Re-populated on every
// renderRekordboxLive() call, same lifecycle as masterdbSection's own data.
let lastScannedDuplicateGroups: PlaylistDuplicateGroupDto[] = [];
// Per-group dedup failure message, keyed by "playlistId::contentId" (no numeric id exists
// for a duplicate group) — same transient, never-persisted contract as mdbErrorById.
const mdbDedupErrorByKey = new Map<string, string>();
```

- [ ] **Step 3: Add the render function**

In `frontend/sift-live.ts`, right after `masterdbRepairsSectionHtml`'s
closing `}` (after line 1736), before `async function renderRekordboxLive()`,
add:

```typescript
function duplicateGroupKey(g: PlaylistDuplicateGroupDto): string {
  return `${g.playlist_id}::${g.content_id}`;
}

/** M8 Tier 2 section: lists playlists where the same track appears more than once
 * (rekordbox_masterdb_scan_playlist_duplicates, read-only, scanned fresh on every render — no
 * persistence, see docs/superpowers/plans/2026-07-08-m8-tier2-ipc-wiring.md). One button per
 * group, no multi-select (unlike Tier 1's masterdbRepairsSectionHtml): each dedup is a complete,
 * independent action, and there are typically 0-2 groups at a time. Renders "" when there is
 * nothing to dedup, same show-nothing-when-empty rule as masterdbRepairsSectionHtml. */
function playlistDuplicatesSectionHtml(groups: PlaylistDuplicateGroupDto[]): string {
  if (groups.length === 0) return "";
  const rows = groups
    .map((g, i) => {
      const key = duplicateGroupKey(g);
      const playlistLabel = g.playlist_name || `Playlist ${g.playlist_id}`;
      const trackLabel = g.track_path ? g.track_path.split(/[\\/]/).pop() || g.track_path : `Piste ${g.content_id}`;
      const count = g.remove.length;
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px;display:flex;gap:10px;align-items:center">` +
        `<div style="min-width:0;flex:1">` +
        `<div style="font-size:var(--text-sm)">${esc(playlistLabel)}</div>` +
        `<div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(trackLabel)} — ${count} doublon${count > 1 ? "s" : ""}</div>` +
        (mdbDedupErrorByKey.has(key)
          ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdbDedupErrorByKey.get(key)!)}</div>`
          : "") +
        `</div>` +
        `<button data-sift="mdbdedup" data-idx="${i}" style="flex:none">Dédupliquer</button>` +
        `</div>`
      );
    })
    .join("");
  return `<div style="margin-bottom:12px"><div class="col-h">Doublons dans les playlists</div>${rows}</div>`;
}
```

- [ ] **Step 4: Wire into `renderRekordboxLive`**

In `frontend/sift-live.ts`, replace lines 1781-1789:

```typescript
  let masterdbSection = "";
  try {
    const repairs = await rekordboxMasterdbPendingRepairs();
    masterdbSection = masterdbRepairsSectionHtml(repairs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection;
}
```

with:

```typescript
  let masterdbSection = "";
  try {
    const repairs = await rekordboxMasterdbPendingRepairs();
    masterdbSection = masterdbRepairsSectionHtml(repairs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
  }

  let dedupSection = "";
  try {
    lastScannedDuplicateGroups = await rekordboxMasterdbScanPlaylistDuplicates();
    dedupSection = playlistDuplicatesSectionHtml(lastScannedDuplicateGroups);
  } catch (e) {
    console.error("rekordbox_masterdb_scan_playlist_duplicates failed", e);
    lastScannedDuplicateGroups = [];
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection + dedupSection;
}
```

- [ ] **Step 5: Add the imports**

`frontend/sift-live.ts` has two separate top-of-file import blocks: an
`import { ... } from "./ipc"` block (lines 3-35, functions) and an `import
type { ... } from "../shared/contracts"` block (lines 36-45, types). Add to
each:

In the `./ipc` block, right after `rekordboxMasterdbResolveAmbiguous,`
(line 34):

```typescript
  rekordboxMasterdbScanPlaylistDuplicates,
  rekordboxMasterdbDedupPlaylistGroup,
```

In the `../shared/contracts` type block, right after `CandidateTrack,`
(line 44):

```typescript
  PlaylistDuplicateGroupDto,
```

- [ ] **Step 6: Add the event handler branch**

In `frontend/sift-live.ts`, the `mdbapply` branch currently ends like this
(lines 2360-2367):

```typescript
        } catch (e) {
          console.error("rekordbox_masterdb_apply_repairs failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    }
  });
```

That lone `    }` on line 2366 closes the `else if (act === "mdbapply")`
block and ends the `if/else if` chain. Replace just that line:

```typescript
    }
```

with a continuation of the chain instead of its end:

```typescript
    } else if (act === "mdbdedup") {
      e.stopPropagation();
      const idx = Number(el.dataset.idx);
      const group = lastScannedDuplicateGroups[idx];
      if (!group) return;
      void (async () => {
        const proceed = await confirmAction(
          `Supprimer ${group.remove.length} entrée${group.remove.length > 1 ? "s" : ""} en double de cette playlist ? Ferme Rekordbox avant de continuer.`,
          "Dédupliquer",
        );
        if (!proceed) return;
        const key = duplicateGroupKey(group);
        try {
          await rekordboxMasterdbDedupPlaylistGroup(group);
          mdbDedupErrorByKey.delete(key);
          toast("Doublon supprimé");
        } catch (e) {
          console.error("rekordbox_masterdb_dedup_playlist_group failed", e);
          mdbDedupErrorByKey.set(key, e instanceof Error ? e.message : "échec inconnu");
        }
        void renderRekordboxLive();
      })();
    }
```

The trailing `  });` that closes the whole delegated click listener (was line
2367) is untouched — it now closes this new branch instead of the old
`mdbapply` branch.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add shared/contracts.ts frontend/sift-live.ts
git commit -m "feat(rekordbox): add Tier 2 playlist-dedup section to the Rekordbox page"
```

---

## Self-Review

- **Spec coverage**: both engine functions
  (`rekordbox_masterdb_scan_playlist_duplicates`/`_dedup_playlist_group`,
  already shipped) are now surfaced in the UI (Task 2), with the display
  enrichment they need to be actionable (Task 1) — mirroring Tier 1's own
  "base IPC layer, then enrichment, then UI" sequencing. Card grammar,
  confirmAction() pattern, and text-only buttons all match this project's
  established conventions rather than inventing new ones.
- **Placeholder scan**: no TBD/TODO; every step has real code, real
  commands, and stated expected output.
- **Type consistency**: `PlaylistDuplicateGroupDto`'s 2 new fields
  (`playlist_name: Option<String>`/`string | null`,
  `track_path: Option<String>`/`string | null`) match across the Rust
  struct (Task 1), the enrichment code that fills them (Task 1), the TS
  mirror (Task 2, Step 1), and the render function that reads them (Task 2,
  Step 3). `duplicateGroupKey` is defined once (Task 2, Step 3) and reused
  identically in the render function and the event handler (Task 2, Step
  6) — never redefined.

## After this plan

Not covered here: playlist *membership sync* (beyond dedup — the design
doc's broader Tier 2 scope) and Tier 3 (`TrackInfoUpdated` flag) remain
untouched. Manual `tauri dev` verification (light + dark, 0/1/2+ duplicate
groups) is Antoine's own step, per this project's standing convention for
`inTauri`-gated UI.
