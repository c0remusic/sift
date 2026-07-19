# Split frontend/filing.ts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/filing.ts` (1660 lines / 39 top-level functions) into 6 focused files with zero behavior change, resolving `TECH_DEBT_AUDIT.md` F03.

**Architecture:** Extract in dependency order (leaves first, so each new file only ever imports from files already extracted, never creates an import cycle): `filing-state.ts` (shared mutable state) → `filing-toast.ts` (toast utility) → `filing-preview.ts` (name/preview rendering helpers used by both remaining groups) → `filing-identify.ts` (Discogs identification + metadata editor + apply-tags) → `filing-actions.ts` (Ranger/Revert/Secondary rail actions) → `filing.ts` keeps only the orchestrator (`openFilingInto`), `renderFoot`, `clearPane`, `dupBanner`, install-hooks, `syncDetail`.

**Tech Stack:** TypeScript (vanilla, no framework — see root `CLAUDE.md` "Vision de travail"), Vite. No frontend test runner — verification is `npx tsc --noEmit` + a manual behavior checklist against the real `tauri dev` window via `.claude/scripts/cdp.cjs` or Antoine's own eyes.

## Global Constraints

- **Refactor pur, zéro changement de comportement.** Every moved function/comment is relocated verbatim unless a step explicitly says otherwise (only 2 such steps: the `openState` object wrapper, and `toast`'s `clearPaneHook` indirection — both required to avoid ESM import cycles, both behavior-preserving).
- **No import cycles.** Each new file's task lists its exact allowed imports below — do not import anything not listed without stopping and asking (an unlisted need is a hidden coupling to escalate, same discipline as the `sift-live.ts` Phase 1 split which found 5 of these).
- **`npx tsc --noEmit` must be clean after every task**, run from repo root.
- **Never delete `filing.ts`'s existing external exports without a compensating re-export** — `frontend/batch-panel.ts:6` does `import { openFilingInto, TARGET_LABEL } from "./filing"`; both names must keep resolving from `"./filing"` after the split (verified via `grep -rn "from \"./filing\"" frontend/*.ts`, re-run that grep after Task 6 to confirm nothing else was missed).
- **Verbatim comments.** The source file's comments encode real incident history (bug fixes, annotations from Antoine) — copy them along with the code, do not summarize or drop them.

---

### Task 1: `frontend/filing-state.ts` — shared mutable state

**Files:**
- Create: `frontend/filing-state.ts`
- Modify: `frontend/filing.ts` (remove the interface/const/lets moved out, add an import)

**Interfaces:**
- Produces: `RevueState` (type), `state: RevueState`, `openState: { openSeq: number; acting: boolean }` — all consumed by every other task in this plan.

- [ ] **Step 1: Create `frontend/filing-state.ts`**

Cut lines 65-120 of `frontend/filing.ts` verbatim (the `RevueState` interface incl. all its field comments, and the `state` const literal) into the new file. Then replace the two now-orphaned mutable primitives (`let openSeq = 0;` at `filing.ts:1399` and `let acting = false;` at `filing.ts:1164`) with a single exported object — grouping them is required because an ES import binding cannot be reassigned by the importer (`openSeq++`/`acting = true` would fail to compile from another module), while mutating a property on an imported `const` object works fine.

```ts
import type { Canonical, Target, QueueItem, FileTags } from "../shared/contracts";

/** Shared, mutable Revue state for the current filing session. Destination-selection state
 *  (library root, bin list, selected bin, "sur place" flag) moved to filing-bins.ts's own
 *  DestState (tech-debt audit F03 — god-file split, first tranche). */
export interface RevueState {
  track: QueueItem | null; // currently open track
  canonical: Canonical | null; // reconciled (then user-edited) metadata
  target: Target | null; // format override (null = backend rail default)
  // Analysed rail of the open track ("lossless" | "lossy" | "unknown"), set in openFilingInto. The
  // single source for the default format when target is null — used by BOTH the lit chip and the
  // Final-name preview (defaultTarget) so they never disagree on open.
  rail: string;
  // Read-only Discogs release facts for the open track. NOT part of Canonical (which drives the
  // filename/tags and is a Rust-mirrored contract) — kept here so the editor can show them. Loaded
  // from `releaseCache` on open, or set from `applied` on identify; null = unknown (no display).
  label: string | null;
  year: number | null;
  // Country/format of the applied release (e.g. "UK", "Vinyl, 12\", EP") — same session-cache-only
  // scope as label/year above, except there is no persisted backend column for these two (Rust
  // TrackRelease has none): they survive a close+reopen within this session (releaseCache) but not
  // an app restart, until/unless the metadata table grows matching columns (2026-07-06 annotation:
  // previously these were shown in the candidate list, then dropped the instant a candidate got
  // selected — kept here so the read-only release line below Genres keeps showing them afterwards).
  releaseCountry: string | null;
  releaseFormat: string | null;
  // Cover of the applied/persisted release — needed to re-run restoreIdentifiedLine() outside the
  // openFilingInto cold-open path (2026-07-06 annotation: reopening the Métadonnées zone re-renders
  // the editor and must be able to redraw the "Identifié :" confirmation line the same way).
  coverPath: string | null;
  // The would-write sub-genres for the open track (DB track_genres order), shown in .sift-genres and
  // compared (joined) against the file. Set on open from track_release, or from `applied.styles`.
  genres: string[];
  // The file's REAL tags, snapshotted ONCE on open (and re-read after an Apply/File). The marker
  // compares the displayed identity to THIS in-memory snapshot — never a per-keystroke disk read.
  // null until the open-time read resolves.
  fileTags: FileTags | null;
  // After a Detail-mode filing, the just-filed track's batch_id + bin label → drives the
  // persistent "Filed ↩" confirmation in #mid (targeted revert via the journal). Null = none up.
  filedConfirm: { batchId: string; bin: string } | null;
  // True once a Discogs identity is applied to the open track (fresh fetch OR persisted-identified
  // reopen). Gates the "rebuy on Beatport" link: searching a raw filename is useless — only a
  // confirmed artist+title is worth a store search.
  identified: boolean;
}

export const state: RevueState = {
  track: null,
  canonical: null,
  target: null,
  rail: "unknown",
  label: null,
  year: null,
  releaseCountry: null,
  releaseFormat: null,
  coverPath: null,
  genres: [],
  fileTags: null,
  filedConfirm: null,
  identified: false,
};

// Bumped on every open; an in-flight open/action bails at its await points if a newer one started
// (prevents a slow analyze/reconcile/applyIdentity/applyTags/revert from clobbering the pane of a
// track opened since). `acting` guards against a double-click firing two encodes (one action at a
// time). Grouped into one object (not two module-level `let`s) — see file header comment above.
export const openState = { openSeq: 0, acting: false };
```

- [ ] **Step 2: Update `frontend/filing.ts` to import from `filing-state.ts`**

Remove lines 65-120 (the `RevueState` interface + `state` const), the `let openSeq = 0;` line, and the `let acting = false;` line from `filing.ts`. Add near the top of the import block:

```ts
import { state, openState } from "./filing-state";
```

Then, **within `filing.ts` only** (the other tasks below handle their own files), replace every remaining reference to the bare `openSeq` with `openState.openSeq` and every bare `acting` with `openState.acting`. At this point in `filing.ts` that's inside `openFilingInto` (`const myseq = ++openSeq;` → `const myseq = ++openState.openSeq;`, and the two `if (myseq !== openSeq) return;` guards → `if (myseq !== openState.openSeq) return;`). The functions that reference `acting`/`openSeq` elsewhere (`doApplyTags`, `doUndoApply`, `wireCandidateClicks`, `doIdentify`, `doRanger`, `doSecondary`) move out to other files in later tasks — do the same `openSeq`→`openState.openSeq`/`acting`→`openState.acting` rename at the point each one is cut, not here.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: same errors as before Step 1/2 (all the functions not yet updated for `openState` will fail — that's expected, they get fixed in their own tasks below). If `filing-state.ts` itself has a type error, fix it now; do not proceed with type errors originating from `filing-state.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/filing-state.ts frontend/filing.ts
git commit -m "refactor(filing): extract filing-state.ts (RevueState + openState)"
```

