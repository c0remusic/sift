# M8 Tier 1 UI Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Rekordbox-page UI section that lists `master.db` path-repair
candidates (detected passively at filing time) and lets the user resolve
ambiguous cases, apply, or dismiss them — the last missing piece before Tier 1
can be used for real (see `docs/plan-implementation.md:236-255`).

**Architecture:** Additive only. The 3 existing IPC commands
(`rekordbox_masterdb_pending_repairs`/`apply_repairs`/`dismiss_repair`,
`src-tauri/src/ipc_library.rs`) already work and are already mirrored in
TypeScript. This plan (1) enriches `pending_repairs`' ambiguous rows with each
candidate's current `master.db` path, (2) adds one new command
(`resolve_ambiguous`) so the user can manually pick the right candidate, and
(3) builds the section in `renderRekordboxLive()` (`frontend/sift-live.ts`)
that consumes all four commands.

**Tech Stack:** Rust (rusqlite, existing `rekordbox_masterdb` module),
TypeScript (vanilla, no framework), Tauri IPC.

## Global Constraints

- No schema migration — `rekordbox_masterdb_repairs` already has every column
  this plan needs.
- Never `window.confirm()`/`alert()`/`prompt()` — use `confirmAction()`
  (`frontend/confirm-modal.ts`) before any `apply_repairs` call.
- `drift_detected` banner (`sift-live.ts:1550-1560`) stays untouched — the new
  section is a separate block below it, never merged into one message.
- French UI copy, same tone as the rest of `renderRekordboxLive` (e.g.
  `"aucun XML Rekordbox lié — relie un fichier avant d'exporter"`).
- `cargo test --manifest-path src-tauri/Cargo.toml` and
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  must stay clean after every Rust task. `npx tsc --noEmit` clean after every
  TS task. Never run `cargo test`/`clippy` while `tauri dev` is active
  (corrupts the incremental cache).

---

## File Structure

- Modify `src-tauri/src/ipc_library.rs`: add `CandidateTrack` struct, enrich
  `PendingMasterdbRepair`/`rekordbox_masterdb_pending_repairs_inner`, add
  `rekordbox_masterdb_resolve_ambiguous`(`_inner`) + command, tests.
- Modify `src-tauri/src/lib.rs`: register the new command.
- Modify `shared/contracts.ts`: add `CandidateTrack`, extend
  `PendingMasterdbRepair`.
- Modify `frontend/ipc.ts`: add `rekordboxMasterdbResolveAmbiguous` wrapper.
- Modify `frontend/sift-live.ts`: new `masterdbRepairsSectionHtml()`,
  module-level `mdbRepairSel`/`mdbErrorById` state, wiring in
  `renderRekordboxLive()` and the `#pa` delegated click handler.

---

### Task 1: Enrich `pending_repairs` with candidate paths

**Files:**
- Modify: `src-tauri/src/ipc_library.rs`

**Interfaces:**
- Produces: `pub struct CandidateTrack { pub track_id: String, pub folder_path: Option<String> }`
  (Serialize); `PendingMasterdbRepair.candidate_tracks: Option<Vec<CandidateTrack>>`
  (new field, `None` unless `status == "ambiguous"` and `master.db` was
  readable at query time).
- Consumes: `crate::settings::get`/`REKORDBOX_XML_PATH`,
  `crate::rekordbox_masterdb::read_rekordbox_masterdb(path: &Path) -> Result<RekordboxIndex, MasterDbError>`,
  `RekordboxIndex.tracks: Vec<RekordboxTrack>` (`RekordboxTrack { track_id: String, folder_path: String }`)
  — all already defined in `src-tauri/src/rekordbox_masterdb.rs`.

- [ ] **Step 1: Write the failing tests**

Add to the `rekordbox_tests` module in `src-tauri/src/ipc_library.rs` (after
`apply_repairs_fails_all_when_no_xml_linked`, before the closing `}` of the
module):

