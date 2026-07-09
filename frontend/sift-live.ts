// Live data wiring — ACTIVE ONLY inside the Tauri app. In a plain browser the hooks
// below are never installed, so app.js keeps its mockup (Vercel demo unaffected).
import {
  removeSource,
  listQueue,
  fileBatch,
  fileCancel,
  onFileDone,
  onFileProgress,
  rejectBatch,
  onQueueChanged,
  onAnalysisChanged,
  analysisProgress,
  setSourceWatched,
  setSourceColor,
  trashTrack,
  restoreTrack,
  requeueTrack,
  purgeTrash,
  openUrl,
  getSetting,
  setSetting,
  listLibrary,
  libraryFolders,
  scanLibraryDuplicates,
  libraryStats,
  exportRekordboxXml,
  rekordboxStatus,
  linkRekordboxXml,
  listRemovableDrives,
  rekordboxMasterdbPendingRepairs,
  rekordboxMasterdbApplyRepairs,
  rekordboxMasterdbDismissRepair,
  rekordboxMasterdbResolveAmbiguous,
  rekordboxMasterdbScanPlaylistDuplicates,
  rekordboxMasterdbDedupPlaylistGroup,
  rekordboxMasterdbPendingMetadataSyncs,
  rekordboxMasterdbApplyMetadataSyncs,
  rekordboxMasterdbDismissMetadataSync,
  rekordboxMasterdbResolveAmbiguousMetadataSync,
} from "./ipc";
import type {
  LibraryTrack,
  LibraryFacets,
  LibraryFilter,
  DupGroup,
  DashboardStats,
  RekordboxLinkStatus,
  PendingMasterdbRepair,
  CandidateTrack,
  PlaylistDuplicateGroupDto,
  PendingMetadataSync,
  ApplyMetadataSyncOutcome,
} from "../shared/contracts";
import type { RemovableDrive } from "./ipc";
import { openLibraryDetailInto } from "./library-detail";
import { openUsbFormatModal } from "./usb-format-modal";
import { emptyStateHtml, wireEmptyState } from "./empty-state";
import {
  openFilingInto,
  refreshBins,
  syncDetail,
  installUndoShortcut,
  installFilingKeys,
  renderBinsForBatch,
  refreshBinsForBatch,
  ensureDestPopoverAutoClose,
  clearBinPick,
  setBinPickInert,
  targetExt,
  TARGET_LABEL,
  toggleDestPopover,
  repositionDestPopoverIfOpen,
} from "./filing";
import { confirmAction } from "./confirm-modal";
// Views/chrome extracted from this god-module (audit P-3) — kept stateless, wired here.
import { renderEcartes } from "./ecartes-view";
import { renderHomeSources, pickAndAddFolder } from "./home-sources";
import { installDragDrop, injectLeanStyle, injectTitlebar, installScrollAutohide, installNavKeyboard } from "./chrome";
import { initTheme, setTheme } from "./theme";
import type { ThemeChoice } from "./theme";
import type { QueueItem, BatchResult, FileProgress, Target } from "../shared/contracts";
import { FILE_IN_PLACE, EXTERNAL_DEST_PREFIX } from "../shared/contracts";
import { requireEl } from "./dom";
import { createVirtualList, type VirtualList } from "./list-virtual";
import {
  fmtDur,
  qualPill,
  verdictBadge,
  bibName,
  sortTracks,
  libraryTableHeaderHtml,
  libraryTableRowHtml,
  libraryGridRowHtml,
  LIBRARY_GRID_TILES_PER_ROW,
  LIBRARY_TABLE_PROBE_HTML,
  LIBRARY_GRID_PROBE_HTML,
  type LibrarySortState,
} from "./library-views";
import { renderJournal } from "./journal";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";

/** Human label for the batch destination (resolves the in-place sentinel to its prose). */
const IN_PLACE_LABEL = "Dossier source de chaque morceau";
import {
  setTask,
  clearTask,
  setCancelHandler,
  mountProgressZone,
  homeProgressZone,
} from "./progress-zone";
import {
  startBatchTracklist,
  updateBatchTracklist,
  finishBatchTracklist,
  clearBatchTracklist,
} from "./batch-tracklist";

// Latest live queue items, kept so a queue-row click can recover the full item (id +
// verdict) the filing pane needs.
let currentItems: QueueItem[] = [];

// Single source of truth for which queue row shows `.cur` — NOT read from filing.ts's internal
// state (would risk a race: filing.ts may set its own state before this module's DOM catches up).
// Updated in 3 places: the row click handler, renderQueue's touchDetail branch (via syncDetail's
// return value), and stepQueueSelection (Task 4).
let currentOpenId: number | null = null;

const QUEUE_ROW_BUFFER = 15; // rows rendered above/below the visible window

// M8 Tier 1 repairs section state — module-level like batchSel (sift-live.ts:271), NOT reset on
// every render. Filtered against the live pending/ambiguous rows each render so a stale id (one
// that got applied/dismissed elsewhere) drops out without touching the rest of the selection.
const mdbRepairSel = new Set<number>();
// Per-row apply failure message, transient (never persisted) — cleared when the row is
// reselected or the next apply_repairs batch touches it again.
const mdbErrorById = new Map<number, string>();
// M8 Tier 2 playlist-dedup section state — stateless on the backend (no server-side id,
// see the IPC wiring plan's Architecture note), so the frontend keeps the last scan result
// itself and references entries by array index from the DOM. Re-populated on every
// renderRekordboxLive() call, same lifecycle as masterdbSection's own data.
let lastScannedDuplicateGroups: PlaylistDuplicateGroupDto[] = [];
// Per-group dedup failure message, keyed by "playlistId::contentId" (no numeric id exists
// for a duplicate group) — same transient, never-persisted contract as mdbErrorById.
const mdbDedupErrorByKey = new Map<string, string>();
// M8 Tier 3 metadata-syncs section state — same module-level, filtered-not-reset discipline as
// mdbRepairSel (sift-live.ts:114).
const mdsSyncSel = new Set<number>();
const mdsErrorById = new Map<number, string>();
let queueRowHeightCache: number | null = null;

// Live filter on the queue rail (annotation: "on veut une barre de recherche en bas — filtre
// client sur la file affichée uniquement, titre/artiste, pas de recherche backend"). Filters
// currentItems only — never touches listQueue()/the DB. currentOpenId/stepQueueSelection walk
// this filtered view too, so arrow-key nav only steps through what's actually visible.
let queueSearchTerm = "";

// "+N traités" / "Masquer les traités" toggle (2026-07-08: existed in the frozen app.js mockup —
// var doneCount=T.length-pendingCount — but was never ported to the real live queue; ensured by
// this grep at the time: no togglequeue/queueShowAll consumer anywhere in sift-live.ts). A track
// is "traité" once its analysis verdict resolves (QueueItem.verdict !== null) — not once it's
// filed (filed tracks leave listQueue() results entirely, they're not what this hides). Default
// hidden, matching the mockup's default state.
let queueShowAll = false;

function visibleQueueItems(): QueueItem[] {
  // Search deliberately searches ALL items regardless of the traités toggle — limiting search
  // results to whatever's currently shown would silently return 0 hits for a treated track while
  // traités are hidden, which reads as a bug ("I searched but it's not there") rather than the
  // filter doing its job.
  const base = queueSearchTerm ? currentItems : queueShowAll ? currentItems : currentItems.filter((it) => it.verdict === null);
  if (!queueSearchTerm) return base;
  const q = queueSearchTerm.toLowerCase();
  return base.filter(
    (it) =>
      (it.filename ?? it.path).toLowerCase().includes(q) ||
      (it.artist ?? "").toLowerCase().includes(q) ||
      (it.title ?? "").toLowerCase().includes(q),
  );
}

/** Real rendered height of a queue row, measured once via an offscreen probe (never assumed —
 * same discipline as the spectrogram canvas width / destination-popover positioning elsewhere in
 * this codebase). Cached: the row markup/CSS don't change at runtime. */
function measureQueueRowHeight(ql: HTMLElement): number {
  if (queueRowHeightCache != null) return queueRowHeightCache;
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.cssText += ";display:flex;align-items:center;gap:8px;padding:5px 7px;width:100%";
  probe.innerHTML =
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
    `<div style="display:flex;align-items:center;gap:6px;min-width:0"><span style="flex:1">probe</span></div>` +
    `<div style="padding-left:15px;font-size:var(--text-xs)">&nbsp;</div></div>`;
  ql.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  queueRowHeightCache = h > 0 ? h : 34; // 34px fallback: never divide by zero if measured off-DOM
  return queueRowHeightCache;
}

/** Renders only the rows within the visible scroll window (+ QUEUE_ROW_BUFFER above/below) into
 * `ql`, framed by two spacer divs so the scrollbar stays proportional to the full list. Fixes the
 * 7000+-track freeze (memory: sift-large-queue-black-screen) — rebuilding thousands of DOM nodes
 * on every 300ms analysis-progress redraw (see the onAnalysisChanged listener further down) was
 * the actual cost, not just paint. */