---

### Task 2: `frontend/filing-toast.ts` — toast utility

**Files:**
- Create: `frontend/filing-toast.ts`
- Modify: `frontend/filing.ts`

**Interfaces:**
- Consumes: `undoLast` from `./ipc`, `esc` from `./dom`.
- Produces: `toast(message: string, undo: boolean, onUndo?: () => void): void`, `registerClearPaneHook(hook: (mid: HTMLElement) => void): void` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Confirm the dead-code branch before moving (verification, not a code change)**

Run: `grep -n "toast(" frontend/filing.ts`
Expected: every call site with `undo=true` (currently only the one inside `doSecondary`, `filing.ts:1338`) passes an explicit `onUndo` callback. This means `toast`'s own internal fallback (`undo=true` with `onUndo` omitted, which calls `undoLast()` then `clearPane(mid)`) is never exercised by any current call site in this file — but it is not dead code in the general sense (any future caller could hit it), so it is kept, not deleted, per this plan's "refactor pur" constraint.

- [ ] **Step 2: Create `frontend/filing-toast.ts`**

`toast`'s fallback path calls `clearPane`, which stays in `filing.ts` (Task 6) — importing it directly would create `filing-toast.ts → filing.ts → filing-toast.ts` (renderFoot/openFilingInto need `toast` too, transitively via `doRanger`/`doApplyTags`). Resolve with a one-time registration hook, the same pattern `filing-bins.ts` already uses for `registerOpenTrackPathGetter`/`registerDestChangeHook` (see `filing.ts:139-140`).