```rust
    #[test]
    fn pending_repairs_enriches_ambiguous_candidates_with_paths() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let index = crate::rekordbox_masterdb::read_rekordbox_masterdb(&pioneer_dir.join("master.db")).unwrap();
        let expected: std::collections::HashMap<String, String> =
            index.tracks.into_iter().map(|t| (t.track_id, t.folder_path)).collect();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        let row = rows.iter().find(|r| r.id == id).unwrap();
        let candidates = row.candidate_tracks.as_ref().expect("candidate_tracks populated");
        assert_eq!(candidates.len(), 2);
        for c in candidates {
            assert_eq!(
                c.folder_path.as_deref(),
                expected.get(&c.track_id).map(|s| s.as_str()),
                "candidate {} path mismatch",
                c.track_id
            );
        }
    }

    #[test]
    fn pending_repairs_candidate_with_unknown_id_has_no_path() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();
        let pioneer_dir = tmp.path().join("pioneer");
        let xml_path = seed_pioneer_dir(&pioneer_dir);
        crate::settings::set(&conn, crate::settings::REKORDBOX_XML_PATH, xml_path.to_str().unwrap()).unwrap();

        let id = seed_repair_row(&conn, "D:/FIXTURE/track1.mp3", "D:/FIXTURE/renamed/track1.flac", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,99999999' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        let row = rows.iter().find(|r| r.id == id).unwrap();
        let candidates = row.candidate_tracks.as_ref().expect("candidate_tracks populated");
        let unknown = candidates.iter().find(|c| c.track_id == "99999999").unwrap();
        assert!(unknown.folder_path.is_none());
        let known = candidates.iter().find(|c| c.track_id == "40000001").unwrap();
        assert!(known.folder_path.is_some());
    }

    #[test]
    fn pending_repairs_degrades_gracefully_when_masterdb_unreadable() {
        // No XML linked at all — pioneer_dir can't be resolved.
        let conn = db();
        let id_pending = seed_repair_row(&conn, "a", "a2", Some("1"), "pending");
        let id_ambig = seed_repair_row(&conn, "b", "b2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='1,2' WHERE id=?1",
            rusqlite::params![id_ambig],
        )
        .unwrap();

        let rows = rekordbox_masterdb_pending_repairs_inner(&conn).unwrap();
        assert_eq!(rows.len(), 2, "both rows still listed despite unresolved pioneer_dir");
        let pending = rows.iter().find(|r| r.id == id_pending).unwrap();
        assert!(pending.candidate_tracks.is_none());
        let ambig = rows.iter().find(|r| r.id == id_ambig).unwrap();
        assert!(ambig.candidate_tracks.is_none(), "no XML linked -> None, not an error");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pending_repairs_enriches -- --nocapture`
Expected: FAIL — `candidate_tracks` field does not exist on `PendingMasterdbRepair` (compile error).

- [ ] **Step 3: Add `CandidateTrack`, extend `PendingMasterdbRepair`, implement enrichment**

In `src-tauri/src/ipc_library.rs`, replace the `PendingMasterdbRepair` struct
(lines 232-244) with:

```rust
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
    /// Each candidate's current `master.db` path, resolved fresh at query time so the user can
    /// tell them apart. `None` when `status != "ambiguous"`, or when `master.db`/the linked XML
    /// couldn't be read at all (degrades gracefully — the row itself still lists, just without
    /// enrichment; never fails the whole `pending_repairs` call for this reason alone).
    pub candidate_tracks: Option<Vec<CandidateTrack>>,
    pub from_path: String,
    pub to_path: String,
    /// "pending" | "ambiguous".
    pub status: String,
    pub detected_at: String,
}

/// One ambiguous-repair candidate, enriched with its current `master.db` path for display.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CandidateTrack {
    pub track_id: String,
    /// `None` if this `track_id` no longer exists in `master.db` (library changed since detection).
    pub folder_path: Option<String>,
}
```

Replace `rekordbox_masterdb_pending_repairs_inner` (lines 282-305) with:

