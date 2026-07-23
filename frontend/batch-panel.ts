// Revue batch mode panel — selection, group rendering, two-click confirm, batch filing rail.
// Extracted from sift-live.ts (Phase 1, tranche 1c). Reads currentItems/reviewMode/verdictDot
// from queue-panel.ts (leaf-to-leaf import, one direction only — queue-panel.ts never imports
// from here). sift-live.ts's setReviewMode (cross-panel orchestrator, kept there since tranche
// 1b) imports renderBatch + the batch destination state from here for its "batch" branch.
import { openFilingInto, TARGET_LABEL } from "./filing";
import {
  renderBinsForBatch,
  ensureDestPopoverAutoClose,
  setBinPickInert,
  toggleDestPopover,
  repositionDestPopoverIfOpen,
} from "./filing-bins";
import { fileBatch, fileCancel, rejectBatch } from "./ipc";
import { requireEl, esc } from "./dom";
import type { QueueItem, BatchResult, FileProgress, Target } from "../shared/contracts";
import { FILE_IN_PLACE, EXTERNAL_DEST_PREFIX, MAX_ANALYSIS_ATTEMPTS } from "../shared/contracts";
import {
  setTask,
  clearTask,
  mountProgressZone,
  homeProgressZone,
} from "./progress-zone";
import {
  startBatchTracklist,
  updateBatchTracklist,
  finishBatchTracklist,
  clearBatchTracklist,
} from "./batch-tracklist";
import { currentItems, reviewMode, verdictDot, prefetchNextAfter, enterDetailMode } from "./queue-panel";

/** Human label for the batch destination (resolves the in-place sentinel to its prose). */
const IN_PLACE_LABEL = "Dossier source de chaque morceau";

// Above this many tracks, Ranger requires a second confirming click first (same threshold as the
// Journal's mass-revert) — a batch run has no recap screen, so it's the only guard before
// moving+encoding a very large selection in one click (audit UI/UX 2026-07-03, fix 3).
// A real two-click arm/confirm cycle IN THE RAIL, not window.confirm(): a live test found a
// synthetic click ran straight through confirm() in this Tauri webview (no dialog, no block),
// filing ~265 real tracks before Stop could catch up — a native dialog is not a trustworthy
// guard here regardless of the cause, so the guard must be the app's own UI.
const BATCH_CONFIRM_THRESHOLD = 10;
let batchConfirmArmed: { fileN: number; fakeN: number; at: number } | null = null;
let batchConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const batchSel = new Set<number>();
// Auto-fill the ticks to "all ready" ONCE, on the first batch render that has ready items. Without
// this guard renderBatch re-filled whenever batchSel hit 0, which silently undid "Aucun (clear)".
let batchSelInit = false;
// Fakes ticked for DISCARD (never filed — Sift never ranges a fake lossless). Kept separate from
// batchSel (fileables → File) so the rail action button can be adaptive (File n / Discard n / both).
const batchFakeSel = new Set<number>();
// Per-group collapse (Prêts/À vérifier/En analyse). Reintroduced 2026-07-02 on explicit request —
// a prior pass removed this because it wasn't in the maquette, but that was written for
// reasonably-sized batches; with thousands of "Prêts" rows the fixed DOM order (ready → fake →
// pending) buries the other two groups thousands of rows down, making them unreachable in
// practice. Collapsing "Prêts" solves that without reordering the groups. Default: all expanded.
const batchCollapsed = new Set<"file" | "fake" | "readonly">();
// Progressive-disclosure cap per group (Task 3b). "Prêts" can reach thousands (see the collapse
// note above); mounting them all is the batch board's version of the queue's black-screen freeze.
// The group's collapsible structure (headers, tri-state, per-group empty states) makes true
// scroll-windowing invasive, so instead each group renders at most BATCH_GROUP_PAGE rows and a
// "afficher les N suivants" control bumps its cap (same progressive-disclosure grammar already used
// for the queue's "+ N traités" and Écartés' hover-revealed links). Selection state is unaffected —
// it lives entirely in the Sets, never in the mounted DOM, so a select-all still covers rows below
// the cap. Caps reset when leaving batch mode (setReviewMode).
export const BATCH_GROUP_PAGE = 200;
export const batchGroupCap: Record<"file" | "fake" | "readonly", number> = {
  file: BATCH_GROUP_PAGE,
  fake: BATCH_GROUP_PAGE,
  readonly: BATCH_GROUP_PAGE,
};
// Batch "file in place" toggle (FILE_IN_PLACE). Kept apart from batchBin so the picked folder is
// remembered while in-place is on. Effective destination = batchInPlace ? FILE_IN_PLACE : batchBin.
export let batchInPlace = false;
// Single encode target for the whole "Prêts · lossless" selection (maquette: one segmented format
// control for the batch, not one per source rail — a lossy-sourced file can still be asked for
// AIFF/WAV here, unlike the Détail rail which keeps the no-upscale guard). Fed to the filer as the
// same target for every submitted id.
let batchFormat: Target = "aiff_16_44";
// The ordered ids submitted to the currently-running batch — drives the per-track tracklist (the
// nth `file:progress.done` maps to batchTrackIds[n]). Set at submit, used at file:done.
let batchTrackIds: number[] = [];
// Destination bin chosen in the batch folder tree (forward-slash rel; "" = library root). Kept
// across renders so the choice doesn't reset while triaging.
export let batchBin = "";