```ts
import { undoLast } from "./ipc";
import { esc } from "./dom";

let clearPaneHook: ((mid: HTMLElement) => void) | null = null;

/** Registered once by filing.ts at module load (mirrors filing-bins.ts's
 *  registerOpenTrackPathGetter/registerDestChangeHook) — lets toast()'s default (LIFO) undo
 *  fallback clear the detail pane without this module importing filing.ts back (would be a
 *  static import cycle: filing.ts needs toast() too). */
export function registerClearPaneHook(hook: (mid: HTMLElement) => void): void {
  clearPaneHook = hook;
}

/** A transient toast at the bottom-right with an optional "Undo" action. With `onUndo` the Undo
 *  button runs that callback (e.g. a targeted revert of a specific batch); without it, Undo falls
 *  back to `undoLast` (the LIFO most-recent action) and clears the detail pane. */
export function toast(message: string, undo: boolean, onUndo?: () => void): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML =
    `<span>${esc(message)}</span>` +
    (undo
      ? '<button data-fil="undo" class="sift-toast-undo">Annuler</button>'
      : "");
  document.body.appendChild(el);
  el.querySelector('[data-fil="undo"]')?.addEventListener("click", () => {
    el.remove();
    if (onUndo) {
      onUndo(); // targeted revert (e.g. revertBatch of THIS tag_edit) — pane stays as-is
      return;
    }
    void undoLast()
      .then(() => {
        // the just-filed track is back in the queue — clear the stale detail pane
        const mid = document.getElementById("mid");
        if (mid) clearPaneHook?.(mid);
      })
      .catch((e) => console.error("undo failed", e));
  });
  setTimeout(() => el.remove(), 6000);
}
```

- [ ] **Step 3: Remove `toast` from `filing.ts`, wire the registration**