```rust
/// Resolves `pioneer_dir` from the linked XML and reads `master.db` once, returning a
/// `track_id -> folder_path` map. `None` if no XML is linked or `master.db` can't be read —
/// callers must degrade gracefully, never treat this as a hard error.
fn read_masterdb_path_map(conn: &Connection) -> Option<std::collections::HashMap<String, String>> {
    let xml_path = crate::settings::get(conn, crate::settings::REKORDBOX_XML_PATH).ok().flatten()?;
    let pioneer_dir = std::path::Path::new(&xml_path).parent()?;
    let index = crate::rekordbox_masterdb::read_rekordbox_masterdb(&pioneer_dir.join("master.db")).ok()?;
    Some(index.tracks.into_iter().map(|t| (t.track_id, t.folder_path)).collect())
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
    let mut rows: Vec<PendingMasterdbRepair> = stmt
        .query_map([], |r| {
            Ok(PendingMasterdbRepair {
                id: r.get(0)?,
                track_id: r.get(1)?,
                candidate_track_ids: r.get(2)?,
                candidate_tracks: None,
                from_path: r.get(3)?,
                to_path: r.get(4)?,
                status: r.get(5)?,
                detected_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Resolve master.db exactly once for the whole batch, not once per ambiguous row.
    if rows.iter().any(|r| r.status == "ambiguous") {
        if let Some(path_map) = read_masterdb_path_map(conn) {
            for row in rows.iter_mut().filter(|r| r.status == "ambiguous") {
                if let Some(ids) = &row.candidate_track_ids {
                    row.candidate_tracks = Some(
                        ids.split(',')
                            .map(|id| CandidateTrack {
                                track_id: id.to_string(),
                                folder_path: path_map.get(id).cloned(),
                            })
                            .collect(),
                    );
                }
            }
        }
    }
    Ok(rows)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all `rekordbox_tests` tests (existing + 3 new ones) green.

- [ ] **Step 5: Clippy check**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean, no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc_library.rs
git commit -m "feat(rekordbox): enrich master.db ambiguous repairs with candidate paths"
```

---

### Task 2: `rekordbox_masterdb_resolve_ambiguous` command

**Files:**
- Modify: `src-tauri/src/ipc_library.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `CandidateTrack`, `PendingMasterdbRepair` (Task 1).
- Produces: `#[tauri::command] pub fn rekordbox_masterdb_resolve_ambiguous(conn: State<'_, Mutex<Connection>>, id: i64, chosen_track_id: String) -> Result<(), String>`
  and its testable `rekordbox_masterdb_resolve_ambiguous_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String>`.

- [ ] **Step 1: Write the failing tests**