/** The group-header tri-state checkbox glyph for a batch group (Prêts/À vérifier). Selection state
 * is read from the live Sets — reused by renderBatch's initial paint AND by mutateBatchTick's
 * targeted refresh, so both agree. "readonly" has no selection → empty string. */
function groupBoxHtml(kind: "file" | "fake" | "readonly", ids: number[]): string {
  const sel = kind === "file" ? batchSel : kind === "fake" ? batchFakeSel : null;
  if (!sel) return "";
  const n = ids.filter((id) => sel.has(id)).length;
  const st = ids.length === 0 || n === 0 ? "empty" : n === ids.length ? "full" : "partial";
  return st === "full"
    ? '<span class="sift-bgrp-box on"><i class="ti ti-check"></i></span>'
    : st === "partial"
      ? '<span class="sift-bgrp-box partial"><i class="ti ti-minus"></i></span>'
      : '<span class="sift-bgrp-box"></span>';
}

/** Targeted update after a single batch tick (Task 3a). Mutates ONLY: (1) the clicked row's
 * checkbox + highlight, (2) its group-header tri-state box, (3) the rail's selection count + action
 * button. Replaces the previous full renderBatch() on every checkbox click — that rebuilt every
 * group (thousands of rows in "Prêts") on a per-click event, the audit's worst frontend hotspot
 * (2026-07-05 P2). Structural changes (select-all, collapse, mode) still call renderBatch. */
function mutateBatchTick(kind: "file" | "fake", id: number, row: HTMLElement): void {
  const on = (kind === "file" ? batchSel : batchFakeSel).has(id);
  // Row: checkbox checked state + selected background (mirrors readyRow/fakeRow at build time).
  const cb = row.querySelector<HTMLInputElement>("input.sift-batch-ck");
  if (cb) cb.checked = on;
  row.style.background = on ? "var(--overlay-hover)" : "";
  // Group header tri-state box: rebuild just that one glyph from the live set.
  const ids =
    kind === "file"
      ? currentItems.filter((it) => it.verdict === "ok").map((it) => it.id)
      : currentItems.filter((it) => it.verdict === "fake").map((it) => it.id);
  const head = document.querySelector<HTMLElement>(`.sift-bgrp-head[data-grouphead="${kind}"]`);
  const oldBox = head?.querySelector(".sift-bgrp-box");
  if (oldBox) {
    const tmp = document.createElement("div");
    tmp.innerHTML = groupBoxHtml(kind, ids);
    const newBox = tmp.firstElementChild;
    if (newBox) oldBox.replaceWith(newBox);
  }
  // Rail: the only data-dependent pieces are the "N à ranger" count line and the action button.
  // Update them in place instead of renderBatchRail (which remounts the progress zone + dest tree).
  updateBatchRailSelection();
}

/** In-place refresh of the batch rail's selection count + action button after a tick — avoids the
 * full renderBatchRail rebuild (progress-zone remount, dest-tree re-render) on a mere selection
 * change. The count span + action slot are given stable hooks by renderBatchRail. */
function updateBatchRailSelection(): void {
  const count = document.getElementById("sift-batch-selcount");
  if (count) {
    const jeter = batchFakeSel.size ? ` · ${batchFakeSel.size} à jeter` : "";
    const reviewN = currentItems.filter((it) => it.verdict !== "ok").length;
    const exclus = reviewN
      ? ` · <span style="color:var(--color-text-tertiary)">${reviewN} exclus (en review)</span>`
      : "";
    count.innerHTML = `${batchSel.size} à convertir${jeter}${exclus}`;
  }
  const slot = document.querySelector(".sift-baction-slot");
  if (slot) slot.innerHTML = actionButtonHtml(batchRunning);
}

// Global progress zone — feed the "file" row from the per-file filing events (sous-étape 2). Mirror
// of pushAnalyzeProgress, but here done/total arrive straight from the event (no poll). On
// done==total the row flashes 100% "done" then auto-hides after 1.2s, exactly like the analyze row.
let fileClearTimer: ReturnType<typeof setTimeout> | undefined;
let fileStopping = false;
// True from the moment a batch File/Discard launches until file:done (or discard completes) — drives
// the rail button between its adaptive state and "Stop".
let batchRunning = false;
let lastFileProgress: FileProgress | null = null;
export function pushFileProgress(p: FileProgress) {
  lastFileProgress = p;
  if (p.total <= 0) {
    clearTask("file");
    return;
  }
  if (p.done < p.total) {
    clearTimeout(fileClearTimer);
    setTask("file", { done: p.done, total: p.total, state: "running", stopping: fileStopping });
  } else {
    setTask("file", { done: p.total, total: p.total, state: "done" });
    clearTimeout(fileClearTimer);
    fileClearTimer = setTimeout(() => {
      clearTask("file");
      clearBatchTracklist();
      refreshBatchTracksPreview(); // in-place: bring the source-folder preview back after the run
    }, 1200);
  }
  updateBatchTracklist(p.done); // first `done` rows = done, the (done)-th = running, rest = waiting
}

/** Stop button on the global zone's Filing row → request a stop-net cancel (sous-étape 3). The
 * in-flight file finishes and no new one starts; nothing is rolled back. The row shows "Stopping…"
 * until `file:done` arrives (handled by onFileBatchDone). The first click already takes effect
 * (flag set, button removed), but the only feedback used to be the small "Stopping…" at the bottom
 * of the nav rail — far from where the user clicked. While a conversion encodes, the counter is
 * frozen, so the cancel looks ignored and the user re-clicks into the void. We also drop an
 * immediate note at #filfoot (where they clicked File) so the click visibly registers right there. */