function renderQueueWindow(ql: HTMLElement): void {
  const items = visibleQueueItems();
  if (!items.length) {
    ql.innerHTML =
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">${
        currentItems.length && queueSearchTerm ? "Aucun morceau ne correspond." : "File vide."
      }</div>`;
    return;
  }
  const rowH = measureQueueRowHeight(ql);
  const viewportH = ql.clientHeight || 400;
  const start = Math.max(0, Math.floor(ql.scrollTop / rowH) - QUEUE_ROW_BUFFER);
  const visibleCount = Math.ceil(viewportH / rowH) + QUEUE_ROW_BUFFER * 2;
  const end = Math.min(items.length, start + visibleCount);
  // Batch mode never shows a "current" row in the queue rail — matches pre-virtualization
  // behavior exactly (a row click always drops back to detail mode first, so a highlighted row
  // while actually IN batch mode never happened before either).
  const highlightId = reviewMode === "batch" ? null : currentOpenId;
  const topSpacer = start * rowH;
  const bottomSpacer = (items.length - end) * rowH;
  let html = topSpacer > 0 ? `<div style="height:${topSpacer}px"></div>` : "";
  for (let i = start; i < end; i++) html += queueRowHtml(items[i], items[i].id === highlightId);
  if (bottomSpacer > 0) html += `<div style="height:${bottomSpacer}px"></div>`;
  ql.innerHTML = html;
}

let queueScrollWired = false;
/** One-time (guarded) scroll listener on #ql, rAF-throttled: re-renders the visible window on
 * scroll without doing so on every fired scroll event (which can be dozens per second). */
function ensureQueueScroll(ql: HTMLElement): void {
  if (queueScrollWired) return;
  queueScrollWired = true;
  let ticking = false;
  ql.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      renderQueueWindow(ql);
    });
  });
}

let queueStepTimer: ReturnType<typeof setTimeout> | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;

/** Warm the track FOLLOWING the one just opened (analysis report + AIFF pre-transcode via
 *  report-view's prefetchTrack) so the next switch paints instantly. Fires once per
 *  user-initiated open (click / arrow step / batchopen), never from a burst event; the 400ms
 *  delay + debounce keeps it out of the open's own critical path when flicking through rows. */
function prefetchNextAfter(id: number): void {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    const idx = currentItems.findIndex((t) => t.id === id);
    const next = idx >= 0 ? currentItems[idx + 1] : undefined;
    if (next) void import("./report-view").then((m) => m.prefetchTrack(next.path));
  }, 400);
}

/** ArrowUp/ArrowDown queue navigation. Kept separate from filing.ts's installFilingKeys (Space/
 * Enter/Backspace/I) because stepping through a virtualized queue needs currentItems + the
 * ability to scroll a not-yet-rendered row into view — both owned here, not in filing.ts (which
 * would need a circular import to reach them; sift-live.ts already imports from filing.ts, not
 * the reverse). */
export function stepQueueSelection(delta: 1 | -1): void {
  const items = visibleQueueItems();
  if (!items.length) return;
  const curIndex = currentOpenId != null ? items.findIndex((it) => it.id === currentOpenId) : -1;
  const nextIndex = curIndex + delta;
  if (nextIndex < 0 || nextIndex >= items.length) return;
  const next = items[nextIndex];
  currentOpenId = next.id;
  const ql = document.getElementById("ql");
  if (ql) {
    const rowH = measureQueueRowHeight(ql);
    // Keep the target row inside the rendered window: scroll just enough that nextIndex sits
    // within view, never a full jump-to-top/bottom for a one-row step.
    const rowTop = nextIndex * rowH;
    const rowBottom = rowTop + rowH;
    if (rowTop < ql.scrollTop) ql.scrollTop = rowTop;
    else if (rowBottom > ql.scrollTop + ql.clientHeight) ql.scrollTop = rowBottom - ql.clientHeight;
    renderQueueWindow(ql);
  }
  // Debounced like the row-click handler in installLiveWiring — arrow-key repeat shouldn't fire a
  // full decode load per row flicked through.
  //
  // setReviewMode("detail") and openFilingInto(mid, next) MUST fire together, in that order, from
  // this single deferred callback rather than one synchronously here and the other 150ms later.
  // setReviewMode("detail") synchronously calls renderQueue(true), which awaits listQueue() before
  // calling syncDetail on a later tick; syncDetail's guard is `state.track && paneIsOurs` (both set
  // synchronously at the top of openFilingInto, before its own first await). If setReviewMode ran
  // immediately while openFilingInto(mid, next) was still 150ms away, that later syncDetail tick
  // would see state.track/paneIsOurs stale (still pointing at whatever was open before, or null),
  // fall through to "load the first pending track", and clobber currentOpenId back to items[0] —
  // disagreeing with the `next` this function just highlighted. Firing both from the same callback
  // means by the time renderQueue's later tick runs, openFilingInto has already set state.track to
  // `next` synchronously, so syncDetail's guard sees the correct track and returns its id.
  clearTimeout(queueStepTimer);
  queueStepTimer = setTimeout(() => {
    if (reviewMode === "batch") setReviewMode("detail");
    const mid = document.getElementById("mid");
    if (mid) {
      void openFilingInto(mid, next);
      prefetchNextAfter(next.id);
    }
  }, 150);
}

/** Guarded so installLiveWiring can call this once even if it ever re-runs. */
let queueNavKeysWired = false;
function installQueueNavKeys(): void {
  if (queueNavKeysWired) return;
  queueNavKeysWired = true;
  const blurShortcutFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  };
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // Same gate as filing.ts's installFilingKeys (`if (!state.track) return`), but reached without
    // importing filing.ts's internal `state` (would violate the one-directional import rule —
    // filing.ts must never import from sift-live.ts, and sift-live.ts already imports FROM
    // filing.ts, so a reverse re-export isn't an option either). currentOpenId alone is NOT
    // equivalent: it's set once a track opens in Revue and is never cleared on nav-away (no
    // `currentOpenId = null` reset exists outside syncDetail returning null for an empty queue) —
    // so checking it alone let ↑/↓ still fire from Bibliothèque/Réglages after visiting Revue once.
    // Mirror filing.ts's syncDetail `paneIsOurs` check instead: only act if #mid currently shows
    // the real filing pane (not app.js's mock redrawn over it on nav-away).
    const mid = document.getElementById("mid");
    if (currentOpenId == null || !mid || !mid.querySelector(".sift-fil")) return;
    e.preventDefault();
    blurShortcutFocus();
    stepQueueSelection(e.key === "ArrowDown" ? 1 : -1);
  });
}

// Review mode: "detail" = one track at a time (filing pane), "batch" = triage many at once
// (board's Detail|Batch segmented control). `batchSel` holds the ticked track ids; it is
// pruned to the currently-ready set on every batch render so a filed/removed id can't linger.
let reviewMode: "detail" | "batch" = "detail";
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
const BATCH_GROUP_PAGE = 200;
const batchGroupCap: Record<"file" | "fake" | "readonly", number> = {
  file: BATCH_GROUP_PAGE,
  fake: BATCH_GROUP_PAGE,
  readonly: BATCH_GROUP_PAGE,
};
// Batch "file in place" toggle (FILE_IN_PLACE). Kept apart from batchBin so the picked folder is
// remembered while in-place is on. Effective destination = batchInPlace ? FILE_IN_PLACE : batchBin.
let batchInPlace = false;
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
let batchBin = "";

// Bibliothèque browser state: active filter, which facet column (folder/genre) is shown,
// and the last fetched track list (so a row-click can recover the track's path).
const bibState: {
  filter: LibraryFilter;
  facet: "folder" | "genre" | "artist";
  tracks: LibraryTrack[];
  viewMode: "table" | "grid";
  sort: LibrarySortState;
} = {
  filter: {},
  facet: "folder",
  tracks: [],
  viewMode: "table",
  sort: { field: "artist", dir: "asc" },
};

// Virtualized library list controller. Torn down and recreated on each full renderBiblioLive
// (which replaces #content.innerHTML, orphaning the old #biblist host — its scroll listener sits
// on the PERMANENT #content, so it must be explicitly destroyed or it leaks + double-renders).
let bibVirtual: VirtualList<LibraryTrack> | VirtualList<LibraryTrack[]> | null = null;
// Which library row is open in the detail panel — stamped as `.cur` at row-creation time so the
// highlight survives virtualization (a row scrolled out of the window and back is rebuilt from
// data; setting the class after the fact wouldn't stick, same reasoning as the queue's `active`).
let bibOpenId: number | null = null;

// Doublons internes panel state (Bibliothèque). `null` = not run yet this session.
let dupGroups: DupGroup[] | null = null;
let dupLoading = false;
let dupShown = false; // toggled by the "Doublons" chip

// Verdict = meaning only, vert/ambre uniquement (voir brief refonte 2026-07) — jamais un hex en
// dur ici (l'ancien `#e2685e` rouge cassait cette règle) : lire les tokens CSS, pas une 3e teinte.
const VERDICT_DOT: Record<string, [string, string]> = {
  ok: ["var(--color-text-success)", "authentique"],
  fake: ["var(--color-text-warning)", "faux / sur-encodé"],
  grey: ["var(--color-text-warning)", "zone grise"],
};
function verdictDot(v: string | null): string {
  if (v && VERDICT_DOT[v]) {
    const [c, title] = VERDICT_DOT[v];
    return `<span title="${title}" style="flex:none;width:9px;height:9px;border-radius:50%;background:${c}"></span>`;
  }
  // not analysed yet
  return `<span title="en attente d'analyse" style="flex:none;width:9px;height:9px;border-radius:50%;border:1.5px solid var(--color-text-tertiary);box-sizing:border-box"></span>`;
}

function verdictWord(v: string | null): [string, string] {
  return v === "fake"
    ? ["faux", "var(--color-text-warning)"]
    : v === "grey"
      ? ["à vérifier", "var(--color-text-warning)"]
      : v === "ok"
        ? ["", "var(--color-text-success)"]
        : ["analyse…", "var(--color-text-tertiary)"];
}

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
    count.innerHTML = `${batchSel.size} à ranger${jeter}${exclus}`;
  }
  const slot = document.querySelector(".sift-baction-slot");
  if (slot) slot.innerHTML = actionButtonHtml(batchRunning);
}

/** One queue row's markup. `active` stamps the `.cur` highlight at creation time — required so
 * the highlight survives virtualization (Task 2): once #ql only mounts the visible window, a
 * row for the open track may not exist in the DOM to be found and classed after the fact. */