Add to the `rekordbox_tests` module (after Task 1's new tests):

```rust
    #[test]
    fn resolve_ambiguous_moves_row_to_pending_with_chosen_track() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "40000002").unwrap();

        let (track_id, candidates, status): (Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT track_id, candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE id=?1",
                rusqlite::params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(track_id.as_deref(), Some("40000002"));
        assert_eq!(candidates, None);
        assert_eq!(status, "pending");
    }

    #[test]
    fn resolve_ambiguous_rejects_track_id_outside_candidate_list() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", None, "ambiguous");
        conn.execute(
            "UPDATE rekordbox_masterdb_repairs SET candidate_track_ids='40000001,40000002' WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();

        let err = rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "99999999").unwrap_err();
        assert_eq!(err, "piste choisie invalide pour cette ambiguïté");

        let status: String = conn
            .query_row("SELECT status FROM rekordbox_masterdb_repairs WHERE id=?1", rusqlite::params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "ambiguous", "unchanged on rejection");
    }

    #[test]
    fn resolve_ambiguous_rejects_row_that_is_not_ambiguous() {
        let conn = db();
        let id = seed_repair_row(&conn, "a", "a2", Some("40000001"), "pending");

        let err = rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, "40000001").unwrap_err();
        assert_eq!(err, "cette ligne n'est plus ambiguë — rechargement nécessaire");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml resolve_ambiguous -- --nocapture`
Expected: FAIL — `rekordbox_masterdb_resolve_ambiguous_inner` not defined (compile error).

- [ ] **Step 3: Implement the command**

In `src-tauri/src/ipc_library.rs`, add after `rekordbox_masterdb_dismiss_repair`
(after line 333, before the `apply_one_repair` doc comment):

```rust
/// Plain (testable) implementation of `rekordbox_masterdb_resolve_ambiguous`.
fn rekordbox_masterdb_resolve_ambiguous_inner(conn: &Connection, id: i64, chosen_track_id: &str) -> Result<(), String> {
    let (candidate_track_ids, status): (Option<String>, String) = conn
        .query_row(
            "SELECT candidate_track_ids, status FROM rekordbox_masterdb_repairs WHERE id=?1",
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
        "UPDATE rekordbox_masterdb_repairs SET track_id=?1, candidate_track_ids=NULL, status='pending' WHERE id=?2",
        rusqlite::params![chosen_track_id, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Resolves an ambiguous repair by manually picking the correct `master.db` candidate. The row
/// becomes an ordinary `pending` row afterwards — no other change to the `apply_repairs` flow.
#[tauri::command]
pub fn rekordbox_masterdb_resolve_ambiguous(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    chosen_track_id: String,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    rekordbox_masterdb_resolve_ambiguous_inner(&conn, id, &chosen_track_id)
}
```

- [ ] **Step 4: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![` list, add a line
right after `ipc_library::rekordbox_masterdb_dismiss_repair,` (currently line
132):

```rust
            ipc_library::rekordbox_masterdb_resolve_ambiguous,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml rekordbox_tests -- --nocapture`
Expected: PASS — all `rekordbox_tests` tests green (Task 1's + Task 2's).

- [ ] **Step 6: Full build + clippy**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (confirms the new command compiles into the Tauri handler list).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(rekordbox): add resolve_ambiguous command for master.db repairs"
```

---

### Task 3: TypeScript mirror

**Files:**
- Modify: `shared/contracts.ts`
- Modify: `frontend/ipc.ts`

**Interfaces:**
- Consumes: `CandidateTrack`, `PendingMasterdbRepair` (Task 1),
  `rekordbox_masterdb_resolve_ambiguous` command (Task 2).
- Produces: `CandidateTrack` TS interface; `PendingMasterdbRepair.candidate_tracks: CandidateTrack[] | null`;
  `rekordboxMasterdbResolveAmbiguous(id: number, chosenTrackId: string): Promise<void>`.

- [ ] **Step 1: Update `shared/contracts.ts`**

Replace the `PendingMasterdbRepair` interface (`shared/contracts.ts:306-314`) with:

```typescript
export interface CandidateTrack {
  track_id: string;
  folder_path: string | null;
}

export interface PendingMasterdbRepair {
  id: number;
  track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  from_path: string;
  to_path: string;
  status: "pending" | "ambiguous";
  detected_at: string;
}
```

- [ ] **Step 2: Add the IPC wrapper in `frontend/ipc.ts`**

Add, right after the existing `rekordboxMasterdbDismissRepair` export
(`frontend/ipc.ts:290-291`):

```typescript
export const rekordboxMasterdbResolveAmbiguous = (id: number, chosenTrackId: string): Promise<void> =>
  invoke("rekordbox_masterdb_resolve_ambiguous", { id, chosenTrackId });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add shared/contracts.ts frontend/ipc.ts
git commit -m "feat(ipc): mirror master.db candidate enrichment + resolve_ambiguous"
```

---

### Task 4: Rekordbox page UI section

**Files:**
- Modify: `frontend/sift-live.ts`

**Interfaces:**
- Consumes: `PendingMasterdbRepair`, `CandidateTrack` (Task 1/3),
  `rekordboxMasterdbPendingRepairs()`, `rekordboxMasterdbApplyRepairs(ids: number[])`,
  `rekordboxMasterdbDismissRepair(id: number)`,
  `rekordboxMasterdbResolveAmbiguous(id: number, chosenTrackId: string)` (all
  from `./ipc`), `confirmAction(message: string, confirmLabel?: string): Promise<boolean>`
  (from `./confirm-modal`), `esc` (module-level, `sift-live.ts:451`), `toast`
  (module-level, `sift-live.ts:585`).
- Produces: `masterdbRepairsSectionHtml(rows: PendingMasterdbRepair[]): string`,
  wired into `renderRekordboxLive()`; new `data-sift` actions `mdbpick`,
  `mdbapply`, `mdbdismiss`, `mdbresolve` on the existing delegated `#pa` click
  handler.

- [ ] **Step 1: Add imports**

In `frontend/sift-live.ts`, add to the `./ipc` import list (line 3-30):

```typescript
  rekordboxMasterdbPendingRepairs,
  rekordboxMasterdbApplyRepairs,
  rekordboxMasterdbDismissRepair,
  rekordboxMasterdbResolveAmbiguous,
```

Add to the `../shared/contracts` type import list (line 31-38):

```typescript
  PendingMasterdbRepair,
  CandidateTrack,
```

Add a new import line after the `./filing` import block (around line 58):

```typescript
import { confirmAction } from "./confirm-modal";
```

- [ ] **Step 2: Add module-level state**

Add near the other module-level `Set`s (after `const QUEUE_ROW_BUFFER` block,
around line 99 — any top-level location before `renderRekordboxLive` works,
place it right before that function):

```typescript
// M8 Tier 1 repairs section state — module-level like batchSel (sift-live.ts:271), NOT reset on
// every render. Filtered against the live pending/ambiguous rows each render so a stale id (one
// that got applied/dismissed elsewhere) drops out without touching the rest of the selection.
const mdbRepairSel = new Set<number>();
// Per-row apply failure message, transient (never persisted) — cleared when the row is
// reselected or the next apply_repairs batch touches it again.
const mdbErrorById = new Map<number, string>();
```

- [ ] **Step 3: Write `masterdbRepairsSectionHtml`**

Add this function right before `renderRekordboxLive` (before line 1519):

```typescript
/** M8 Tier 1 section: lists master.db path-repair candidates detected passively at filing time
 * (`rekordbox_masterdb_repairs`, actions.rs::detect_masterdb_repair_if_linked) and lets the user
 * resolve/apply/dismiss them. Independent of `driftBanner` above (XML repair signal, unrelated
 * mechanism) — see docs/superpowers/specs/2026-07-06-m8-tier1-ui-screen-design.md. Renders "" when
 * there is nothing pending/ambiguous, same show-nothing-when-empty rule as driftBanner. */
function masterdbRepairsSectionHtml(rows: PendingMasterdbRepair[]): string {
  if (rows.length === 0) return "";
  // Drop stale selection ids without touching the rest — same discipline as batchSel's own
  // re-filter (sift-live.ts:679).
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdbRepairSel]) if (!liveIds.has(id)) mdbRepairSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");

  const pathBlock = (r: PendingMasterdbRepair) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.to_path)}</div>` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="opacity:.55">was</span> ${esc(r.from_path)}</div>` +
    (mdbErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdbErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingMasterdbRepair): CandidateTrack[] =>
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
            `<button class="lk" data-sift="mdbresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${pathBlock(r)}` +
        `<button class="lk" data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRows = pending
    .map((r) => {
      const checked = mdbRepairSel.has(r.id);
      return (
        `<div class="bx-row" data-sift="mdbpick" data-id="${r.id}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
          checked ? "background:var(--overlay-hover)" : ""
        }">` +
        `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
        pathBlock(r) +
        `<button class="lk" data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
        `</div>`
      );
    })
    .join("");

  const applyBar =
    mdbRepairSel.size > 0
      ? `<div style="margin-top:8px"><button class="lk" data-sift="mdbapply" style="font-weight:500">Appliquer la sélection (${mdbRepairSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Réparations master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}
```