export function onFileStop() {
  if (fileStopping) return;
  fileStopping = true;
  if (lastFileProgress) {
    setTask("file", {
      done: lastFileProgress.done,
      total: lastFileProgress.total,
      state: "running",
      stopping: true,
    });
  }
  // Local, immediate feedback next to the action — explains the unavoidable wait on the in-flight
  // file (its encode cannot be cut). Replaced by the run summary when `file:done` arrives.
  fileNote(
    '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md);vertical-align:-1px"></i> Stop requested — finishing the current file…',
  );
  void fileCancel();
}

/** Batch triage view (maquette "Mode Lot"): 3 flat groups by verdict — Prêts · lossless
 * (selectable → File), À vérifier · fake (selectable → Écarter, never filed — Sift ne range
 * jamais un fake lossless), En analyse (read-only, encore en cours d'analyse). One shared
 * format selector for the whole file-able selection (renderBatchRail) — no per-source-rail
 * split; a lossy-sourced file CAN be asked for AIFF/WAV here (see docs/superpowers/plans/2026-07-02-refonte-ui-plan.md,
 * décision "maquette prime" du 2026-07-01 — seule la règle fakes-jamais-filés est gardée).
 * Every control is bound to a real command (`fileBatch` / `rejectBatch`); nothing is mocked. */
export function renderBatch() {
  const mid = requireEl("#mid", "renderBatch");
  const ready = currentItems.filter((it) => it.verdict === "ok");
  const fakes = currentItems.filter((it) => it.verdict === "fake");
  const pending = currentItems.filter((it) => it.verdict !== "ok" && it.verdict !== "fake");
  // Prune ticks to the live ready set; default to all-ready selected ONCE (first render with ready
  // items). Guarded by batchSelInit so an explicit "Aucun (clear)" (batchSel→0) is NOT re-filled.
  const readyIds = new Set(ready.map((it) => it.id));
  for (const id of [...batchSel]) if (!readyIds.has(id)) batchSel.delete(id);
  if (!batchSelInit && ready.length) {
    batchSelInit = true;
    for (const it of ready) batchSel.add(it.id);
  }

  // BEFORE (file name) + AFTER (Discogs artist — title once identified). When not yet identified
  // only the filename shows; identifying it (Identify all) reveals the clean name above the file.
  const nameCell = (it: QueueItem, dim = false) => {
    const after = it.artist && it.title ? `${it.artist} — ${it.title}` : null;
    const before = it.filename || it.path;
    const topColor = after
      ? "var(--color-text-primary)"
      : dim
        ? "var(--color-text-secondary)"
        : "var(--color-text-primary)";
    return (
      `<div style="flex:1;min-width:0">` +
      `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-md);color:${topColor}">${esc(
        after ?? before,
      )}</div>` +
      (after
        ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono);margin-top:1px"><span style="opacity:.55">was</span> ${esc(
            before,
          )}</div>`
        : "") +
      `</div>`
    );
  };
  const readyRow = (it: QueueItem) => {
    const on = batchSel.has(it.id);
    return (
      `<div class="bx-row" data-sift="batchpick" data-id="${it.id}" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;letter-spacing:.03em;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUPLICATE</span>'
        : "") +
      `</div>`
    );
  };
  // Read-only "En analyse" rows — no checkbox, matches the maquette's inert third group.
  const pendingRow = (it: QueueItem) => {
    // "analyse…" for a track genuinely still in the pipeline; "échec" for one the worker has given
    // up on (terminally failed decode) so it isn't mislabelled as forever-in-progress — recovery is
    // the same "Ouvrir en Détail" button below (which re-runs analysis on the real open).
    const label =
      it.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS
        ? "échec"
        : it.verdict === "grey"
          ? "CHECK"
          : "analyse…";
    return (
      `<div style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);opacity:.6">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUP</span>'
        : "") +
      `<span style="flex:none;font-size:var(--text-2xs);color:var(--color-text-tertiary)">${label}</span>` +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:var(--space-4) var(--space-8);color:var(--color-text-info)">Ouvrir en Détail</button>` +
      `</div>`
    );
  };

  // Fakes are selectable to DISCARD (their own tick set), never to file.
  const fakeRow = (it: QueueItem) => {
    const on = batchFakeSel.has(it.id);
    return (
      `<div class="bx-row" data-sift="batchpickfake" data-id="${it.id}" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-8);border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;letter-spacing:.03em;padding:var(--space-4) var(--space-8);border-radius:999px;background:var(--color-background-danger);color:var(--color-text-danger)">FAKE</span>' +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:var(--space-4) var(--space-8);color:var(--color-text-info)">Ouvrir en Détail</button>` +
      `</div>`
    );
  };

  // A group header row: tri-state checkbox + dot + label + count, mirroring the maquette's
  // `groupDefs` (label already reads "Prêts · lossless" / "À vérifier · fake" / "En analyse" —
  // the count is appended separately so it stays JetBrains Mono like every other counter).
  const groupHead = (
    kind: "file" | "fake" | "readonly",
    dotColor: string,
    label: string,
    ids: number[],
  ) => {
    const sel = kind === "file" ? batchSel : kind === "fake" ? batchFakeSel : null;
    const box = groupBoxHtml(kind, ids);
    const clickable = sel ? ` data-sift="batchgroup" data-kind="${kind}" style="cursor:pointer"` : "";
    const collapsed = batchCollapsed.has(kind);
    const caret =
      `<span data-sift="batchcollapse" data-kind="${kind}" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;cursor:pointer;transform:rotate(${
        collapsed ? "0deg" : "90deg"
      });transition:transform .12s"><i class="ti ti-chevron-right" style="font-size:var(--text-xs);color:var(--color-text-tertiary)"></i></span>`;
    // data-grouphead lets mutateBatchTick (Task 3a) find and refresh just this header's tri-state
    // box after a single tick, instead of re-rendering the whole batch board.
    return (
      `<div class="sift-bgrp-head" data-grouphead="${kind}"${clickable}>` +
      caret +
      box +
      `<span style="width:var(--space-4);height:var(--space-4);border-radius:999px;background:${dotColor};flex:none"></span>` +
      `<span class="col-h" style="margin:0">${esc(label)} · ${ids.length}</span>` +
      `</div>`
    );
  };

  // Render a group's rows capped at batchGroupCap[kind] (Task 3b), with a "afficher les N suivants"
  // control when there are more. Collapsed → nothing. The cap bounds DOM size on huge groups
  // ("Prêts" can be thousands) without windowing the collapsible structure.
  const cappedBody = <T extends QueueItem>(
    kind: "file" | "fake" | "readonly",
    list: T[],
    rowFn: (it: T) => string,
  ): string => {
    if (batchCollapsed.has(kind)) return "";
    const cap = batchGroupCap[kind];
    const shown = list.slice(0, cap);
    let html = shown.map(rowFn).join("");
    const remaining = list.length - shown.length;
    if (remaining > 0) {
      const next = Math.min(remaining, BATCH_GROUP_PAGE);
      html +=
        `<button data-sift="batchmore" data-kind="${kind}" style="width:100%;margin-top:var(--space-4);padding:var(--space-8);font-size:var(--text-sm);color:var(--color-text-info);cursor:pointer;background:transparent;border:none;text-align:center">Afficher les ${next} suivants (${remaining} restants)</button>`;
    }
    return html;
  };

  // No center action bar: the destination + adaptive File/Discard/Stop button now live solely in the
  // right rail (renderBatchRail), mirroring the Detail screen's CTA-in-the-rail grammar.
  mid.innerHTML =
    `<div style="display:flex;flex-direction:column;height:100%;min-height:0">` +
    `<div style="flex:1;min-height:0;overflow-y:auto;padding-right:2px">` +
    (ready.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("file", "var(--color-text-success)", "Prêts · lossless", ready.map((it) => it.id)) +
        cappedBody("file", ready, readyRow) +
        `</div>`
      : '<div class="col-h" style="margin:0 0 6px">Prêts · lossless · 0</div><div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:4px 9px 14px">Rien à convertir pour l’instant.</div>') +
    (fakes.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("fake", "var(--color-text-warning)", "À vérifier · fake", fakes.map((it) => it.id)) +
        cappedBody("fake", fakes, fakeRow) +
        `</div>`
      : "") +
    (pending.length
      ? `<div style="margin:2px 0 16px">` +
        groupHead("readonly", "var(--color-text-tertiary)", "En analyse", pending.map((it) => it.id)) +
        cappedBody("readonly", pending, pendingRow) +
        `</div>`
      : "") +
    `</div></div>`;

  renderBatchRail(fakes.length + pending.length);
}