function queueRowHtml(it: QueueItem, active: boolean): string {
  const [word, wordColor] = verdictWord(it.verdict);
  const title = esc(it.filename || it.path);
  const artist = it.artist ? esc(it.artist) : "";
  return (
    `<div class="qi${active ? " cur" : ""}" data-id="${it.id}" data-path="${esc(it.path)}" title="Écouter et ranger" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px 7px">` +
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
    `<div style="display:flex;align-items:center;gap:6px;min-width:0">` +
    verdictDot(it.verdict) +
    `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500">${title}</span>` +
    (it.dup
      ? '<span title="Doublon possible (même nom)" style="flex:none;display:inline-flex;align-items:center;justify-content:center;overflow:visible;font-size:var(--text-base);line-height:normal;color:var(--color-text-warning)">⧉</span>'
      : "") +
    `</div>` +
    // Always render the second line (never conditionally omit it) — otherwise a
    // not-yet-identified track (no artist) renders one line shorter than an identified
    // one, making queue rows visibly uneven heights next to each other.
    `<div style="padding-left:15px;font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${artist || "&nbsp;"}</div>` +
    `</div>` +
    (word
      ? `<span style="flex:none;font-size:var(--text-xs);color:${wordColor}">${word}</span>`
      : "") +
    `</div>`
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

/** Replaces the mockup queue list with real pending items (Revue screen). */
async function renderQueue(touchDetail = true) {
  const ql = document.getElementById("ql");
  if (!ql) return;
  // First paint has nothing to show yet (the mockup skeleton leaves #ql empty) — on a large
  // library listQueue() can take a couple of seconds, otherwise that's a blank screen the whole
  // time (audit UI/UX 2026-07-03, fix 4). Gated on "no rows yet" so later polls (queue:changed,
  // the 300ms debounce) never flash this over the still-valid existing rows.
  if (!ql.childElementCount) {
    ql.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 7px;color:var(--color-text-tertiary);font-size:var(--text-md)">' +
      '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md)"></i> Chargement…</div>';
  }
  let items: QueueItem[] = [];
  try {
    items = await listQueue();
  } catch (e) {
    console.error("listQueue failed", e);
    return;
  }
  currentItems = items;
  ensureReviewSeg();
  const qcol = document.getElementById("qcol");
  if (qcol) {
    ensureQueueDoneToggle(qcol);
    ensureQueueSearch(qcol);
  }
  // Background-analysis progress moved to the global progress zone (bottom of #nav, persistent
  // across views) — see pushAnalyzeProgress, fed by the analysis:changed event below.

  // Live destination bins + neutral detail prompt (replace the mockup's hardcoded ones).
  const fldz = requireEl("#fldz", "renderQueue");
  void refreshBins(fldz);
  // Only sync the detail pane on structural changes (nav, queue add/remove/file). A background
  // ANALYSIS finishing must NOT re-open / switch the open track — that thrashes and aborts the
  // player's audio load (waveform shows from peaks, but no sound). See touchDetail=false caller.
  if (touchDetail) {
    if (reviewMode === "batch") {
      renderBatch();
    } else {
      const mid = requireEl("#mid", "renderQueue");
      if (mid) {
        currentOpenId = syncDetail(mid, items);
      }
    }
  }
  renderQueueWindow(ql);
  ensureQueueScroll(ql);
}

// Global progress zone — feed the "analyze" row from the EXISTING analysis poll/events (no engine
// rewrite). `analysis_progress` returns (done, total) over PENDING tracks; a track stays pending
// after it's analysed (until filed), so done==total is the RESTING state, not "busy". So we show
// the row only while done<total (actively analysing), then flash a brief 100% "done" before hiding.
let analyzeWasRunning = false;
let analyzeClearTimer: ReturnType<typeof setTimeout> | undefined;
async function pushAnalyzeProgress() {
  try {
    const p = await analysisProgress();
    if (p.total > 0 && p.done < p.total) {
      clearTimeout(analyzeClearTimer);
      analyzeWasRunning = true;
      setTask("analyze", { done: p.done, total: p.total, state: "running" });
    } else if (analyzeWasRunning) {
      // Reached done==total (or the queue drained): flash 100% then auto-hide the row.
      analyzeWasRunning = false;
      setTask("analyze", { done: p.total, total: p.total, state: "done" });
      clearTimeout(analyzeClearTimer);
      analyzeClearTimer = setTimeout(() => clearTask("analyze"), 1200);
    } else {
      clearTask("analyze");
    }
  } catch (e) {
    console.error("analysisProgress failed", e);
  }
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
function pushFileProgress(p: FileProgress) {
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
function onFileStop() {
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

/** A transient bottom-right toast (mirrors filing.ts/library-detail.ts, no undo affordance). */
function toast(message: string): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** Guards a single in-flight export (Rekordbox only — USB has no backend, out of M7 scope). */
let exportRunning = false;

/** Rekordbox export (real merge+rewrite via `export_rekordbox_xml`, called from the Rekordbox
 * page's "Réexporter maintenant" button — see renderRekordboxLive) and the "Clé USB" nav click
 * (still a one-click toast, index.html's `.nv-export`/`data-view="cle"` — its own brainstorm is
 * pending). USB formatting DOES have a backend (`ipc_usb.rs`/`usb_format/`) and even a UI (the
 * "Formater une clé USB" card in Réglages, below) — this toast is unrelated to that, just an
 * explainer for why the nav item itself doesn't do anything yet. */
async function runNavExport(target: "rekordbox" | "usb"): Promise<void> {
  if (target === "usb") {
    toast("Export clé USB : Rekordbox recopie lui-même une fois le XML réimporté");
    return;
  }
  if (exportRunning) return; // one export run at a time
  exportRunning = true;
  setTask("export", { done: 0, total: 1, state: "running" });
  try {
    const status = await exportRekordboxXml();
    setTask("export", { done: 1, total: 1, state: "done" });
    setTimeout(() => clearTask("export"), 1200);
    toast(
      `${status.track_count} pistes dans ${status.playlist_count} playlists Rekordbox — réimporte le XML dans Rekordbox pour resynchroniser.`,
    );
  } catch (e) {
    console.error("export_rekordbox_xml failed", e);
    setTask("export", { done: 0, total: 1, state: "error" });
    const msg = e instanceof Error ? e.message : String(e);
    toast(
      msg.includes("aucun XML")
        ? "Aucun XML Rekordbox lié — relie un fichier depuis la Bibliothèque"
        : `Export Rekordbox échoué : ${msg}`,
    );
  } finally {
    exportRunning = false;
  }
}

/** Detail|Batch segmented control (board `topseg`), injected once at the top of the queue
 * column. Owned here (not app.js) so it works inside Tauri where the live wiring renders the
 * Revue. Reflects `reviewMode`; clicks are handled in the #pa delegate. */
function ensureReviewSeg() {
  const qcol = requireEl("#qcol", "ensureReviewSeg");
  let seg = document.getElementById("sift-revseg");
  if (!seg) {
    seg = document.createElement("div");
    seg.id = "sift-revseg";
    // .sift-seg is the shared segmented-pill track (2026-07-08: was its own inline-styled
    // reimplementation — same component as Apparence/Format USB/Dossiers-Genres now). #sift-revseg
    // adds only its own layout concerns on top: align-self:center (#qcol is a flex column with
    // align-items:stretch by default, so without a fixed align-self the control stretched to the
    // column's full width and its tabs grew with it whenever the column was resized — annotation
    // 2026-07-06: fixed size/position expected, not a stretchy control) and margin-bottom.
    seg.className = "sift-seg sift-seg-thumbed";
    const tab = (m: "detail" | "batch", label: string, icon: string) =>
      `<button class="sift-seg-opt" data-sift="reviewmode" data-m="${m}"><i class="ti ${icon}" style="font-size:var(--text-base)"></i>${label}</button>`;
    // .sift-seg-thumb is a single element that physically slides via transform between options
    // (retour utilisateur 2026-07-08 : le crossfade par bouton ne montrait pas clairement le
    // déplacement d'un état à l'autre) — must be the first child so it paints under the buttons
    // (z-index aside, DOM order matters for default paint order of siblings at the same z-index
    // in some engines; kept first to match .sift-seg-opt's own explicit z-index:1 above it).
    seg.innerHTML =
      '<div class="sift-seg-thumb"></div>' +
      tab("detail", "Détail", "ti-layout-list") +
      tab("batch", "Lot", "ti-table");
    qcol.insertBefore(seg, qcol.firstChild);
  }
  // Toggle .on on the existing buttons instead of rebuilding them (retour utilisateur 2026-07-08 :
  // le changement d'état "swappait" instantanément) — .sift-seg-opt's CSS transition only has
  // something to animate between if the button persists across calls rather than being torn
  // down/recreated from a fresh innerHTML string every time.
  const onBtn = Array.from(
    seg.querySelectorAll<HTMLButtonElement>('[data-sift="reviewmode"]'),
  ).find((btn) => {
    const on = btn.dataset.m === reviewMode;
    btn.classList.toggle("on", on);
    return on;
  });
  const thumb = seg.querySelector<HTMLElement>(".sift-seg-thumb");
  if (thumb && onBtn) {
    thumb.style.width = `${onBtn.offsetWidth}px`;
    thumb.style.transform = `translateX(${onBtn.offsetLeft}px)`;
  }
}

/** "+N traités" / "Masquer les traités" toggle — a real port of the app.js mockup's toggle
 * (2026-07-08), which was never wired to the live queue. Injected once, right after #ql (before
 * the search bar — call order in renderQueue matters here, both are appended to `qcol`). Hidden
 * entirely when there's nothing treated to reveal. */
function ensureQueueDoneToggle(qcol: HTMLElement): void {
  let el = document.getElementById("sift-qdone-toggle");
  if (!el) {
    el = document.createElement("span");
    el.id = "sift-qdone-toggle";
    el.className = "sift-qdone-toggle";
    el.addEventListener("click", () => {
      queueShowAll = !queueShowAll;
      const ql = document.getElementById("ql");
      if (ql) {
        ql.scrollTop = 0;
        renderQueueWindow(ql);
      }
      ensureQueueDoneToggle(qcol); // relabel + re-evaluate hidden state
    });
    qcol.appendChild(el);
  }
  const doneCount = currentItems.filter((it) => it.verdict !== null).length;
  el.hidden = doneCount === 0;
  el.textContent = queueShowAll ? "Masquer les traités" : `+ ${doneCount} traité${doneCount > 1 ? "s" : ""}`;
}

/** Live filter bar for the queue rail (annotation: "on veut une barre de recherche en bas"),
 * injected once at the BOTTOM of #qcol (sibling after #ql, so #ql's flex:1 keeps it pinned below
 * the list). Filters currentItems client-side only (title/artist) — see visibleQueueItems(). */
function ensureQueueSearch(qcol: HTMLElement): void {
  if (document.getElementById("sift-qsearch")) return;
  const wrap = document.createElement("div");
  wrap.id = "sift-qsearch";
  wrap.style.cssText =
    "flex:none;position:relative;margin-top:8px;background:var(--color-background-secondary);border-radius:var(--border-radius-md)";
  // No placeholder text — just a search icon overlaid on the right, hidden once there's a query
  // (annotation: "met juste une icone de loupe sur la droite qui disparait quand on tape").
  wrap.innerHTML =
    '<input id="sift-qsearch-input" type="text" aria-label="Filtrer la file" ' +
    'style="width:100%;border:none;background:transparent;font:inherit;color:var(--color-text-primary);outline:none;padding:6px 30px 6px 9px">' +
    '<i id="sift-qsearch-icon" class="ti ti-search" aria-hidden="true" style="position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:var(--text-base);color:var(--color-text-tertiary);pointer-events:none"></i>';
  qcol.appendChild(wrap);
  const input = wrap.querySelector<HTMLInputElement>("#sift-qsearch-input")!;
  const icon = wrap.querySelector<HTMLElement>("#sift-qsearch-icon")!;
  input.addEventListener("input", () => {
    queueSearchTerm = input.value.trim();
    icon.style.display = input.value ? "none" : "";
    const ql = document.getElementById("ql");
    if (ql) {
      ql.scrollTop = 0; // a shorter filtered list can leave scrollTop referring to nothing
      renderQueueWindow(ql);
    }
  });
}

/** Batch triage view (maquette "Mode Lot"): 3 flat groups by verdict — Prêts · lossless
 * (selectable → File), À vérifier · fake (selectable → Écarter, never filed — Sift ne range
 * jamais un fake lossless), En analyse (read-only, encore en cours d'analyse). One shared
 * format selector for the whole file-able selection (renderBatchRail) — no per-source-rail
 * split; a lossy-sourced file CAN be asked for AIFF/WAV here (see docs/superpowers/plans/2026-07-02-refonte-ui-plan.md,
 * décision "maquette prime" du 2026-07-01 — seule la règle fakes-jamais-filés est gardée).
 * Every control is bound to a real command (`fileBatch` / `rejectBatch`); nothing is mocked. */
function renderBatch() {
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
      `<div class="bx-row" data-sift="batchpick" data-id="${it.id}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUPLICATE</span>'
        : "") +
      `</div>`
    );
  };
  // Read-only "En analyse" rows — no checkbox, matches the maquette's inert third group.
  const pendingRow = (it: QueueItem) => {
    const label = it.verdict === "grey" ? "CHECK" : "analyse…";
    return (
      `<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;opacity:.6">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      (it.dup
        ? '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;padding:2px 7px;border-radius:999px;background:var(--color-background-warning);color:var(--color-text-warning)">DUP</span>'
        : "") +
      `<span style="flex:none;font-size:var(--text-2xs);color:var(--color-text-tertiary)">${label}</span>` +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-info)">Ouvrir en Détail</button>` +
      `</div>`
    );
  };

  // Fakes are selectable to DISCARD (their own tick set), never to file.
  const fakeRow = (it: QueueItem) => {
    const on = batchFakeSel.has(it.id);
    return (
      `<div class="bx-row" data-sift="batchpickfake" data-id="${it.id}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
        on ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${on ? "checked" : ""} tabindex="-1">` +
      verdictDot(it.verdict) +
      nameCell(it, true) +
      '<span style="flex:none;font-size:var(--text-2xs);font-weight:600;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:var(--color-background-danger);color:var(--color-text-danger)">FAKE</span>' +
      `<button data-sift="batchopen" data-id="${it.id}" style="flex:none;font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-info)">Ouvrir en Détail</button>` +
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
      `<span style="width:6px;height:6px;border-radius:999px;background:${dotColor};flex:none"></span>` +
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
        `<button data-sift="batchmore" data-kind="${kind}" style="width:100%;margin-top:4px;padding:7px 9px;font-size:var(--text-sm);color:var(--color-text-info);cursor:pointer;background:transparent;border:none;text-align:center">Afficher les ${next} suivants (${remaining} restants)</button>`;
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
      : '<div class="col-h" style="margin:0 0 6px">Prêts · lossless · 0</div><div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:4px 9px 14px">Rien à ranger pour l’instant.</div>') +
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
function onBatchBinPick(rel: string): void {
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

/** The single rail action button. Adaptive before a run (Ranger / Discarder / both / disabled),
 *  "Stop" during one. `running` swaps to the Stop affordance (wired to onFileStop).
 *  "Ranger" (not "Filer") to match the Détail rail's verb — one action, one name (audit UI/UX
 *  2026-07-03, fix 2). */
function actionButtonHtml(running: boolean): string {
  if (running) {
    return '<button data-sift="batchstop" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Stop</button>';
  }
  const fileN = batchSel.size;
  const fakeN = batchFakeSel.size;
  if (fileN === 0 && fakeN === 0)
    return '<button class="sift-baction" disabled style="background:var(--color-background-info);color:var(--color-text-info);opacity:.5;pointer-events:none">Ranger (0)</button>';
  // Second-click confirm for large batches (see BATCH_CONFIRM_THRESHOLD) — armed only for the
  // exact selection it was requested for, so ticking/unticking a track after arming falls back
  // to asking again instead of silently confirming a changed selection. The button looks like a
  // plain Ranger button until the first click arms it (the click handler re-renders this as the
  // danger "Confirmer" state below) — a distinct button for the actual destructive click, not a
  // permanent scary button sitting there before the user has done anything.
  const armed =
    !!batchConfirmArmed && batchConfirmArmed.fileN === fileN && batchConfirmArmed.fakeN === fakeN;
  if (armed) {
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Confirmer — ranger ${fileN} ?</button>`;
  }
  if (fakeN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Ranger (${fileN})</button>`;
  if (fileN === 0)
    return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-danger);color:var(--color-text-danger)">Écarter (${fakeN})</button>`;
  return `<button data-sift="batchaction" class="sift-baction" style="background:var(--color-background-info);color:var(--color-text-info)">Ranger (${fileN}) · Écarter (${fakeN})</button>`;
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
    } à ranger${jeter}${exclus}</span>` +
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

/** Switch between detail and batch review. On entering batch the #fldz tree becomes the destination
 * explorer (batch pick mode); on leaving we restore the per-track filing pane. */
function setReviewMode(m: "detail" | "batch") {
  reviewMode = m;
  ensureReviewSeg();
  const fldz = requireEl("#fldz", "setReviewMode");
  // #fldz is now the destination popover (hidden by default, toggled by the rail's Destination
  // button in either mode — see renderFoot/renderBatchRail) — no static column visibility to manage.
  if (m === "batch") {
    // Fresh entry into batch mode starts each group at one page (Task 3b) — a prior session's
    // expanded caps shouldn't silently carry over and re-mount thousands of rows on re-entry.
    batchGroupCap.file = BATCH_GROUP_PAGE;
    batchGroupCap.fake = BATCH_GROUP_PAGE;
    batchGroupCap.readonly = BATCH_GROUP_PAGE;
    renderBatch();
    // Drive the #fldz tree in batch pick mode (loads bins, clicks set batchBin via onBatchBinPick).
    void refreshBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  } else {
    // Leave batch pick mode: tree reverts to detail's state.binRel. No manual opacity/checkbox
    // cleanup needed — renderBins (filing.ts) always re-derives .sift-fldz-tree's opacity from
    // the current binPick (null in detail) and renders the one shared in-place checkbox itself.
    clearBinPick();
    // Return the progress zone to its left-sidebar home (it was relocated into the batch rail).
    homeProgressZone();
    void renderQueue(true);
  }
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
    '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md);vertical-align:-1px"></i> Rangement en arrière-plan…',
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
        : `Échec du lancement du rangement : ${esc(code)}`,
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

/** End-of-(background-)filing handler, fired by the `file:done` event. Refreshes the view (as the
 * end-of-batch queue:changed used to) then shows the run summary — but only if the batch rail is
 * still on screen, since the user may have navigated away while the batch ran. */
async function onFileBatchDone(res: BatchResult) {
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
  await refresh();
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
  } finally {
    batchRunning = false;
    await refresh();
  }
}

async function refresh() {
  await renderHomeSources();
  await renderQueue();
  updateRevueBadge(currentItems.length);
}

/** Fill the Review nav badge with the pending count (board's "Revue [18]"). Runs from refresh()
 * — i.e. on every queue change, on any screen — so it's correct even off the Revue view. Empty
 * text collapses the pill via the `.nav-badge:empty` CSS rule. `count` is the queue length
 * `renderQueue` just fetched — no redundant `listQueue()` re-fetch here. */
function updateRevueBadge(count: number) {
  const badge = requireEl<HTMLElement>('.nav-badge[data-badge="revue"]', "updateRevueBadge");
  badge.textContent = count ? String(count) : "";
}

/** Holds the currently-attached `sift:usb-format-done` window listener, if any, so
 * `renderReglagesLive()` can remove it before attaching a new one. Without this, every re-render
 * of Réglages (each nav visit to the screen) piles up another listener on `window` — unlike DOM
 * nodes, a `window` listener has no parent to disappear with, so it accumulates forever. */
let usbFormatDoneHandler: (() => void) | null = null;

/** Live Réglages view: a single scrolling page of real cards (Discogs, Bibliothèque, Apparence),
 * replacing the mockup's static placeholder rows (Dossiers source, Format lossless…), which have
 * no backing data and led nowhere — same "lean Tauri UI" pattern as home-sources.ts (hide the mock
 * content, keep only the title, inject the real thing). One page, not tabs: every card is always
 * visible and reachable by scrolling, per the maquette's "PAS des onglets exclusifs" rule. */
async function renderReglagesLive() {
  const content = requireEl("#content", "renderReglagesLive");

  // Remove any previous live-settings wrapper so we don't duplicate on re-render.
  // All cards live inside this single wrapper (not as separate #content siblings)
  // so a future card can't be forgotten here the way libBlock/themeBlock once were.
  document.getElementById("sift-reglages-live")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "sift-reglages-live";
  wrap.className = "sift-screen-stack sift-settings-stack";

  // Hide the mockup's static rows (no real data behind them); keep only the page title.
  let title: Element | null = null;
  for (const child of Array.from(content.children)) {
    if (!title && child.classList.contains("h1")) {
      title = child;
      continue;
    }
    (child as HTMLElement).style.display = "none";
  }

  let token: string | null = null;
  try {
    token = await getSetting("discogs_token");
  } catch (e) {
    console.error("getSetting(discogs_token) failed", e);
  }
  let theme: ThemeChoice = "auto";
  try {
    const v = await getSetting("ui_theme");
    if (v === "light" || v === "dark") theme = v;
  } catch (e) {
    console.error("getSetting(ui_theme) failed", e);
  }
  let root: string | null = null;
  try {
    root = await getSetting("library_root");
  } catch (e) {
    console.error("getSetting(library_root) failed", e);
  }

  const inputCss =
    "font-size:var(--text-md);padding:4px 7px;background:var(--color-background-primary);" +
    "border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);" +
    "color:var(--color-text-primary);width:100%;font-family:var(--font-mono)";

  // Cartes bordées + titre 16px/600 + texte explicatif, per la maquette (Sift.dc.html:642-691).
  // Divergence assumée : le jeton reste un input à sauvegarde auto (fonctionnel) au lieu du
  // "•••• 4471 + Modifier" de la maquette, dont le bouton est un onNotImpl de démo.
  const block = document.createElement("div");
  block.id = "sift-reglages-discogs";
  block.dataset.section = "discogs";
  block.className = "sift-settings-card sift-settings-list-row";
  block.innerHTML =
    '<div class="sift-settings-title">Discogs</div>' +
    '<div class="sift-settings-desc">Le jeton permet à Sift d\'interroger l\'API Discogs pour identifier tes morceaux (label, année, genre). Sans jeton, les recherches sont limitées et plus lentes.</div>' +
    '<div class="sift-settings-row sift-settings-row-stack">' +
    '<div class="sift-settings-row-head">' +
    '<span class="sift-settings-label">Jeton d\'accès</span>' +
    '<a id="sift-discogs-link" class="sift-settings-link">' +
    '<i class="ti ti-external-link" style="font-size:var(--text-sm);vertical-align:-1px"></i> obtenir un jeton</a>' +
    "</div>" +
    // Masked like any credential (audit UI/UX 2026-07-03, fix 8) — a screenshot/share of Réglages
    // must not leak the token in clear text. Eye toggle to check it without retyping.
    '<div style="position:relative;width:100%">' +
    `<input id="sift-discogs-token" type="password" placeholder="Jeton Discogs…" value="${esc(token ?? "")}" style="${inputCss};padding-right:30px">` +
    '<button type="button" id="sift-discogs-token-toggle" title="Afficher le jeton" aria-label="Afficher le jeton" style="position:absolute;right:2px;top:50%;transform:translateY(-50%);width:26px;height:26px;padding:0;border:none;background:transparent;color:var(--color-text-tertiary);cursor:pointer;display:flex;align-items:center;justify-content:center"><i class="ti ti-eye" style="font-size:var(--text-md)"></i></button>' +
    "</div>" +
    '<div id="sift-discogs-status" style="font-size:var(--text-sm);color:var(--color-text-tertiary);min-height:14px"></div>' +
    "</div>";

  const libBlock = document.createElement("div");
  libBlock.id = "sift-reglages-bibliotheque";
  libBlock.dataset.section = "bibliotheque";
  libBlock.className = "sift-settings-card sift-settings-list-row";
  libBlock.innerHTML =
    '<div class="sift-settings-title">Bibliothèque</div>' +
    '<div class="sift-settings-desc">Le dossier racine est l\'endroit réel sur ton disque où Sift range les morceaux filés. L\'arborescence de destination (House/Deep, Techno…) vit à l\'intérieur.</div>' +
    '<div class="sift-settings-row">' +
    '<div style="min-width:0">' +
    '<div class="sift-settings-label" style="margin-bottom:3px">Dossier racine</div>' +
    `<div style="font-size:var(--text-md);font-family:var(--font-mono);color:${
      root ? "var(--color-text-tertiary)" : "var(--color-text-quaternary)"
    };overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(root || "Aucun dossier sélectionné")}</div>` +
    "</div>" +
    '<button id="sift-lib-root-change" class="sift-settings-btn">Changer…</button>' +
    "</div>" +
    (root
      ? '<div class="sift-settings-subactions"><button id="sift-lib-root-forget" type="button" class="sift-settings-btn sift-settings-btn-quiet">Oublier le dossier racine</button></div>'
      : "");
  libBlock.querySelector("#sift-lib-root-change")?.addEventListener("click", () => {
    void (async () => {
      const dir = await openFolderDialog({ directory: true, multiple: false });
      if (typeof dir !== "string") return;
      try {
        await setSetting("library_root", dir);
        void renderReglagesLive();
      } catch (e) {
        console.error("setSetting(library_root) failed", e);
      }
    })();
  });
  libBlock.querySelector("#sift-lib-root-forget")?.addEventListener("click", () => {
    void (async () => {
      try {
        await setSetting("library_root", "");
        void renderReglagesLive();
      } catch (e) {
        console.error("setSetting(library_root) failed", e);
      }
    })();
  });

  const themeBlock = document.createElement("div");
  themeBlock.id = "sift-reglages-apparence";
  themeBlock.dataset.section = "apparence";
  themeBlock.className = "sift-settings-card sift-settings-list-row";
  // Audit-ref G1 (Réglages, 2026-07-09) : <span> → <button>, incohérent avec le reste de l'app.
  const themeBtn = (v: ThemeChoice, label: string) =>
    `<button class="sift-seg-opt${theme === v ? " on" : ""}" data-theme-choice="${v}">${label}</button>`;
  // Audit-ref (Réglages, 2026-07-09, retour Antoine "on n'a pas l'animation pour toutes les
  // pastilles") : thumb glissant ajouté ici — son DOM persiste déjà entre les clics (classList
  // toggle en place, pas de re-render), donc éligible sans restructuration (contrairement à
  // Dossiers/Genres et Session/Historique, qui reconstruisent tout via innerHTML à chaque clic —
  // voir css-transition-requires-persisting-dom en mémoire). Même pattern que positionFmtThumb().
  themeBlock.innerHTML =
    '<div class="sift-settings-title">Apparence</div>' +
    '<div class="sift-settings-desc">Auto suit le réglage clair/sombre de ton système. Clair et Sombre forcent un mode fixe, quel que soit le système.</div>' +
    '<div class="sift-settings-row">' +
    '<span class="sift-settings-label">Thème</span>' +
    '<div class="sift-seg sift-seg-thumbed">' +
    '<div class="sift-seg-thumb"></div>' +
    themeBtn("auto", "Auto") +
    themeBtn("light", "Clair") +
    themeBtn("dark", "Sombre") +
    "</div></div>";
  function positionThemeThumb(): void {
    const thumb = themeBlock.querySelector<HTMLElement>(".sift-seg-thumb");
    const onEl = themeBlock.querySelector<HTMLElement>("[data-theme-choice].on");
    if (!thumb || !onEl) return;
    thumb.style.width = `${onEl.offsetWidth}px`;
    thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
  }
  // Not called here yet — themeBlock isn't attached to the live DOM until content.appendChild(wrap)
  // below, and offsetWidth/offsetLeft read 0 on a detached element. Called after that instead.
  themeBlock.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach((el) =>
    el.addEventListener("click", () => {
      const choice = el.dataset.themeChoice as ThemeChoice;
      void setTheme(choice);
      themeBlock.querySelectorAll("[data-theme-choice]").forEach((c) => c.classList.remove("on"));
      el.classList.add("on");
      positionThemeThumb();
    }),
  );

  // M7: "Formater une clé USB" card — same card family as Discogs/Bibliothèque/Apparence
  // above. Backend-side conservative filter means this list only ever shows removable disks
  // (see usb_format::windows/macos) — no client-side re-filtering needed here.
  const usbBlock = document.createElement("div");
  usbBlock.id = "sift-reglages-usb";
  usbBlock.dataset.section = "usb";
  usbBlock.className = "sift-settings-card sift-settings-list-row";
  usbBlock.innerHTML =
    '<div class="sift-settings-title">Formater une clé USB</div>' +
    '<div class="sift-settings-desc">Formate un disque amovible en FAT32 (contourne la limite ' +
    "32 Go de l'assistant Windows) ou exFAT. Seuls les disques amovibles sont proposés — " +
    "aucun disque interne n'apparaît ici.</div>" +
    '<div id="sift-usb-list" class="sift-usb-list"></div>' +
    '<div class="sift-settings-subactions"><button id="sift-usb-refresh" class="sift-settings-btn sift-settings-btn-quiet">Actualiser la liste</button></div>';

  async function renderUsbList() {
    const listEl = usbBlock.querySelector<HTMLElement>("#sift-usb-list");
    if (!listEl) return;
    listEl.innerHTML = '<div class="sift-usb-empty">Recherche des disques amovibles…</div>';
    let drives: RemovableDrive[] = [];
    try {
      drives = await listRemovableDrives();
    } catch (e) {
      console.error("listRemovableDrives failed", e);
      listEl.innerHTML = '<div class="sift-usb-empty">Impossible de lister les disques amovibles.</div>';
      return;
    }
    if (!drives.length) {
      listEl.innerHTML = '<div class="sift-usb-empty">Aucun disque amovible détecté.</div>';
      return;
    }
    listEl.innerHTML = "";
    for (const d of drives) {
      const row = document.createElement("div");
      row.className = "sift-usb-row";
      const sizeGb = (d.size_bytes / 1_000_000_000).toFixed(1);
      row.innerHTML =
        '<div class="sift-usb-row-info">' +
        `<span class="sift-usb-row-id">${esc(d.id)}</span>` +
        `<span class="sift-usb-row-meta">${esc(d.label || "Disque amovible")} · ${sizeGb} Go · ${esc(d.current_fs)}</span>` +
        "</div>" +
        '<button type="button" class="sift-settings-btn" data-usb-format>Formater…</button>';
      row.querySelector("[data-usb-format]")?.addEventListener("click", () => {
        openUsbFormatModal(d);
      });
      listEl.appendChild(row);
    }
  }

  usbBlock
    .querySelector("#sift-usb-refresh")
    ?.addEventListener("click", () => void renderUsbList());
  if (usbFormatDoneHandler) {
    window.removeEventListener("sift:usb-format-done", usbFormatDoneHandler);
  }
  usbFormatDoneHandler = () => void renderUsbList();
  window.addEventListener("sift:usb-format-done", usbFormatDoneHandler);
  void renderUsbList();

  // Single wrapper: only #sift-reglages-live is removed/recreated per render (see the
  // 2026-07-04 fix), so every settings card — present or future — must build inside `wrap`
  // rather than as a direct sibling of `content`, or it duplicates on re-render.
  //
  // 2026-07-08: the 4 sections used to each be their own .sift-ui-card-soft box, but each one
  // only ever holds a single setting — a box groups "related information" (HIG "Boxes"),
  // grouping one item alone just adds chrome (retour utilisateur : "trop de boîtes"). They now
  // share one .sift-ui-card-soft list, divided by a hairline (.sift-settings-list-row) instead
  // of 4 separate cards. Any future settings section must append inside `list`, same rule as
  // `wrap` above — not as a direct sibling of `content`.
  const list = document.createElement("div");
  list.id = "sift-reglages-list";
  list.className = "sift-settings-list sift-ui-card-soft sift-ui-card-soft-pad";
  list.appendChild(block);
  list.appendChild(libBlock);
  list.appendChild(themeBlock);
  list.appendChild(usbBlock);
  wrap.appendChild(list);
  content.appendChild(wrap);
  positionThemeThumb(); // now attached to the live DOM — offsetWidth/offsetLeft resolve correctly

  const inp = block.querySelector<HTMLInputElement>("#sift-discogs-token");
  const status = block.querySelector<HTMLElement>("#sift-discogs-status");
  const link = block.querySelector<HTMLElement>("#sift-discogs-link");
  const toggle = block.querySelector<HTMLButtonElement>("#sift-discogs-token-toggle");

  toggle?.addEventListener("click", () => {
    if (!inp) return;
    const shown = inp.type === "text";
    inp.type = shown ? "password" : "text";
    toggle.title = shown ? "Afficher le jeton" : "Masquer le jeton";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.innerHTML = `<i class="ti ${shown ? "ti-eye" : "ti-eye-off"}" style="font-size:var(--text-md)"></i>`;
  });

  link?.addEventListener("click", () =>
    void openUrl("https://www.discogs.com/settings/developers").catch((e) =>
      console.error("openUrl failed", e),
    ),
  );

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  inp?.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const val = inp.value.trim();
      try {
        await setSetting("discogs_token", val);
        if (status) {
          status.textContent = val ? "Jeton enregistré." : "Jeton effacé.";
          setTimeout(() => {
            if (status) status.textContent = "";
          }, 2000);
        }
      } catch (e) {
        if (status) status.textContent = "Erreur d'enregistrement.";
        console.error("setSetting(discogs_token) failed", e);
      }
    }, 600);
  });
}

function dupMemberHtml(m: DupGroup["members"][number]): string {
  const name = esc(m.filename || m.path.split(/[\\/]/).pop() || m.path);
  const fmt = (m.format || "?").toUpperCase();
  const br = m.bitrate ? `${m.bitrate} kbps` : "";
  return (
    `<div style="display:flex;align-items:center;gap:8px;padding:4px 0${m.recommend_keep ? "" : ";opacity:.6"}">` +
    `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>` +
    `<span class="pill" style="flex:none">${esc(fmt)}</span>` +
    `<span style="flex:none;width:80px;text-align:right;font-size:var(--text-sm);color:var(--color-text-tertiary)">${esc(br)}</span>` +
    (m.recommend_keep
      ? `<span class="pill" style="flex:none;background:var(--color-background-success);color:var(--color-text-success)" title="${esc(m.reason || "")}">Recommandé</span>`
      : "") +
    `</div>`
  );
}

function dupGroupHtml(g: DupGroup, idx: number): string {
  const loserCount = g.members.filter((m) => !m.recommend_keep).length;
  return (
    `<div class="sift-dup-group" style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:8px">` +
    g.members.map((m) => dupMemberHtml(m)).join("") +
    `<div style="margin-top:6px"><button data-bib="dupresolve" data-idx="${idx}">Envoyer ${loserCount} doublon${loserCount > 1 ? "s" : ""} à la corbeille</button></div>` +
    `</div>`
  );
}