Delete the `function toast(...)` block (`filing.ts:1130-1161` in the pre-Task-1 file — line numbers shift after Task 1's edits, locate by the `/** A transient toast...` comment instead). Add to the import block:

```ts
import { toast, registerClearPaneHook } from "./filing-toast";
```

Near the existing `registerOpenTrackPathGetter(...)`/`registerDestChangeHook(...)` calls (module-load-time wiring, `filing.ts:139-140`), add a third registration call. `clearPane` itself is defined further down in the same file (Task 6 keeps it there) — a `function` declaration is hoisted, so referencing it here before its textual definition is valid:

```ts
registerClearPaneHook(clearPane);
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this task (errors from not-yet-migrated `openSeq`/`acting` references from Task 1 may still be present — fine, they clear in later tasks).

- [ ] **Step 5: Commit**

```bash
git add frontend/filing-toast.ts frontend/filing.ts
git commit -m "refactor(filing): extract filing-toast.ts (toast utility)"
```

---

### Task 3: `frontend/filing-preview.ts` — name/preview rendering helpers

**Files:**
- Create: `frontend/filing-preview.ts`
- Modify: `frontend/filing.ts`

**Interfaces:**
- Consumes: `state` from `./filing-state`, `Target` type from `../shared/contracts`, `previewFilename` from `./ipc`.
- Produces: `TARGET_LABEL: Record<Target, string>`, `titleCase(s: string): string`, `defaultTarget(rail: string): Target`, `targetExt(t: Target): string`, `displayName(): string`, `fadeSetText(el: HTMLElement, next: string): void`, `updateHeaderName(mid: HTMLElement): void`, `refreshPreview(): void` — consumed by Task 4 (`filing-identify.ts`) and by `filing.ts` itself (Task 6).

This is the one file both remaining groups (identification/editor and rail actions) need — extracted first among the two so neither has to import the other.

- [ ] **Step 1: Create `frontend/filing-preview.ts`**

Cut the following, verbatim, from `filing.ts` (locate by name — exact line numbers have shifted after Tasks 1-2; use the comment immediately above each as an anchor):
- `titleCase` const (originally `filing.ts:57-60`, comment starts `/** Capitalise the first letter...`)
- `TARGET_LABEL` const (originally `filing.ts:147-151`)
- `defaultTarget` function (originally `filing.ts:143-145`)
- `targetExt` function (originally `filing.ts:153-157`)
- `displayName` function (originally `filing.ts:159-165`)
- `fadeSetText` function (originally `filing.ts:167-188`)
- `updateHeaderName` function (originally `filing.ts:190-208`)
- `previewSeq`/`previewTimer` module-level `let`s and the `refreshPreview` function (originally `filing.ts:255-284`, comment starts `// FIX-12: refreshPreview is wired...`)

Assemble into the new file with these imports:

```ts
import type { Target } from "../shared/contracts";
import { previewFilename } from "./ipc";
import { state } from "./filing-state";
```

Every reference to the bare `openSeq`/`acting` inside this block: there are none (verified by reading the cut functions — `refreshPreview` and friends only touch `state`, DOM, and their own module-level `previewSeq`/`previewTimer`). No `openState` rename needed here.

- [ ] **Step 2: Update `filing.ts`**

Remove the cut blocks. Add to the import block:

```ts
import {
  TARGET_LABEL,
  titleCase,
  defaultTarget,
  targetExt,
  displayName,
  fadeSetText,
  updateHeaderName,
  refreshPreview,
} from "./filing-preview";
```

`TARGET_LABEL` was previously `export const` directly in `filing.ts` and is imported by `frontend/batch-panel.ts:6` as `import { openFilingInto, TARGET_LABEL } from "./filing"`. Re-export it so that import keeps resolving unchanged:

```ts
export { TARGET_LABEL } from "./filing-preview";
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors from `filing-preview.ts` or from `filing.ts`'s use of it. `frontend/batch-panel.ts` must still typecheck (confirms the re-export works) — if it errors, the re-export line was placed wrong or is missing.

- [ ] **Step 4: Commit**

```bash
git add frontend/filing-preview.ts frontend/filing.ts
git commit -m "refactor(filing): extract filing-preview.ts (name/preview rendering helpers)"
```

---

### Task 4: `frontend/filing-identify.ts` — Discogs identification + editor + apply-tags

**Files:**
- Create: `frontend/filing-identify.ts`
- Modify: `frontend/filing.ts`

**Interfaces:**
- Consumes: `state`, `openState` from `./filing-state`; `toast` from `./filing-toast`; `refreshPreview`, `updateHeaderName`, `titleCase` from `./filing-preview`; `requireEl`, `esc` from `./dom`; `renderCandidates` from `./identify-shared`; `resolveGenreFamily` from `./genre-families`; `convertFileSrc` from `@tauri-apps/api/core`; ipc functions `identify`, `applyIdentity`, `applyTags`, `revertBatch`, `trackFileTags`, `openUrl`; types `Candidate`, `AppliedIdentity` from `./ipc`, `AnalysisReport` from `../shared/contracts`; `keyboardHintsHtml`, `zoneToggleHtml` from `./report-view` (only used inside `renderEditor`, confirm still needed — see Step 1 note).
- Produces: `renderEditor(host: HTMLElement, mid: HTMLElement, rail: string, report: AnalysisReport | null): void`, `restoreIdentifiedLine(editor: HTMLElement, mid: HTMLElement, artist: string, title: string, coverPath: string | null): void`, `renderGenres(): void`, `refreshDiscrepancy(): void` — all 4 consumed by `filing.ts` (Task 6, inside `openFilingInto`).

**Why apply-tags moves here, not into `filing-actions.ts`:** `onIdentityApplied` calls `doApplyTags` directly (auto-apply on fresh identify, `filing.ts:511` pre-split), and `doApplyTags`/`doUndoApply` call `setApplyIdle`/`setApplyApplied`/`resetApplyButton`, which are themselves called from inside `renderEditor`. All 5 are one coherent unit (the editor's own write-path) with no external caller outside this file — keeping them together avoids a `filing-identify.ts ↔ filing-actions.ts` cycle that a 2-way "identify vs actions" split would otherwise create.

- [ ] **Step 1: Create `frontend/filing-identify.ts`**

Cut the following, verbatim, in this order (locate each by its doc-comment, anchors given):
1. `releaseCache` const (`/** Per-track Discogs release facts...` — originally around `filing.ts:293-296`)
2. `renderGenres` function (`/** Render the genre chips...`)
3. `joinGenres` const
4. `tagFieldDiffs` function
5. `refreshDiscrepancy` function
6. `onIdentityApplied` function
7. `identifiedLineHtml` function
8. `restoreIdentifiedLine` function
9. `wireCandidateClicks` function
10. `doIdentify` function
11. `renderEditor` function (the large one, `/** Render the center metadata editor...`)
12. `beatportSearchUrl` function
13. `refreshRebuyLink` function
14. `APPLY_IDLE_HTML` const
15. `setApplyIdle` function
16. `setApplyApplied` function
17. `resetApplyButton` function
18. `doApplyTags` function
19. `doUndoApply` function

Also move the two module-level UI-state `let`s these functions close over: `identEditing` (`let identEditing = false;`, originally `filing.ts:125`) and `closeMetaZone` (`let closeMetaZone: (() => void) | null = null;` plus the `document.addEventListener("sift:accordion-open", ...)` block right after it, originally `filing.ts:131-134`) — both are read/written exclusively inside `renderEditor` (the accordion-close listener calls `closeMetaZone?.()`, and `renderEditor` is the only place that assigns to it).

Within every cut function, replace `openSeq` → `openState.openSeq` and `acting` → (not applicable here — `acting` is only read/written by `doRanger`/`doSecondary`, which move in Task 5).

Header imports for the new file:

```ts
import { identify, applyIdentity, applyTags, revertBatch, trackFileTags, openUrl } from "./ipc";
import type { Candidate, AppliedIdentity } from "./ipc";
import type { AnalysisReport } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { keyboardHintsHtml, zoneToggleHtml } from "./report-view";
import { renderCandidates } from "./identify-shared";
import { resolveGenreFamily } from "./genre-families";
import { requireEl, esc } from "./dom";
import { state, openState } from "./filing-state";
import { toast } from "./filing-toast";
import { refreshPreview, updateHeaderName, titleCase } from "./filing-preview";
```

- [ ] **Step 2: Update `filing.ts`**

Remove the cut blocks and the two `let`s + accordion listener. Add to the import block:

```ts
import { renderEditor, restoreIdentifiedLine, renderGenres, refreshDiscrepancy } from "./filing-identify";
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean except for any remaining `filing-actions.ts` extraction not yet done (Task 5) — `renderFoot`'s wiring to `doRanger`/`doSecondary` and `doRanger`/`doSecondary`/`doRevert`/`showFiledConfirm`/`setActionsDisabled`/`IN_PLACE_BIN_LABEL` are still in `filing.ts` at this point, which is correct and should compile on its own.

- [ ] **Step 4: Manual behavior checklist (Antoine, real `tauri dev` window)**

With `tauri dev` running (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev` if using `.claude/scripts/cdp.cjs` to drive it, otherwise just `npm run tauri dev` and look):
1. Open a track in Revue, expand Métadonnées → editor renders with the expected fields.
2. Click "Rechercher sur Discogs" (or "Récupérer les métadonnées") → candidates list appears, click one → identity applies, cover shows if present, genres chips render, Apply-tags auto-runs and flips to "Annulé ✓ — Annuler".
3. Click "Annuler" on the just-applied tags → reverts, button returns to idle, discrepancy banner reappears if applicable.
4. Edit the Artist/Title/Version fields by hand → filename preview (`Nom final`) updates, header name updates, discrepancy banner toggles correctly.
5. Close and reopen the Métadonnées zone → "Identifié :" line and genres redraw correctly (tests `restoreIdentifiedLine`/`renderGenres` reachable from the reopen path).

If any of these regress, do not proceed to Task 5 — fix first (this task's cut is the most likely source of a real coupling this plan didn't anticipate; escalate rather than guessing, same discipline as the `sift-live.ts` Phase 1 split).

- [ ] **Step 5: Commit**

```bash
git add frontend/filing-identify.ts frontend/filing.ts
git commit -m "refactor(filing): extract filing-identify.ts (Discogs identification + editor + apply-tags)"
```

---

### Task 5: `frontend/filing-actions.ts` — Ranger/Revert/Secondary rail actions

**Files:**
- Create: `frontend/filing-actions.ts`
- Modify: `frontend/filing.ts`

**Interfaces:**
- Consumes: `state`, `openState` from `./filing-state`; `toast` from `./filing-toast`; `requireEl`... (not needed, verify — `doRanger`/`doSecondary`/`doRevert` use `document.querySelector` directly, not `requireEl`); `esc` from `./dom`; `confirmAction` from `./confirm-modal`; `fileInPlaceChecked`, `getBinRel`, `binLabel` from `./filing-bins`; `FILE_IN_PLACE` from `../shared/contracts`; ipc functions `fileTrack`, `listQueue`, `rejectTrack`, `requeueTrack`, `revertBatch`; type `QueueItem` from `../shared/contracts`.
- Consumes from `filing.ts` (passed as explicit function parameters, NOT imported — this is what avoids a `filing-actions.ts ↔ filing.ts` cycle): `openFilingInto: (mid: HTMLElement, item: QueueItem) => Promise<void>` and `clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void`.
- Produces: `doRanger(mid: HTMLElement, openNext: (mid: HTMLElement, item: QueueItem) => Promise<void>, clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void): Promise<void>`, `doSecondary(mid: HTMLElement, kind: "resource" | "trash", clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void): Promise<void>` — both consumed by `renderFoot` in `filing.ts` (Task 6).

**Why `openFilingInto`/`clearPane` are passed as parameters instead of imported:** `doRanger` calls `openFilingInto` to auto-advance to the next track after a successful file, and both `doRanger`/`doSecondary` call `clearPane`. Both stay in `filing.ts` (the orchestrator). Importing them into `filing-actions.ts` would create a cycle (`filing.ts` needs `doRanger`/`doSecondary` for `renderFoot`'s click handlers). Passing them as parameters at the one real call site (`renderFoot`, which already has both in scope in the same file) is simpler than a `registerXxx()` module-load hook for a value only used at 2 call sites — no cross-module singleton needed.

- [ ] **Step 1: Create `frontend/filing-actions.ts`**

Cut the following, verbatim, in this order (anchors given):
1. `IN_PLACE_BIN_LABEL` const (`/** Banner label when a track was filed in place...`, originally `filing.ts:55`)
2. `setActionsDisabled` function
3. `doRanger` function
4. `showFiledConfirm` function
5. `doRevert` function
6. `doSecondary` function

Inside the cut `doRanger`/`doSecondary` bodies: replace `acting` → `openState.acting`, and the two internal calls to `openFilingInto`/`clearPane` become the new parameters (see signatures below — this is the one non-verbatim change in this task, required to avoid the cycle described above).

```ts
import { fileTrack, listQueue, rejectTrack, requeueTrack, revertBatch } from "./ipc";
import type { QueueItem } from "../shared/contracts";
import { FILE_IN_PLACE } from "../shared/contracts";
import { esc } from "./dom";
import { confirmAction } from "./confirm-modal";
import { fileInPlaceChecked, getBinRel, binLabel } from "./filing-bins";
import { state, openState } from "./filing-state";
import { toast } from "./filing-toast";

/** Banner label when a track was filed in place (its own source folder, not a tree bin). */
const IN_PLACE_BIN_LABEL = "source folder";

/** Disable/enable the rail action buttons (visible feedback while an action runs). The buttons
 *  live in #filfoot now, so query the document rather than the #mid pane. */
function setActionsDisabled(disabled: boolean): void {
  document
    .querySelectorAll<HTMLButtonElement>('[data-fil="ranger"],[data-fil="resource"],[data-fil="trash"]')
    .forEach((b) => {
      b.disabled = disabled;
      b.style.opacity = disabled ? "0.55" : "";
      b.style.pointerEvents = disabled ? "none" : "";
    });
}

/** Ranger the current track into the selected bin. */
export async function doRanger(
  mid: HTMLElement,
  openNext: (mid: HTMLElement, item: QueueItem) => Promise<void>,
  clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void,
): Promise<void> {
  if (!state.track || !state.canonical || openState.acting) return;
  const track = state.track;
  const canonical = state.canonical;
  const inPlace = fileInPlaceChecked();
  const dest = inPlace ? FILE_IN_PLACE : getBinRel();
  if (dest === null) {
    toast("Choisis un dossier de destination.", false);
    return;
  }
  const ranger = document.querySelector<HTMLElement>('[data-fil="ranger"]');
  const orig = ranger?.innerHTML ?? null;
  openState.acting = true;
  setActionsDisabled(true);
  if (ranger)
    ranger.innerHTML =
      '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Conversion en cours…';
  let allowRailMismatch = false;
  try {
    for (;;) {
      try {
        const res = await fileTrack(track.id, dest, state.target, canonical, allowRailMismatch);
        const filedPath = res.path;
        const batchId = res.batch_id;
        const bin = inPlace ? IN_PLACE_BIN_LABEL : binLabel();
        let items: QueueItem[] = [];
        try {
          items = await listQueue();
        } catch (err) {
          console.error("listQueue failed after filing", err);
        }
        if (items.length) await openNext(mid, items[0]);
        else clearPane(mid, true);
        showFiledConfirm(batchId, bin, filedPath);
        return;
      } catch (e) {
        const msg = String(e);
        if (!allowRailMismatch && msg.includes("RAIL_MISMATCH")) {
          const ext = (track.path.split(".").pop() || "").toUpperCase();
          const proceed = await confirmAction(
            `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
              `le convertir créerait un faux fichier lossless.\n\nConvertir quand même ?`,
          );
          if (proceed) {
            allowRailMismatch = true;
            continue;
          }
          setActionsDisabled(false);
          if (ranger && orig != null) ranger.innerHTML = orig;
          return;
        }
        throw e;
      }
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else if (/permission|access|denied/i.test(msg)) toast("Refusé : accès au fichier/dossier refusé.", false);
    else if (/no such file|not found|introuvable/i.test(msg)) toast("Fichier introuvable — a-t-il été déplacé ?", false);
    else toast(`Échec de la conversion : ${msg}`, false);
    console.error("file_track failed", e);
    setActionsDisabled(false);
    if (ranger && orig != null) ranger.innerHTML = orig;
  } finally {
    openState.acting = false;
  }
}

/** Show the "Filed ✓ ↩" confirmation as a BANNER at the TOP of the right rail (#filfoot), above the
 *  next track's controls — the center has already auto-advanced to the next pending track (doRanger).
 *  This is the "after" proof for the file just filed: name + destination path + a targeted Revert.
 *  ONE banner at a time (replaces any prior). Revert is targeted on this file's `batchId`
 *  (revert_batch), available indefinitely via the journal; the ✕ dismisses the banner without
 *  reverting. Does NOT touch #mid or state.track — the advance owns those. */
function showFiledConfirm(batchId: string, bin: string, filedPath: string): void {
  state.filedConfirm = { batchId, bin };
  const foot = document.getElementById("filfoot");
  if (!foot) return;
  const filename = filedPath.split(/[\\/]/).pop() || filedPath;
  foot.querySelector(".sift-filed-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "sift-filed-banner";
  banner.innerHTML =
    `<div class="sift-filed-banner-head">` +
    `<i class="ti ti-check"></i>` +
    `<span class="sift-filed-banner-label">Converti</span>` +
    `<span class="sift-filed-banner-bin">→ ${esc(bin)}</span>` +
    `<button data-fil="filed-close" title="Fermer" aria-label="Fermer" class="sift-filed-banner-close"><i class="ti ti-x"></i></button>` +
    `</div>` +
    `<div class="sift-filed-banner-name">${esc(filename)}</div>` +
    `<div class="sift-filed-banner-path">${esc(filedPath)}</div>` +
    `<button data-fil="revert" class="sift-filed-banner-revert"><i class="ti ti-arrow-back-up"></i> Annuler</button>`;
  foot.prepend(banner);
  banner.querySelector('[data-fil="revert"]')?.addEventListener("click", () => void doRevert(batchId));
  banner.querySelector('[data-fil="filed-close"]')?.addEventListener("click", () => {
    banner.remove();
    state.filedConfirm = null;
  });
}

/** Revert THIS file's filing, targeted on its `batchId` (revert_batch). On success the engine
 *  puts the track back to pending and emits queue:changed → the queue refreshes. On a Blocked
 *  engine error (e.g. the original was purged from the trash) show a clear message rather than
 *  failing mutely. The revert engine itself is untouched here. */
async function doRevert(batchId: string): Promise<void> {
  try {
    await revertBatch(batchId);
    document.getElementById("filfoot")?.querySelector(".sift-filed-banner")?.remove();
    state.filedConfirm = null;
    toast("Annulé — retour dans la file", false);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("source gone")) {
      toast("Annulation impossible : un fichier nécessaire a disparu — l'original a peut-être été purgé de la corbeille.", false);
    } else {
      toast(`Échec de l'annulation : ${msg}`, false);
    }
    console.error("revert failed", e);
  }
}

/** Re-sourcer (fake) ou Écarter (non-fake) the current track — both are the same reversible
 *  reject_track path now (annotation: "jeter devrait etre écarté, et finir dans écarter"); `kind`
 *  stays two-valued only to pick the right toast wording, not a different backend action anymore. */
export async function doSecondary(
  mid: HTMLElement,
  kind: "resource" | "trash",
  clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void,
): Promise<void> {
  if (!state.track || openState.acting) return;
  const trackId = state.track.id;
  openState.acting = true;
  setActionsDisabled(true);
  try {
    await rejectTrack(trackId);
    toast(kind === "resource" ? "Marqué à re-sourcer" : "Écarté", true, () => {
      void requeueTrack(trackId).catch((e) => {
        console.error(`${kind} undo failed`, e);
        toast(`Échec de l'annulation : ${String(e)}`, false);
      });
    });
    clearPane(mid);
  } catch (e) {
    toast(`Échec : ${String(e)}`, false);
    console.error(`${kind} failed`, e);
    setActionsDisabled(false);
  } finally {
    openState.acting = false;
  }
}
```

- [ ] **Step 2: Update `filing.ts`**

Remove the cut blocks and the `let acting = false;` (already removed in Task 1 if not already gone — confirm it's gone). Add to the import block:

```ts
import { doRanger, doSecondary } from "./filing-actions";
```

In `renderFoot`, update the two click-handler wiring lines to pass the new parameters:

```ts
foot
  .querySelector('[data-fil="ranger"]')
  ?.addEventListener("click", () => void doRanger(mid, openFilingInto, clearPane));
foot
  .querySelector('[data-fil="resource"]')
  ?.addEventListener("click", () => void doSecondary(mid, "resource", clearPane));
foot
  .querySelector('[data-fil="trash"]')
  ?.addEventListener("click", () => void doSecondary(mid, "trash", clearPane));
```

(`openFilingInto` and `clearPane` are both still defined later in the same `filing.ts` file — `function`/`export async function` declarations are hoisted, so this reference is valid even though `renderFoot` is textually above them.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. This is the last extraction task — if any `openSeq`/`acting` bare references remain anywhere in `filing.ts`, `tsc` will now surface them as "Cannot find name" errors; fix by qualifying through `openState`.

- [ ] **Step 4: Manual behavior checklist**

1. With a destination chosen, click "Convertir" (Ranger) on an open track → converts, auto-advances to the next pending track, "Converti" banner shows at the top of the rail with the right filename/path, "Annuler" on the banner reverts it back to pending.
2. Trigger a RAIL_MISMATCH (a mislabeled lossless file, if a fixture exists) → confirmation dialog appears, confirming proceeds with the conversion, cancelling leaves the track untouched.
3. Click "Écarter" on a non-fake track → track leaves the queue, toast shows with "Annuler", undo restores it to pending.
4. Click "Re-source" on a fake-verdict track → same flow, correct wording ("Marqué à re-sourcer").

If any of these regress, fix before Task 6 (do not paper over — this task's parameter-passing change to `doRanger`/`doSecondary` is the one place this plan deviated from verbatim-copy, so it's the most likely spot for a real mistake).

- [ ] **Step 5: Commit**

```bash
git add frontend/filing-actions.ts frontend/filing.ts
git commit -m "refactor(filing): extract filing-actions.ts (Ranger/Revert/Secondary rail actions)"
```

---

### Task 6: Final cleanup + full verification of `frontend/filing.ts`

**Files:**
- Modify: `frontend/filing.ts`

**Interfaces:**
- No new interfaces — this task only confirms what remains is coherent and nothing was missed.

- [ ] **Step 1: Confirm what remains in `filing.ts`**

Run: `awk '/^(export )?(async )?function/{print NR": "$0}' frontend/filing.ts`
Expected function list (order may differ): `refreshRangerButton`, `refreshFootButton`, `renderGenres` (— wait, this one already moved in Task 4; if it still appears here, Task 4's Step 2 removal was incomplete, go back and fix it), `ensureKbdLegend`, `positionFmtThumb`, `renderFoot`, `clearPane`, `dupBanner`, `openFilingInto`, `installFilingKeys`, `installUndoShortcut`, `syncDetail`. Plus the module-level `destValueLabel` function and the `IN_PLACE_BIN_LABEL`-free top-of-file imports.

If any function from Tasks 1-5's cut lists still appears in this output, it was left behind by mistake — remove it and re-verify its consumer imports it from the correct new file instead.

- [ ] **Step 2: Confirm no other file's imports broke**

Run: `grep -rn 'from "\./filing"' frontend/*.ts`
Expected: only `frontend/batch-panel.ts` (importing `openFilingInto` and `TARGET_LABEL`, both still resolvable — `openFilingInto` never moved, `TARGET_LABEL` is re-exported per Task 3 Step 2). If any other file imports a name from `"./filing"` that moved to `filing-identify.ts`/`filing-actions.ts`/`filing-preview.ts`/`filing-state.ts`/`filing-toast.ts` in this plan, update that file's import to the new source module.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit`
Expected: clean, zero errors repo-wide (not just in the touched files — a signature change like `doRanger`'s new parameters could theoretically ripple, though no other file calls `doRanger`/`doSecondary` directly per this plan's analysis).

Run: `wc -l frontend/filing.ts frontend/filing-state.ts frontend/filing-toast.ts frontend/filing-preview.ts frontend/filing-identify.ts frontend/filing-actions.ts`
Expected: `filing.ts` roughly 550-650 lines (down from 1660), the 5 new files summing to make up the difference — no line count should have grown or shrunk beyond what verbatim relocation explains (a large unexplained delta means something was accidentally duplicated or dropped).

- [ ] **Step 4: Full manual behavior checklist (superset of Tasks 4/5's checklists, run once end-to-end)**

Against the real `tauri dev` window:
1. Open Revue with a pending queue, open a track → report + editor + rail all render.
2. Identify via Discogs, apply auto-runs, undo it manually, re-apply.
3. Edit fields by hand, watch the preview/header/discrepancy update live.
4. Choose a destination, convert (Ranger) → auto-advances, banner shows, revert from the banner.
5. Écarter a track, undo from the toast.
6. Ctrl+Z (global undo) after some action → undoes the most recent one.
7. Keyboard shortcuts (Space play/pause, Enter = Ranger, Backspace = Écarter, I = Identifier) all still fire.
8. Close the app, reopen `tauri dev`, reopen an already-identified/already-tagged track → "Identifié :" line, genres, and discrepancy state restore correctly from persisted data (cold-start path, not just same-session).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/
git commit -m "refactor(filing): finish TECH_DEBT_AUDIT.md F03 split — filing.ts 1660→~600 lines"
```

- [ ] **Step 6: Update `TECH_DEBT_AUDIT.md` and `docs/INDEX.json`**

In `TECH_DEBT_AUDIT.md`, update the F03 row's status from "Track as next split candidate" to done, referencing this plan and the resulting file list. In `docs/INDEX.json`, add an entry under `"plans"` for `docs/superpowers/plans/2026-07-20-filing-ts-split.md` (same format as the existing entries — path/date/topic/summary, summary should note the final 6-file structure and that it shipped with zero behavior change per the manual checklists).

```bash
git add TECH_DEBT_AUDIT.md docs/INDEX.json
git commit -m "docs: mark filing.ts split (F03) done, index the plan"
```