/** The destination actually passed to the filer (FILE_IN_PLACE sentinel, or the picked folder rel). */
function batchDest(): string {
  return batchInPlace ? FILE_IN_PLACE : batchBin;
}
/** Human label for the batch destination — shown in the rail récap + name preview. */
function batchDestLabel(): string {
  if (batchInPlace) return IN_PLACE_LABEL;
  if (batchBin.startsWith(EXTERNAL_DEST_PREFIX)) {
    const abs = batchBin.slice(EXTERNAL_DEST_PREFIX.length);
    return abs.split(/[\\/]/).filter(Boolean).pop() || abs;
  }
  return batchBin || "Racine de bibliothèque";
}
/** A folder click in the #fldz tree (batch pick mode) -> set batchBin, drop in-place, re-render. */
export function onBatchBinPick(rel: string): void {
  batchBin = rel;
  batchInPlace = false; // choosing a folder turns off "file in place"
  const fldz = document.getElementById("fldz");
  if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
}
/** Ensure the batch destination UI around #fldz: the tree is in batch pick mode. The "file in
 *  place" checkbox itself now renders as part of renderBins's own output (filing.ts) — same
 *  markup/attribute for both modes — so there's nothing left to create here, only the inert
 *  (greyed) state to keep in sync on every rail rebuild. */
function ensureBatchDestUI(): void {
  const fldz = document.getElementById("fldz");
  if (!fldz) return;
  // In-place GREYS the tree (visible but inert) — never hides it; the tree only picks a real folder.
  // ensureBatchDestUI runs on EVERY renderBatchRail (incl. run start and the post-run refresh), so
  // syncing binPick.inert here makes it the single source of truth: a later renderBins (queue refresh
  // during/after a run) re-asserts the SAME state via its own .sift-fldz-tree opacity logic.
  setBinPickInert(batchInPlace);
  fldz.style.display = ""; // belt-and-suspenders: a greyed tree must stay laid out, not collapse
  const treeWrap = fldz.querySelector<HTMLElement>(".sift-fldz-tree");
  if (treeWrap) {
    treeWrap.style.opacity = batchInPlace ? ".4" : "1";
    treeWrap.style.pointerEvents = batchInPlace ? "none" : "auto";
  }
}