function statsCardsHtml(s: DashboardStats): string {
  const activeStat =
    bibState.filter.verdict === "fake"
      ? "fake"
      : dupShown
        ? "duplicates"
        : (bibState.filter.quality ?? "all");
  const card = (label: string, value: number, action: string, extra = "") => {
    const on = action === activeStat;
    return (
      `<button data-bib="stat" data-stat="${action}" style="flex:1;min-width:90px;text-align:left;border:0.5px solid ${on ? "var(--color-border-secondary)" : "var(--color-border-tertiary)"};border-radius:var(--border-radius-md);padding:8px 10px;background:${on ? "var(--color-row-active)" : "transparent"};cursor:pointer">` +
      `<div style="font-size:var(--text-xl);font-weight:600">${value}</div>` +
      `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${esc(label)}${extra}</div>` +
      `</button>`
    );
  };
  return (
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">` +
    card("Total", s.total, "all") +
    card("Lossless", s.lossless, "lossless") +
    card("MP3", s.mp3, "mp3") +
    card("Doublons", s.duplicates, "duplicates") +
    card("À re-sourcer", s.fake, "fake") +
    `</div>`
  );
}

/** Rekordbox link-status card, now the Rekordbox page's centerpiece (moved out of Bibliothèque,
 * audit 2026-07-05 — see docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md).
 * Same visual family as the M6b stat cards (border+radius token, no accent stripe per the CSS ban
 * on border-left/-right accents). Only called for `s.linked === true` — the not-linked case is a
 * full empty-state (see renderRekordboxLive). */