- [ ] **Step 4: Wire the section into `renderRekordboxLive`**

Replace the final line of `renderRekordboxLive` (`sift-live.ts:1562`,
`content.innerHTML = intro + driftBanner + rekordboxCardHtml(status);`) with:

```typescript
  let masterdbSection = "";
  try {
    const repairs = await rekordboxMasterdbPendingRepairs();
    masterdbSection = masterdbRepairsSectionHtml(repairs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection;
```

- [ ] **Step 5: Wire the 4 new actions in the delegated click handler**

In the `#pa` click handler (`sift-live.ts`, the `else if` chain that includes
`act === "rkbreexport"`, around line 2049-2052), replace:

```typescript
    } else if (act === "rkbreexport") {
      e.stopPropagation();
      void runNavExport("rekordbox");
    }
  });
```

with:

```typescript
    } else if (act === "rkbreexport") {
      e.stopPropagation();
      void runNavExport("rekordbox");
    } else if (act === "mdbpick") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      if (mdbRepairSel.has(id)) {
        mdbRepairSel.delete(id);
      } else {
        mdbRepairSel.add(id);
        mdbErrorById.delete(id);
      }
      void renderRekordboxLive();
    } else if (act === "mdbdismiss") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      void (async () => {
        try {
          await rekordboxMasterdbDismissRepair(id);
        } catch (e) {
          console.error("rekordbox_masterdb_dismiss_repair failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "mdbresolve") {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      const trackId = el.dataset.track || "";
      void (async () => {
        try {
          await rekordboxMasterdbResolveAmbiguous(id, trackId);
        } catch (e) {
          console.error("rekordbox_masterdb_resolve_ambiguous failed", e);
          toast("Choix impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    } else if (act === "mdbapply") {
      e.stopPropagation();
      const ids = [...mdbRepairSel];
      if (!ids.length) return;
      void (async () => {
        const proceed = await confirmAction(
          `Appliquer ${ids.length} réparation${ids.length > 1 ? "s" : ""} de chemin dans master.db ? Ferme Rekordbox avant de continuer.`,
          "Appliquer",
        );
        if (!proceed) return;
        try {
          const outcomes = await rekordboxMasterdbApplyRepairs(ids);
          let ok = 0;
          for (const o of outcomes) {
            mdbRepairSel.delete(o.id);
            if (o.ok) {
              mdbErrorById.delete(o.id);
              ok++;
            } else {
              mdbErrorById.set(o.id, o.error || "échec inconnu");
            }
          }
          const failed = outcomes.length - ok;
          toast(
            failed > 0
              ? `${ok} réparation(s) appliquée(s), ${failed} échouée(s)`
              : `${ok} réparation(s) appliquée(s)`,
          );
        } catch (e) {
          console.error("rekordbox_masterdb_apply_repairs failed", e);
          toast("Action impossible — réessaie");
        }
        void renderRekordboxLive();
      })();
    }
  });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "feat(rekordbox): add master.db repairs section (list/apply/dismiss/resolve)"
```