/** The single rail action button. Adaptive before a run (Convertir / Discarder / both / disabled),
 *  "Stop" during one. `running` swaps to the Stop affordance (wired to onFileStop).
 *  Verb was "Ranger" (not "Filer") to match the Détail rail's verb — one action, one name (audit
 *  UI/UX 2026-07-03, fix 2). Changed to "Convertir" (2026-07-10, retour utilisateur: more explicit
 *  about what the button does) — the Détail-rail/batch-rail pair still shares one verb, see
 *  filing.ts's refreshRangerButton (internal name kept, only the displayed word changed). */
function actionButtonHtml(running: boolean): string {
  if (running) {
    return '<button data-sift="batchstop" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Stop</button>';
  }
  const fileN = batchSel.size;
  const fakeN = batchFakeSel.size;
  if (fileN === 0 && fakeN === 0)
    return '<button class="sift-baction" disabled style="background:var(--color-background-info);color:var(--color-text-info);opacity:.5;pointer-events:none">Convertir (0)</button>';
  // Second-click confirm for large batches (see BATCH_CONFIRM_THRESHOLD) — armed only for the
  // exact selection it was requested for, so ticking/unticking a track after arming falls back
  // to asking again instead of silently confirming a changed selection. The button looks like a
  // plain Convertir button until the first click arms it (the click handler re-renders this as the
  // danger "Confirmer" state below) — a distinct button for the actual destructive click, not a
  // permanent scary button sitting there before the user has done anything.
  const armed =
    !!batchConfirmArmed && batchConfirmArmed.fileN === fileN && batchConfirmArmed.fakeN === fakeN;
  if (armed) {
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Confirmer — convertir ${fileN} ?</button>`;
  }
  if (fakeN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Convertir (${fileN})</button>`;
  if (fileN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Écarter (${fakeN})</button>`;
  return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Convertir (${fileN}) · Écarter (${fakeN})</button>`;
}

/** Positions the batch Format thumb from whichever button currently carries `.on`. Called both
 * right after a full rebuild (fresh node — just places it) and, deferred by a frame, right after a
 * format click (see the "batchformat" handler) so the move is what actually animates. */
function positionBatchFmtThumb(): void {
  const seg = document.getElementById("sift-batch-fmt-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-sift='batchformat'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Right-rail summary for batch mode (board's SELECTION / DESTINATION / WILL ENCODE / EXCLUDED).
 * Replaces the filing footer + hides the folder tree while batching. */
function renderBatchRail(reviewN: number) {
  const foot = requireEl("#filfoot", "renderBatchRail");
  requireEl("#fldz", "renderBatchRail"); // fail-fast: asserts the popover host exists
  ensureBatchDestUI();
  // Preserve the LIVE run's progress list across this wholesale rebuild (renderBatch rebuilds the rail
  // on every selection change). Not while idle — the choice-time preview is rebuilt fresh below.
  const keepTracks = batchRunning ? foot.querySelector("#sift-batch-tracks") : null;
  const keepNote = foot.querySelector("[data-file-note]");
  // The progress zone may live in THIS rail from a prior render; park it back in its nav home before the
  // innerHTML wipe (which would destroy the node + its live rowCache), then re-mount into the fresh slot.
  if (foot.querySelector("#sift-progress-zone")) homeProgressZone();
  // Destination button in BOTH modes: a real folder (tree mode) or the in-place RULE label
  // ("Dossier source de chaque morceau") — batchDestLabel() resolves which. In-place states the rule
  // once here instead of listing each track's folder. Clickable — opens the #fldz popover (batch's
  // own rail doesn't go through filing.ts's renderFoot, so it wires the same toggle itself).
  const destBlock = `<button data-fil="destbtn" class="sift-dest-btn"><span class="sift-dest-btn-label">Destination</span><span class="sift-fil-bin">${esc(
    batchDestLabel(),
  )}</span><i class="ti ti-chevron-down sift-dest-btn-caret"></i></button>`;
  // "Excluded" is folded into Selection as a discreet (tertiary) suffix — no separate block.
  const jeter = batchFakeSel.size ? ` · ${batchFakeSel.size} à jeter` : "";
  const exclus = reviewN
    ? ` · <span style="color:var(--color-text-tertiary)">${reviewN} exclus (en review)</span>`
    : "";
  // Single global format selector (maquette `formats`) — applies to the whole file-able selection,
  // no per-source-rail split (décision "maquette prime" du 2026-07-01, docs/superpowers/plans/2026-07-02-refonte-ui-plan.md).
  // Same chip markup as the Détail rail (filing.ts renderFoot) — clickable affordance (hover +
  // "on" state) instead of a bespoke pill track, per audit 2026-07-05 (annotation: "pas clair
  // que les boutons sont clickables").
  // Audit-ref (Bibliothèque/rail batch, 2026-07-09) : <span> → <button> (cohérence), thumb glissant
  // ajouté. Contrairement à Journal/Bibliothèque, renderBatchRail() n'est PAS async — le clic
  // rebuild tout de suite dans le même tick, donc "toggle en place puis laisser l'async peindre"
  // ne marche pas ici. La rebuild est différée d'une frame (requestAnimationFrame, voir le handler
  // "batchformat" plus bas) pour laisser le navigateur peindre le toggle avant que le DOM soit
  // remplacé — seul site qui a besoin de ce délai explicite.
  const formatBlock =
    `<div class="sift-rail-fmt-group"><span class="col-h">Format</span><div class="sift-seg sift-seg-thumbed" id="sift-batch-fmt-seg">` +
    `<div class="sift-seg-thumb"></div>` +
    (["mp3_320", "aiff_16_44", "wav_16_44"] as Target[])
      .map(
        (t) =>
          `<button class="sift-seg-opt${batchFormat === t ? " on" : ""}" data-sift="batchformat" data-t="${t}">${TARGET_LABEL[t]}</button>`,
      )
      .join("") +
    `</div></div>`;
  // Rail order (one row, matching the Detail rail): Destination → Format → spacer → Selection
  // count → action, all on the first line — then progress/tracks (each flex-basis:100%, empty/
  // invisible while idle) wrap below since they come AFTER the action button in DOM order
  // (audit 2026-07-05, annotation: "même style et logique que dans détail, tout sur une ligne").
  // "Final name" motif dropped — redundant with Selection + the per-track list once a run
  // starts (see batchNameMotifHtml removal, Task 3).
  foot.innerHTML =
    destBlock +
    formatBlock +
    `<div class="sift-rail-spacer"></div>` +
    `<span id="sift-batch-selcount" style="font-size:var(--text-sm);color:var(--color-text-secondary);white-space:nowrap">${
      batchSel.size
    } à convertir${jeter}${exclus}</span>` +
    `<div class="sift-baction-slot">${actionButtonHtml(batchRunning)}</div>` +
    `<div id="sift-batch-progress" style="flex-basis:100%"></div>` +
    `<div id="sift-batch-tracks" style="flex-basis:100%"></div>`;
  if (keepNote) foot.insertAdjacentElement("afterbegin", keepNote);
  if (keepTracks) foot.querySelector("#sift-batch-tracks")!.replaceWith(keepTracks);
  else refreshBatchTracksPreview(); // idle → keep the per-track list empty (it is a run-only artifact)
  foot.querySelector('[data-fil="destbtn"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDestPopover();
  });
  ensureDestPopoverAutoClose();
  // Move the single progress zone into the rail (batch). setTask/clearTask keep driving the same node,
  // so Filing X/N + Analysing render here with no duplicated logic. Detail restores it via setReviewMode.
  mountProgressZone(requireEl("#sift-batch-progress", "renderBatchRail progress slot"));
  repositionDestPopoverIfOpen(); // the destbtn above was just rebuilt — keep an open popover glued to it
  positionBatchFmtThumb(); // fresh node post-rebuild — no prior transform, just place it
}

/** Launch background filing of every ticked (green) track into the chosen bin, then return — the
 * work runs off the main thread, so the UI stays responsive and analysis can keep running. A
 * spinner note is shown; the per-run summary AND the view refresh arrive later via the `file:done`
 * event (see `onFileBatchDone`). Filed tracks leave the queue, so the refresh prunes them from the
 * ticked set automatically. */
async function runBatchFile() {
  const ids = [...batchSel];
  if (ids.length === 0) return;
  fileStopping = false;
  lastFileProgress = null;
  // Flip the rail button to Stop and (re)build the rail so the progress slot exists before mounting.
  batchRunning = true;
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
  // Mount the per-track list (ordered like the submitted ids) before launching — the first row
  // shows "running" immediately; file:progress/file:done drive the rest. No backend event needed.
  batchTrackIds = ids;
  startBatchTracklist(ensureBatchTracklistHost(), ids.map(batchTrackItem));
  fileNote(
    '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md);vertical-align:-1px"></i> Conversion en arrière-plan…',
  );
  // FIX-7: show 0/N in the global progress zone immediately at the click, same instant signal the
  // per-track tracklist above already gets — don't wait for the first file:progress event.
  setTask("file", { done: 0, total: ids.length, state: "running" });
  // Single format applied to every submitted id (maquette's one segmented control for the batch).
  const targets: Record<number, Target> = {};
  for (const id of ids) targets[id] = batchFormat;
  try {
    // Resolves as soon as the background task STARTS; the summary comes via file:done.
    await fileBatch(ids, batchDest(), targets);
  } catch (err) {
    // Launch-time rejections only (NoLibraryRoot, or the task couldn't start).
    const code = String(err);
    fileNote(
      code.includes("NoLibraryRoot")
        ? "Aucune racine de bibliothèque configurée — à définir dans Réglages."
        : `Échec du lancement de la conversion : ${esc(code)}`,
      "var(--color-text-danger)",
    );
    console.error("file_batch launch failed", err);
  }
}

/** Display name for a batch row: the queue item's artist — title, else its filename/path. */
function batchTrackName(id: number): string {
  const it = currentItems.find((q) => q.id === id);
  if (!it) return `#${id}`;
  return [it.artist, it.title].filter(Boolean).join(" — ") || it.filename || it.path;
}

/** A per-track list item (id + display name). In-place mode no longer attaches a source-folder
 *  suffix: the récap states the RULE once ("Dossier source de chaque morceau"), so the per-track
 *  list stays identical to normal mode (name + status pill, no per-file path inventory). */
function batchTrackItem(id: number): { id: number; name: string } {
  return { id, name: batchTrackName(id) };
}

/** At choice time the per-track list is NOT shown in either mode: dumping the (up to ~1752) selected
 *  filenames row-by-row only duplicates the "N à filer" count and the "Final name" motif, drowning the
 *  récap. The list is a RUN artifact — startBatchTracklist mounts it live when filing begins. So here we
 *  just keep #sift-batch-tracks empty. No-op during a run (the live list owns the container). */
function refreshBatchTracksPreview(): void {
  if (reviewMode !== "batch" || batchRunning) return;
  const host = document.getElementById("sift-batch-tracks");
  if (!host) return;
  host.innerHTML = "";
}

/** Stable container for the per-track list, mounted in the right rail (#filfoot) under the batch
 *  récap and above the action button, so all batch progress lives next to the controls that drive it. */
function ensureBatchTracklistHost(): HTMLElement {
  let el = document.getElementById("sift-batch-tracks");
  if (!el) {
    // The rail slot (renderBatchRail's #sift-batch-tracks div) isn't mounted yet — create a detached
    // node and append it to the rail; renderBatchRail preserves it (keepTracks) on its next rebuild.
    el = document.createElement("div");
    el.id = "sift-batch-tracks";
    document.getElementById("filfoot")?.appendChild(el);
  }
  return el;
}

/** Insert/replace a transient note at the top of the batch rail (#filfoot), if it is on screen. */
function fileNote(html: string, color = "var(--color-text-secondary)") {
  const foot = document.getElementById("filfoot");
  if (!foot) return;
  foot.querySelector("[data-file-note]")?.remove();
  foot.insertAdjacentHTML(
    "afterbegin",
    `<div data-file-note style="font-size:var(--text-sm);color:${color};margin-bottom:10px">${html}</div>`,
  );
}

let refreshHook: (() => Promise<void>) | null = null;

/** Registers sift-live.ts's refresh() (renderHomeSources + renderQueue + updateRevueBadge) so
 *  onFileBatchDone/runBatchDiscard can trigger a full view refresh after filing without a static
 *  import back to sift-live.ts (mirrors registerBatchRenderer in queue-panel.ts, opposite
 *  direction: this module calls OUT to the orchestrator instead of being called INTO). */
export function registerRefreshHook(fn: () => Promise<void>): void {
  refreshHook = fn;
}

/** End-of-(background-)filing handler, fired by the `file:done` event. Refreshes the view (as the
 * end-of-batch queue:changed used to) then shows the run summary — but only if the batch rail is
 * still on screen, since the user may have navigated away while the batch ran. */
export async function onFileBatchDone(res: BatchResult) {
  fileStopping = false;
  batchRunning = false; // the later refresh() repaints the rail button back to its adaptive state
  // Final per-track reconcile: filed ids = done, needs_validation ids = failed. A cancelled run only
  // processed the first `lastFileProgress.done` ids; the rest never started (left at waiting).
  const processed = res.cancelled ? batchTrackIds.slice(0, lastFileProgress?.done ?? 0) : batchTrackIds;
  const failed = new Set(res.needs_validation);
  finishBatchTracklist(processed.filter((id) => !failed.has(id)), res.needs_validation);
  if (res.cancelled) {
    // Stop-net end: no 100% done-flash came from progress (done<total). Flash the partial then hide.
    clearTimeout(fileClearTimer);
    const lp = lastFileProgress;
    if (lp) {
      setTask("file", { done: lp.done, total: lp.total, state: "done" });
      fileClearTimer = setTimeout(() => {
        clearTask("file");
        clearBatchTracklist();
        refreshBatchTracksPreview();
      }, 1200);
    } else {
      clearTask("file");
      clearBatchTracklist();
      refreshBatchTracksPreview();
    }
  }
  const base = res.needs_validation.length
    ? `${res.filed} filed · ${res.needs_validation.length} need validation`
    : `${res.filed} filed`;
  // Refresh the view, then post the run summary at #filfoot — after refresh so it survives
  // renderBatch's wholesale rail rebuild (renderBatchRail sets #filfoot.innerHTML). refresh() no
  // longer throws on an unmounted view (each renderer no-ops when its root is absent), so the
  // earlier try/finally guard around it is no longer needed.
  await refreshHook?.();
  fileNote(
    `<i class="ti ti-check" style="font-size:var(--text-md);vertical-align:-1px"></i> ${
      res.cancelled ? `Filing cancelled · ${base}` : base
    }`,
    "var(--color-text-success)",
  );
}

/** Send every ticked track to Écartés for re-sourcing (backend emits queue:changed → redraw). */
async function runBatchDiscard() {
  const ids = [...batchFakeSel];
  if (ids.length === 0) return;
  batchRunning = true;
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
  try {
    await rejectBatch(ids);
    batchFakeSel.clear();
  } catch (err) {
    console.error("reject_batch failed", err);
    fileNote("Échec de l'écartement — réessaie", "var(--color-text-danger)");
  } finally {
    batchRunning = false;
    await refreshHook?.();
  }
}

/** Routes the batch mode's delegated clicks (selection, group toggles, format, confirm-to-file,
 *  stop) — the batchpick/batchgroup/batchcollapse/batchpickfake/batchmore/batchformat/batchopen/
 *  batchaction/batchstop data-sift actions. Extracted from sift-live.ts's installLiveWiring click
 *  handler (Phase 1, tranche 1c) — same split as handleRekordboxAction (1a) and the queue click
 *  handler (1b). Returns true if it handled `act`, false otherwise. */
export function handleBatchAction(el: HTMLElement, act: string, e: MouseEvent): boolean {
  if (act === "batchpick") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (batchSel.has(id)) batchSel.delete(id);
    else batchSel.add(id);
    // Targeted mutation of the clicked row + its group header + rail counts (Task 3a) — NOT a full
    // renderBatch (which rebuilt every group on each tick, the audit's worst UI hotspot). `el` is
    // the .bx-row (it carries data-sift="batchpick").
    mutateBatchTick("file", id, el);
  } else if (act === "batchgroup") {
    // Group-header tri-state toggle (maquette `onToggleAll`) — "file" selects/clears every
    // ready row, "fake" every fake row. Empty/partial → select all; full → clear.
    e.stopPropagation();
    const kind = el.dataset.kind === "fake" ? "fake" : "file";
    const ids =
      kind === "fake"
        ? currentItems.filter((it) => it.verdict === "fake").map((it) => it.id)
        : currentItems.filter((it) => it.verdict === "ok").map((it) => it.id);
    const sel = kind === "fake" ? batchFakeSel : batchSel;
    const full = ids.length > 0 && ids.every((id) => sel.has(id));
    for (const id of ids) if (full) sel.delete(id);
      else sel.add(id);
    renderBatch();
  } else if (act === "batchcollapse") {
    // Group-header caret — toggles that group's row list, independent from the tri-state
    // select-all box (its own data-sift, resolved by closest() before the parent's).
    e.stopPropagation();
    const kind = el.dataset.kind === "fake" ? "fake" : el.dataset.kind === "readonly" ? "readonly" : "file";
    if (batchCollapsed.has(kind)) batchCollapsed.delete(kind);
    else batchCollapsed.add(kind);
    renderBatch();
  } else if (act === "batchpickfake") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (batchFakeSel.has(id)) batchFakeSel.delete(id);
    else batchFakeSel.add(id);
    // Same targeted mutation as batchpick, on the fake-discard set (Task 3a).
    mutateBatchTick("fake", id, el);
  } else if (act === "batchmore") {
    // Progressive disclosure (Task 3b): bump this group's render cap by one page, re-render. A
    // structural change (more rows mounted) → full renderBatch is correct here, not a tick.
    e.stopPropagation();
    const kind =
      el.dataset.kind === "fake" ? "fake" : el.dataset.kind === "readonly" ? "readonly" : "file";
    batchGroupCap[kind] += BATCH_GROUP_PAGE;
    renderBatch();
  } else if (act === "batchformat") {
    e.stopPropagation();
    batchFormat = el.dataset.t as Target;
    // Toggle + reposition in place first, then let a frame paint before renderBatchRail()
    // rebuilds the whole rail synchronously (not async like Journal/Bibliothèque — nothing to
    // await here — so without this rAF the toggle and the rebuild land in the same tick and
    // there is nothing to animate FROM).
    document
      .querySelectorAll<HTMLElement>("#sift-batch-fmt-seg [data-sift='batchformat']")
      .forEach((b) => b.classList.toggle("on", b.dataset.t === batchFormat));
    positionBatchFmtThumb();
    requestAnimationFrame(() => {
      renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
    });
  } else if (act === "batchopen") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const item = currentItems.find((it) => it.id === id);
    enterDetailMode();
    const mid = requireEl("#mid", "batchopen");
    if (item && mid) {
      void openFilingInto(mid, item);
      prefetchNextAfter(item.id);
    }
  } else if (act === "batchaction") {
    e.stopPropagation();
    const fileN = batchSel.size;
    const fakeN = batchFakeSel.size;
    const armed =
      !!batchConfirmArmed &&
      batchConfirmArmed.fileN === fileN &&
      batchConfirmArmed.fakeN === fakeN;
    if (fileN > BATCH_CONFIRM_THRESHOLD && !(armed && Date.now() - batchConfirmArmed!.at >= 400)) {
      // Arm (or re-arm): re-render as the danger "Confirmer" button, don't file yet. The 400ms
      // floor on the confirming click rejects an accidental doubleclick/duplicate-event landing
      // on the same spot right after arming — the exact failure mode that filed ~265 real
      // tracks during this fix's own verification (audit UI/UX 2026-07-03, fix 3 incident).
      // Auto-disarms after 5s of no second click.
      clearTimeout(batchConfirmTimer);
      batchConfirmArmed = { fileN, fakeN, at: Date.now() };
      batchConfirmTimer = setTimeout(() => {
        batchConfirmArmed = null;
        renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
      }, 5000);
      renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
      return true;
    }
    clearTimeout(batchConfirmTimer);
    batchConfirmArmed = null;
    // Adaptive dispatch. Combined (both ticked): file runs with its progress UI (Stop follows it);
    // discard fires in parallel as a fast fire-and-forget — IDs captured before clear.
    if (batchSel.size && batchFakeSel.size) {
      const discardIds = [...batchFakeSel];
      batchFakeSel.clear();
      void runBatchFile();
      void rejectBatch(discardIds).catch((err: unknown) => {
        console.error("reject_batch (combined) failed", err);
        for (const id of discardIds) batchFakeSel.add(id);
        fileNote("Échec de l'écartement — réessaie", "var(--color-text-danger)");
      });
    } else if (batchSel.size) {
      void runBatchFile();
    } else if (batchFakeSel.size) {
      void runBatchDiscard();
    }
  } else if (act === "batchstop") {
    e.stopPropagation();
    onFileStop();
  } else {
    return false;
  }
  return true;
}

/** Handles the "file in place" checkbox change (batch mode's #fldz destination toggle) — extracted
 *  from installLiveWiring's dedicated change listener (Phase 1, tranche 1c) so batchInPlace stays
 *  mutated only inside this module. */
export function onBatchInPlaceChange(checked: boolean): void {
  batchInPlace = checked;
  const fldz = document.getElementById("fldz");
  if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
}