function rekordboxCardHtml(s: RekordboxLinkStatus): string {
  const body = s.error
    ? `<div style="font-size:var(--text-md);color:var(--color-text-danger)">XML Rekordbox illisible — relie un fichier.</div>`
    : `<div style="font-size:var(--text-md)">${esc(s.path || "")}</div>` +
      `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${s.playlist_count} playlists · ${s.track_count} pistes</div>`;
  // No "Réexporter" while the linked file is unreadable — the backend already refuses the export
  // in that case (export_rekordbox_xml_inner reads the same path before merging).
  const reexport = s.error
    ? ""
    : `<button data-sift="rkbreexport" style="flex:none">Réexporter maintenant</button>`;
  return (
    `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">` +
    `<div style="min-width:0">${body}</div>` +
    `<div style="display:flex;gap:8px;flex:none">${reexport}<button data-bib="rkblink" style="flex:none">Changer de XML lié</button></div>` +
    `</div>`
  );
}

/** Rekordbox integration page (data-view="rkb") — real screen replacing the old one-click nav
 * export (audit 2026-07-05, docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md).
 * Renders the whole page fresh each call, same pattern as renderBiblioLive/renderJournal — no mock
 * DOM survives. `drift_detected` is independent of linked/error, so the banner can appear on top
 * of either linked state (never modeled as a 4-way exclusive if/else). */
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
            `<button data-sift="mdbresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${pathBlock(r)}` +
        `<button data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRows = pending
    .map((r) => {
      const checked = mdbRepairSel.has(r.id);
      return (
        // Audit-ref G3 (Rekordbox, 2026-07-09) : ligne-checkbox sans clavier — tabindex/role/
        // aria-checked ajoutés, clavier via installNavKeyboard() étendu. Le bouton "Ignorer" imbriqué
        // est déjà protégé par la garde anti-double-déclenchement (Bibliothèque, audit-ref B1).
        `<div class="bx-row" data-sift="mdbpick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
          checked ? "background:var(--overlay-hover)" : ""
        }">` +
        `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
        pathBlock(r) +
        `<button data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
        `</div>`
      );
    })
    .join("");

  const applyBar =
    mdbRepairSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="mdbapply" style="font-weight:500">Appliquer la sélection (${mdbRepairSel.size})</button></div>`
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

async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
  } catch (e) {
    console.error("rekordbox_status failed", e);
    content.innerHTML =
      `<div class="h1">Rekordbox</div>` +
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Statut Rekordbox indisponible.</div>`;
    return;
  }

  const intro =
    `<div class="h1">Rekordbox</div>` +
    `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);margin-bottom:12px">` +
    `Sift range tes morceaux → l'export fusionne les nouveaux dans le XML lié → réimporte-le dans Rekordbox pour les voir apparaître.` +
    `</div>`;

  if (!status.linked) {
    content.innerHTML =
      intro +
      emptyStateHtml({
        title: "Aucun XML Rekordbox lié",
        note: "Relie le fichier XML exporté depuis Rekordbox pour commencer à synchroniser tes rangements.",
        actionHtml: `<button data-bib="rkblink">Lier un fichier XML Rekordbox</button>`,
      });
    wireEmptyState(content);
    return;
  }

  const driftBanner = status.drift_detected
    ? `<div class="sift-dup-banner" style="background:var(--color-background-warning)">` +
      `<i class="ti ti-alert-triangle" style="color:var(--color-text-warning)"></i>` +
      `<div class="sift-dup-banner-body">` +
      `<div class="sift-dup-banner-head" style="color:var(--color-text-warning)">Une correction de chemin a échoué lors d'un rangement récent</div>` +
      // .sift-dup-banner-where is built for a truncated file path (nowrap+ellipsis) — this is a
      // full sentence, the entire payload of a warning that was previously invisible anywhere in
      // the UI, so it must never silently clip on a narrow window.
      `<div class="sift-dup-banner-where" style="white-space:normal;overflow:visible;text-overflow:clip">Vérifie les pistes déplacées dans Rekordbox.</div>` +
      `</div></div>`
    : "";

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

  let metadataSyncSection = "";
  try {
    const syncs = await rekordboxMasterdbPendingMetadataSyncs();
    metadataSyncSection = metadataSyncsSectionHtml(syncs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_metadata_syncs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection + dedupSection + metadataSyncSection;
}

/** Positions the Dossiers/Genres thumb from whichever button currently carries `.on`. Called both
 * right after a full rebuild (fresh node — just places it) and immediately on facet click before
 * renderBiblioLive()'s async IPC round-trip rebuilds everything (see the "facet" branch below) —
 * that's the call that actually animates, same pattern as Journal's positionJournalThumb(). */
function positionFacetThumb(): void {
  const seg = document.getElementById("sift-bib-facet-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-bib='facet'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Same thumb-glide pattern as positionFacetThumb(), for the Tableau/Grille segmented. */
function positionViewModeThumb(): void {
  const seg = document.getElementById("sift-bib-viewmode-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-bib='viewmode'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Live Bibliothèque view: lists filed tracks with search + quality chips + folder/genre
 * facets, wired to real data. Actions go through the #pa delegated handler (data-bib). */
async function renderBiblioLive() {
  const content = requireEl("#content", "renderBiblioLive");
  // Tear down any previous virtual list first: its scroll listener sits on the permanent #content,
  // which this render is about to overwrite — leaving it attached would leak the listener and fire
  // renders against a detached host.
  bibVirtual?.destroy();
  bibVirtual = null;
  let facets: LibraryFacets = { folders: [], genres: [], artists: [] };
  let stats: DashboardStats | null = null;
  try {
    [bibState.tracks, facets, stats] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
    ]);
  } catch (e) {
    console.error("library load failed", e);
    return;
  }

  // Audit-ref B2 (Bibliothèque, 2026-07-09) : <span> converti en <button> pour un clavier natif
  // (pas besoin d'étendre installNavKeyboard — un vrai bouton gère déjà Enter/Espace lui-même).
  const chips =
    (["all", "lossless", "mp3"] as const)
      .map((q) => {
        const on = (bibState.filter.quality ?? "all") === q;
        const label = q === "all" ? "Tous" : q === "lossless" ? "Lossless" : "MP3";
        return `<button class="chip${on ? " on" : ""}" data-bib="qual" data-q="${q}">${label}</button>`;
      })
      .join("") +
    `<button class="chip${dupShown ? " on" : ""}" data-bib="dupscan">Doublons</button>`;

  const facetList =
    bibState.facet === "folder" ? facets.folders : bibState.facet === "genre" ? facets.genres : facets.artists;
  const sideKey = bibState.facet;
  const activeFacetVal =
    bibState.facet === "folder"
      ? bibState.filter.folder
      : bibState.facet === "genre"
        ? bibState.filter.genre
        : bibState.filter.artist;
  const side =
    // Segmented pill (2026-07-08, was .chip/.chip.on) — a strictly exclusive 3-way choice is the
    // same job as Apparence/Format USB/Détail-Lot, not a filter chip (chips stay the "tag/filter"
    // grammar elsewhere, e.g. genre chips).
    // Audit-ref B3 (Bibliothèque, 2026-07-09) : <span> converti en <button>, incohérent avec le
    // reste de l'app où .sift-seg-opt est toujours un vrai bouton (déjà clavier-natif du coup).
    // Thumb glissant ajouté (retour Antoine, même jour) — voir positionFacetThumb() : classes
    // togglées en place au clic avant le rebuild (async, IPC), même pattern que Journal.
    `<div class="sift-seg sift-seg-thumbed" id="sift-bib-facet-seg" style="margin-bottom:8px">` +
    `<div class="sift-seg-thumb"></div>` +
    `<button class="sift-seg-opt${bibState.facet === "folder" ? " on" : ""}" data-bib="facet" data-f="folder">Dossiers</button>` +
    `<button class="sift-seg-opt${bibState.facet === "genre" ? " on" : ""}" data-bib="facet" data-f="genre">Genres</button>` +
    `<button class="sift-seg-opt${bibState.facet === "artist" ? " on" : ""}" data-bib="facet" data-f="artist">Artistes</button></div>` +
    // Audit-ref B1 : tabindex/role="button", clavier via installNavKeyboard() étendu (chrome.ts).
    facetList
      .map(
        (b) =>
          `<div class="fld${activeFacetVal === b.name ? " on" : ""}" data-bib="pick" data-key="${sideKey}" data-val="${esc(b.name)}" tabindex="0" role="button" style="justify-content:space-between"><span>${esc(b.name)}</span><span style="font-size:var(--text-sm);opacity:.7">${b.count}</span></div>`,
      )
      .join("");

  // The list is virtualized (createVirtualList below) — this placeholder is the mount host, filled
  // with only the visible window of rows after content.innerHTML. Rendering all bibState.tracks
  // here would reintroduce the 15k-track freeze (audit 2026-07-05 P2). `rows` non-empty iff there's
  // at least one track, used only to pick the "no result" fallback below.
  const rows = bibState.tracks.length ? '<div id="biblist"></div>' : "";
  const sortedTracks = bibState.viewMode === "table" ? sortTracks(bibState.tracks, bibState.sort) : bibState.tracks;
  const tableHead = bibState.viewMode === "table" ? libraryTableHeaderHtml(bibState.sort) : "";
  // Truly empty (no filed track at all, no filter narrowing it) vs. a filter that just matches
  // nothing right now — only the former is DESIGN.md's "État vide" dead-end with a back-to-Revue
  // link; the latter keeps the search/chips/facets on screen so the filter can be cleared.
  const noFilter =
    !bibState.filter.q && !bibState.filter.quality && !bibState.filter.folder && !bibState.filter.genre;
  const trulyEmpty = bibState.tracks.length === 0 && noFilter;

  const dupSection = !dupShown
    ? ""
    : dupLoading
      ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Scan en cours (toute la bibliothèque)…</div>`
      : dupGroups === null
        ? ""
        : dupGroups.length === 0
          ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun doublon dans toute la bibliothèque.</div>`
          : `<div style="margin-top:10px"><div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:4px">Doublons détectés dans toute la bibliothèque (pas seulement la vue filtrée actuelle)</div>${dupGroups.map((g, i) => dupGroupHtml(g, i)).join("")}</div>`;

  // Export (Rekordbox/Clé USB) lives in the nav rail now, not here — matches the maquette's
  // persistent Export section (index.html nav-export items, wired in installLiveWiring below).
  // Retour Antoine 2026-07-09 : le toolbar (recherche+chips) était sa PROPRE boîte flottante
  // au-dessus du panneau — une seule information (le filtre courant), grouper ça seul ajoute du
  // chrome pour rien (même règle HIG Boxes que la consolidation Réglages, 2026-07-08). Intégré
  // maintenant comme bandeau supérieur du panneau .sift-library-main, séparé par un filet.
  const header =
    `<div class="sift-library-toolbar">` +
    `<div style="flex:1;display:flex;align-items:center;gap:7px;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:6px 10px"><i class="ti ti-search" style="font-size:var(--text-lg);color:var(--color-text-tertiary)"></i><input id="bibq" placeholder="Rechercher…" aria-label="Rechercher dans la bibliothèque" value="${esc(bibState.filter.q || "")}" style="flex:1;border:0;background:transparent;color:inherit;font-size:var(--text-md);outline:none"></div>` +
    chips +
    `<div class="sift-seg sift-seg-thumbed" id="sift-bib-viewmode-seg">` +
    `<div class="sift-seg-thumb"></div>` +
    `<button class="sift-seg-opt${bibState.viewMode === "table" ? " on" : ""}" data-bib="viewmode" data-mode="table" aria-label="Vue tableau"><i class="ti ti-list"></i></button>` +
    `<button class="sift-seg-opt${bibState.viewMode === "grid" ? " on" : ""}" data-bib="viewmode" data-mode="grid" aria-label="Vue grille"><i class="ti ti-layout-grid"></i></button></div>` +
    `</div>`;

  content.innerHTML = trulyEmpty
    ? emptyStateHtml({
        title: "Bibliothèque vide",
        note: "Les pistes que tu ranges depuis Revue apparaissent ici, prêtes à exporter vers Rekordbox ou une clé USB.",
        backToRevue: true,
      })
    : (stats ? statsCardsHtml(stats) : "") +
      `<div class="sift-library-layout"><div class="sift-library-side sift-ui-card-soft sift-ui-card-soft-pad"><div class="col-h">Bibliothèque</div>${side}</div>` +
      `<div class="sift-library-main sift-ui-card sift-ui-card-pad">${header}<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:var(--text-base);font-weight:500">${esc(activeFacetVal || "Tous")}</span><span style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${bibState.tracks.length} piste${bibState.tracks.length > 1 ? "s" : ""}</span></div>${tableHead}` +
      (rows ||
        `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun résultat pour ce filtre. <button data-bib="stat" data-stat="all" style="font-size:inherit;color:var(--color-text-info);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline">Réinitialiser les filtres</button></div>`) +
      dupSection +
      `<div id="bibplayer"></div></div></div>`;
  wireEmptyState(content);
  positionFacetThumb(); // fresh node post-rebuild — no prior transform, just place it
  positionViewModeThumb();

  if (trulyEmpty) return; // no header/search — nothing left to wire

  const q = document.getElementById("bibq") as HTMLInputElement | null;
  q?.addEventListener("input", () => {
    bibState.filter.q = q.value || undefined;
    clearTimeout((q as unknown as { _t?: number })._t);
    const toolbar = q.closest<HTMLElement>(".sift-library-toolbar");
    toolbar?.querySelector(".sift-bib-search-pending")?.remove();
    const pending = document.createElement("span");
    pending.className = "sift-bib-search-pending";
    pending.style.cssText = "font-size:var(--text-xs);color:var(--color-text-tertiary)";
    pending.textContent = "Recherche…";
    toolbar?.appendChild(pending);
    (q as unknown as { _t?: number })._t = window.setTimeout(() => void renderBiblioLive(), 250);
  });

  // Virtualize the filed-track list: #content is the scroll container (app.js's block() set it to
  // overflow-y:auto), but the list is only ONE section of it (stats/rekordbox/header/facets sit
  // above) — createVirtualList handles that offset. #biblist exists iff bibState.tracks non-empty.
  const biblist = document.getElementById("biblist");
  if (biblist) {
    if (bibState.viewMode === "table") {
      bibVirtual = createVirtualList<LibraryTrack>({
        host: biblist,
        scrollContainer: content,
        items: sortedTracks,
        rowHtml: (t) => libraryTableRowHtml(t, bibOpenId),
        probeHtml: LIBRARY_TABLE_PROBE_HTML,
        fallbackRowH: 34,
      });
    } else {
      const gridRows: LibraryTrack[][] = [];
      for (let i = 0; i < sortedTracks.length; i += LIBRARY_GRID_TILES_PER_ROW) {
        gridRows.push(sortedTracks.slice(i, i + LIBRARY_GRID_TILES_PER_ROW));
      }
      bibVirtual = createVirtualList<LibraryTrack[]>({
        host: biblist,
        scrollContainer: content,
        items: gridRows,
        rowHtml: (row) => libraryGridRowHtml(row),
        probeHtml: LIBRARY_GRID_PROBE_HTML,
        fallbackRowH: 150,
      });
    }
  }
}

/** Open the unified detail/edit panel for a filed track into #bibplayer, highlighting its row.
 * On save, patch the row label in place (player stays alive); on delete, re-render the list. */
function openBiblioDetail(id: number): void {
  const t = bibState.tracks.find((x) => x.id === id);
  const host = requireEl("#bibplayer", "openBiblioDetail");
  if (!t) return;
  if (bibOpenId === id) {
    bibOpenId = null;
    document.querySelectorAll(".lr.cur").forEach((n) => n.classList.remove("cur"));
    host.innerHTML = "";
    return;
  }
  // Track the open id so the `.cur` highlight is re-stamped by biblioRowHtml when a scrolled-away
  // row re-enters the virtualized window. Clear the class on currently-mounted rows immediately for
  // instant feedback (rows outside the window aren't in the DOM — bibOpenId covers them on mount).
  bibOpenId = id;
  document.querySelectorAll(".lr.cur").forEach((n) => n.classList.remove("cur"));
  document.querySelector(`.lr[data-id="${id}"]`)?.classList.add("cur");
  openLibraryDetailInto(
    host,
    t,
    (updated) => {
      // Keep the in-memory list + the visible row label in sync without a full re-render.
      const i = bibState.tracks.findIndex((x) => x.id === updated.id);
      if (i >= 0) bibState.tracks[i] = updated;
      const span = document.querySelector(`.lr[data-id="${updated.id}"] .bib-name`);
      if (span) span.textContent = bibName(updated);
    },
    () => void renderBiblioLive(),
    () => {
      bibOpenId = null;
      document.querySelectorAll(".lr.cur").forEach((n) => n.classList.remove("cur"));
      host.innerHTML = "";
    },
  );
}

export function installLiveWiring() {
  window.__siftHome = renderHomeSources;
  window.__siftQueue = renderQueue;
  window.__siftEcarts = renderEcartes;
  window.__siftReglages = () => void renderReglagesLive();
  window.__siftBiblio = () => void renderBiblioLive();
  window.__siftJournal = () => void renderJournal();
  window.__siftRkb = () => void renderRekordboxLive();
  injectLeanStyle();
  void injectTitlebar();
  void initTheme();
  installUndoShortcut();
  installFilingKeys();
  installQueueNavKeys();
  installScrollAutohide();
  installNavKeyboard();
  void installDragDrop();

  // Nav "Clé USB" is still a one-click action, not a real screen (Clé USB's own brainstorm is
  // pending — see docs/ressources-externes.md) — capture phase so this runs BEFORE app.js's own
  // bubble-phase `#pa` listener (registered first, at import time) can switch `view` to the mock
  // screen. stopPropagation() during capture halts the whole path, including that bubble-phase
  // listener. "Rekordbox" is a real page now (renderRekordboxLive, window.__siftRkb above) — its
  // click is left alone so it reaches app.js's router and navigates normally.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>('[data-view="cle"]');
      if (!exp) return;
      e.stopPropagation();
      void runNavExport("usb");
    },
    { capture: true },
  );

  // Debounces the heavy report/audio-decode load triggered by a queue-row selection (click or
  // ↑/↓, which dispatches a real .click() — see installFilingKeys). Flicking through several
  // rows fast would otherwise fire a full fetch+decodeAudioData per row, most immediately
  // discarded. Row highlighting itself stays instant — only this load is deferred.
  let queueSelectTimer: ReturnType<typeof setTimeout> | undefined;

  requireEl("#pa", "installLiveWiring").addEventListener("click", (e) => {
    // queue item → open the live filing pane (report + editor + actions) in #mid
    const qi = (e.target as HTMLElement).closest<HTMLElement>(".qi[data-id]");
    if (qi?.dataset.id) {
      e.stopPropagation();
      // In batch mode a row-click means "inspect this one" → drop back to the detail pane.
      if (reviewMode === "batch") setReviewMode("detail");
      const id = Number(qi.dataset.id);
      const item = currentItems.find((it) => it.id === id);
      const mid = requireEl("#mid", "qi-click");
      currentOpenId = id;
      const ql = document.getElementById("ql");
      if (ql) renderQueueWindow(ql);
      clearTimeout(queueSelectTimer);
      queueSelectTimer = setTimeout(() => {
        if (item && mid) {
          void openFilingInto(mid, item);
          prefetchNextAfter(item.id);
        } else if (qi.dataset.path)
          void import("./report-view").then((m) => m.openReportModal(qi.dataset.path!));
      }, 150);
      return;
    }
    // Écartés actions (copy query / send-to-bin / restore / empty bin)
    const ec = (e.target as HTMLElement).closest<HTMLElement>("[data-ec]");
    if (ec) {
      e.stopPropagation();
      const act = ec.dataset.ec;
      const id = Number(ec.dataset.id);
      if (act === "copy-query") {
        void navigator.clipboard.writeText(ec.dataset.q || "").catch(() => {});
        const prev = ec.innerHTML;
        ec.innerHTML = '<i class="ti ti-check" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copié';
        setTimeout(() => {
          ec.innerHTML = prev;
        }, 1200);
      } else if (act === "trash") {
        void trashTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("trash failed", err);
            toast("Échec : impossible d'envoyer à la corbeille");
          });
      } else if (act === "restore") {
        void restoreTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("restore failed", err);
            toast("Échec : restauration impossible");
          });
      } else if (act === "requeue") {
        void requeueTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("requeue failed", err);
            toast("Échec : remise en file impossible");
          });
      } else if (act === "purge") {
        void confirmAction(
          "Purger définitivement la corbeille ? Cette action est irréversible.",
          "Purger",
        ).then((ok) => {
          if (!ok) return;
          void purgeTrash()
            .then(renderEcartes)
            .catch((err) => {
              console.error("purge failed", err);
              toast("Échec : purge de la corbeille impossible");
            });
        });
      } else if (act === "store") {
        void openUrl(decodeURIComponent(ec.dataset.url || "")).catch((err) =>
          console.error("open_url failed", err),
        );
      }
      return;
    }
    // Bibliothèque actions (quality chips / facet toggle / folder|genre pick / Discogs link / play)
    const bibEl = (e.target as HTMLElement).closest<HTMLElement>("[data-bib]");
    if (bibEl) {
      const act = bibEl.dataset.bib;
      if (act === "stat") {
        const stat = bibEl.dataset.stat;
        if (stat === "all") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = undefined;
        } else if (stat === "lossless" || stat === "mp3") {
          bibState.filter.quality = stat;
          bibState.filter.verdict = undefined;
        } else if (stat === "duplicates") {
          dupShown = !dupShown;
          if (dupShown && dupGroups === null) {
            dupLoading = true;
            void renderBiblioLive();
            void scanLibraryDuplicates()
              .then((groups) => {
                dupGroups = groups;
              })
              .catch((e) => {
                console.error("scan_library_duplicates failed", e);
                dupGroups = [];
              })
              .finally(() => {
                dupLoading = false;
                void renderBiblioLive();
              });
            return;
          }
        } else if (stat === "fake") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = "fake";
        }
        void renderBiblioLive();
        return;
      } else if (act === "rkblink") {
        void (async () => {
          try {
            const chosen = await openFolderDialog({
              multiple: false,
              directory: false,
              filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
            });
            if (!chosen || Array.isArray(chosen)) return;
            const status = await linkRekordboxXml(chosen);
            toast(
              status.error
                ? "XML Rekordbox illisible — relie un autre fichier"
                : `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderRekordboxLive();
          } catch (e) {
            console.error("link_rekordbox_xml failed", e);
            toast("Liaison du XML Rekordbox échouée");
          }
        })();
        return;
      } else if (act === "qual") {
        const q = bibEl.dataset.q;
        bibState.filter.quality = q === "all" ? undefined : (q as "lossless" | "mp3");
        // "Tous" doit réellement tout montrer — sans ce reset, un filtre verdict=fake posé via le
        // stat-card "À re-sourcer" restait actif indéfiniment (cul-de-sac trouvé à l'audit 2026-07-09).
        if (q === "all") bibState.filter.verdict = undefined;
        void renderBiblioLive();
      } else if (act === "facet") {
        bibState.facet = bibEl.dataset.f === "genre" ? "genre" : "folder";
        // Toggle in place first (existing node, animates) — renderBiblioLive() is async (IPC),
        // so the browser paints this before the rebuild overwrites the DOM.
        document
          .querySelectorAll<HTMLElement>("#sift-bib-facet-seg [data-bib='facet']")
          .forEach((b) => b.classList.toggle("on", b.dataset.f === bibState.facet));
        positionFacetThumb();
        void renderBiblioLive();
      } else if (act === "viewmode") {
        bibState.viewMode = bibEl.dataset.mode === "grid" ? "grid" : "table";
        document
          .querySelectorAll<HTMLElement>("#sift-bib-viewmode-seg [data-bib='viewmode']")
          .forEach((b) => b.classList.toggle("on", b.dataset.mode === bibState.viewMode));
        positionViewModeThumb();
        void renderBiblioLive();
      } else if (act === "sort") {
        const field = bibEl.dataset.field as LibrarySortState["field"];
        bibState.sort =
          bibState.sort.field === field
            ? { field, dir: bibState.sort.dir === "asc" ? "desc" : "asc" }
            : { field, dir: "asc" };
        void renderBiblioLive();
      } else if (act === "pick") {
        const key = bibEl.dataset.key as "folder" | "genre" | "artist";
        const val = bibEl.dataset.val;
        // toggle off if re-clicking the active facet value
        const cur =
          key === "folder" ? bibState.filter.folder : key === "genre" ? bibState.filter.genre : bibState.filter.artist;
        const next = cur === val ? undefined : val;
        bibState.filter.folder = key === "folder" ? next : undefined;
        bibState.filter.genre = key === "genre" ? next : undefined;
        bibState.filter.artist = key === "artist" ? next : undefined;
        void renderBiblioLive();
      } else if (act === "link") {
        const rid = bibEl.dataset.rid;
        if (rid) void openUrl(`https://www.discogs.com/release/${rid}`);
      } else if (act === "play" || act === "row" || act === "identify") {
        // Open the unified detail/edit panel (report + inline editor + identify + actions).
        openBiblioDetail(Number(bibEl.dataset.id));
      } else if (act === "dupscan") {
        dupShown = !dupShown;
        if (dupShown && dupGroups === null) {
          dupLoading = true;
          void renderBiblioLive();
          void scanLibraryDuplicates()
            .then((groups) => {
              dupGroups = groups;
            })
            .catch((e) => {
              console.error("scan_library_duplicates failed", e);
              dupGroups = [];
            })
            .finally(() => {
              dupLoading = false;
              void renderBiblioLive();
            });
        } else {
          void renderBiblioLive();
        }
      } else if (act === "dupresolve") {
        const idx = Number(bibEl.dataset.idx);
        const group = dupGroups?.[idx];
        if (!group) return;
        const losers = group.members.filter((m) => !m.recommend_keep).map((m) => m.id);
        void confirmAction(
          `Envoyer ${losers.length} doublon${losers.length > 1 ? "s" : ""} à la corbeille ? Le morceau recommandé est conservé.`,
          "Envoyer à la corbeille",
        ).then((ok) => {
          if (!ok) return;
          void Promise.all(losers.map((id) => trashTrack(id)))
            .then(() => {
              dupGroups = (dupGroups || []).filter((_, i) => i !== idx);
              return renderBiblioLive();
            })
            .catch((e) => {
              console.error("dupresolve failed", e);
              toast("Échec : impossible d'envoyer les doublons à la corbeille");
            });
        });
      }
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sift]");
    if (!el) return;
    const act = el.dataset.sift;
    if (act === "addsrc") {
      e.stopPropagation();
      void pickAndAddFolder(refresh);
    } else if (act === "rmsrc") {
      e.stopPropagation();
      void removeSource(Number(el.dataset.id)).then(refresh);
    } else if (act === "togglewatch") {
      e.stopPropagation();
      void setSourceWatched(
        Number(el.dataset.id),
        el.dataset.watched !== "1",
      ).then(refresh);
    } else if (act === "setsrccolor") {
      e.stopPropagation();
      const hue = el.dataset.hue ?? null;
      void setSourceColor(Number(el.dataset.id), hue).then(refresh);
    } else if (act === "reviewmode") {
      e.stopPropagation();
      setReviewMode(el.dataset.m === "batch" ? "batch" : "detail");
    } else if (act === "batchpick") {
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
      setReviewMode("detail");
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
        return;
      }
      clearTimeout(batchConfirmTimer);
      batchConfirmArmed = null;
      // Adaptive dispatch. Combined (both ticked): file runs with its progress UI (Stop follows it);
      // discard fires in parallel as a fast fire-and-forget — IDs captured before clear.
      if (batchSel.size && batchFakeSel.size) {
        const discardIds = [...batchFakeSel];
        batchFakeSel.clear();
        void runBatchFile();
        void rejectBatch(discardIds).catch((err: unknown) =>
          console.error("reject_batch (combined) failed", err),
        );
      } else if (batchSel.size) {
        void runBatchFile();
      } else if (batchFakeSel.size) {
        void runBatchDiscard();
      }
    } else if (act === "batchstop") {
      e.stopPropagation();
      onFileStop();
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
    }
  });

  // "File in place" checkbox (under the #fldz tree, batch mode) — a checkbox, so it needs change.
  requireEl("#pa", "installLiveWiring").addEventListener("change", (e) => {
    const ip = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-sift="inplace"]');
    if (ip) {
      batchInPlace = ip.checked;
      const fldz = document.getElementById("fldz");
      if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
      renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
    }
  });

  // queue:changed fires once per burst source (watcher debounce window, each scanned source's
  // own background thread) — debounce the redraw the same way onAnalysisChanged does below.
  let queueChangeTimer: ReturnType<typeof setTimeout> | undefined;
  void onQueueChanged(() => {
    clearTimeout(queueChangeTimer);
    queueChangeTimer = setTimeout(() => void refresh(), 150);
  });
  void onFileDone(onFileBatchDone);
  void onFileProgress(pushFileProgress);
  // Stop button on the global zone's "file" row → stop-net cancel of the running filing batch.
  setCancelHandler("file", onFileStop);

  // Analysis pings can arrive several times per second — debounce the queue redraw.
  let t: ReturnType<typeof setTimeout> | undefined;
  // Throttle the progress-zone IPC+render: coalesce bursts to one RAF per frame (~16 ms).
  // Events are never dropped — only renders are coalesced. A trailing 350 ms timeout
  // guarantees a final render once pings stop (catches the done==total transition).
  let pendingAnalyzeRender = false;
  let analyzeTrailTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleAnalyzeRender() {
    // Reset the trailing timer on every event so it fires only after silence.
    clearTimeout(analyzeTrailTimer);
    analyzeTrailTimer = setTimeout(() => void pushAnalyzeProgress(), 350);
    if (pendingAnalyzeRender) return;
    pendingAnalyzeRender = true;
    requestAnimationFrame(() => {
      pendingAnalyzeRender = false;
      void pushAnalyzeProgress();
    });
  }
  void onAnalysisChanged(() => {
    // A report may have changed (re-analysed / replaced file) → drop the in-session cache so
    // the next open re-fetches from the DB (the source of truth) instead of serving it stale.
    void import("./report-view").then((m) => m.clearReportCache());
    // Throttle progress-zone update: IPC + DOM render at most once per RAF frame (~16 ms),
    // not once per event (can be dozens per second during a 4000-track analysis burst).
    scheduleAnalyzeRender();
    clearTimeout(t);
    // touchDetail=false: redraw the queue list only; never re-open the open track (that aborts
    // the player's audio load).
    t = setTimeout(() => void renderQueue(false), 300);
  });

  // Catch an analysis already in flight when the app opens (events only fire on each item after).
  void pushAnalyzeProgress();
  void refresh();
}

declare global {
  interface Window {
    __siftHome?: () => void;
    __siftQueue?: () => void;
    __siftEcarts?: () => void;
    __siftReglages?: () => void;
    __siftBiblio?: () => void;
    __siftJournal?: () => void;
    __siftRkb?: () => void;
  }
}