---

## Self-Review

- **Spec coverage**: signal separation (drift banner untouched, new section
  below — Task 4 Step 4); candidate enrichment with graceful degradation
  (Task 1); `resolve_ambiguous` additive command, no schema migration (Task
  2); TS mirror (Task 3); ambiguous-first ordering, `mdbpick`/`mdbapply`/
  `mdbdismiss`/`mdbresolve` actions, `confirmAction()` before apply,
  per-outcome toast + `mdbErrorById` inline error display, module-level
  `mdbRepairSel` filtered (not reset) each render (Task 4). Manual
  verification against a real `master.db` copy and Antoine's own `tauri dev`
  check are explicitly out of scope per the spec's "Hors scope" section —
  not re-added here.
- **Placeholder scan**: no TBD/TODO; every step has real code, exact file
  locations, and runnable commands with expected output.
- **Type consistency**: `CandidateTrack`/`PendingMasterdbRepair.candidate_tracks`
  match across the Rust struct (Task 1), the TS interface (Task 3), and their
  consumption in `masterdbRepairsSectionHtml`/`candidateList` (Task 4).
  `rekordbox_masterdb_resolve_ambiguous(id: i64, chosen_track_id: String)`
  (Task 2) matches `rekordboxMasterdbResolveAmbiguous(id: number, chosenTrackId: string)`
  (Task 3) and its call site in Task 4 Step 5. `ApplyRepairOutcome.error` is
  `string | null` (existing contract) — Task 4's `o.error || "échec inconnu"`
  handles the `null` case without a type error.

## After this plan

Not covered here (explicitly out of scope per the design spec): verification
against a real copy of `master.db` + Antoine's manual validation inside the
actual Rekordbox app; Tier 2 (playlist dedup, not started); Tier 3
(`TrackInfoUpdated` flag, blocked on a never-completed spike retest); revert
tracking for master.db repairs (accepted limitation, same as the existing XML
repair).
