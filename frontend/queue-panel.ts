// Revue queue panel — virtualization, keyboard nav, search, row rendering, and Détail/Lot mode
// state. Extracted from sift-live.ts (Phase 1, tranche 1b). currentItems/currentOpenId/reviewMode
// are owned here — all their reassignments already lived in this code before the move. The batch
// controller (tranche 1c) imports these as read values and calls setReviewMode() to mutate mode,
// never reassigns directly (ES module import bindings are read-only from outside this file).
import { listQueue, reanalyzeTracks } from "./ipc";
import { openFilingInto, syncDetail } from "./filing";
import { refreshBins, clearBinPick } from "./filing-bins";
import { homeProgressZone } from "./progress-zone";
import { MAX_ANALYSIS_ATTEMPTS, type QueueItem } from "../shared/contracts";
import { confirmAction } from "./confirm-modal";
import { requireEl, esc } from "./dom";
import { toast } from "./filing-toast";
import { filingFailure, isFilingInFlight, onFilingOutcome } from "./filing-state";

/** A pending track still worth (re)analysing: no current verdict AND not yet terminally broken.
 *  Single source of truth for the "Non analysés" count, filter, and bulk-retry set — a track that
 *  has failed MAX_ANALYSIS_ATTEMPTS times keeps its per-row manual retry (see queueRowHtml) but no
 *  longer inflates the count, so it can actually reach zero on a library with an unrepairable file. */
function isRetryableUnanalyzed(it: QueueItem): boolean {
  return it.needs_analysis && it.analysis_attempts < MAX_ANALYSIS_ATTEMPTS;
}
function unanalyzedItems(): QueueItem[] {
  return currentItems.filter(isRetryableUnanalyzed);
}

// Track ids whose reanalyze IPC is in flight, and whether the bulk retry is running. Rendered FROM
// this state (queueRowHtml / the button labels) rather than by mutating DOM nodes directly: the
// queue rail is rebuilt via innerHTML on every queue:changed, so a spinner written onto a button
// node was landing on a detached element and the visible (fresh) row looked idle mid-retry.
const reanalyzingIds = new Set<number>();
let bulkReanalyzing = false;

/** Re-render just the visible queue window (used to reflect in-flight retry state changes). */
function rerenderQueueWindow(): void {
  const ql = document.getElementById("ql");
  if (ql) renderQueueWindow(ql);
}

// Latest live queue items, kept so a queue-row click can recover the full item (id +
// verdict) the filing pane needs.
export let currentItems: QueueItem[] = [];

// True when `currentItems` is known to no longer reflect the backend, so the "repaint from cache"
// fast path below must NOT be taken. Set when a background conversion fails (P5): that track was
// filtered out of `currentItems` while in flight and has to come back, but nothing else will ever
// invalidate the cache for it — the conversion failed, so the backend emits no `queue:changed`.
// Without this, navigating away and back repaints the stale (filtered) cache and the track stays
// invisible for the rest of the session.
let queueCacheStale = false;

// Single source of truth for which queue row shows `.cur` — NOT read from filing.ts's internal
// state (would risk a race: filing.ts may set its own state before this module's DOM catches up).
// Updated in 3 places: the row click handler, renderQueue's touchDetail branch (via syncDetail's
// return value), and stepQueueSelection (Task 4).
let currentOpenId: number | null = null;

const QUEUE_ROW_BUFFER = 15; // rows rendered above/below the visible window

let queueRowHeightCache: number | null = null;

// Live filter on the queue rail (annotation: "on veut une barre de recherche en bas — filtre
// client sur la file affichée uniquement, titre/artiste, pas de recherche backend"). Filters
// currentItems only — never touches listQueue()/the DB. currentOpenId/stepQueueSelection walk
// this filtered view too, so arrow-key nav only steps through what's actually visible.
let queueSearchTerm = "";

// Optional "Non analysés uniquement" filter — surfaces tracks stuck in/awaiting background
// analysis (QueueItem.needs_analysis, mirroring worker::select_pending's own condition exactly —
// see the field's doc comment in shared/contracts.ts for why this is NOT the same as
// `verdict === null`, a review-flagged bug caught after this filter first shipped) so a problem
// file doesn't get lost in a large pending list. OFF by default: the default view is the FULL
// pending queue (everything not yet filed/écarté — "pending" is a single backend lifecycle
// status, `actions.rs` inserts a scanned file as `status='pending'` before analysis even runs,
// and it stays `pending` regardless of whether analysis has resolved). Corrected 2026-07-20 (live
// bug report): this used to be an ON-by-default "+N traités" toggle keyed on `verdict !== null`,
// which confused "the background analyzer already produced a verdict for this file" with "the
// user already reviewed/filed it" — on a library where analysis runs quickly, that hid
// essentially the ENTIRE pending queue by default, showing "Tous les morceaux ont été traités."
// while thousands of genuinely not-yet-reviewed tracks sat hidden behind the toggle.
let queueUnanalyzedOnly = false;

function visibleQueueItems(): QueueItem[] {
  // Search deliberately searches ALL items regardless of the analysis filter — limiting search
  // results to whatever's currently shown would silently return 0 hits for an analyzed track
  // while unanalyzed-only is on, which reads as a bug ("I searched but it's not there") rather
  // than the filter doing its job.
  const base = queueSearchTerm
    ? currentItems
    : queueUnanalyzedOnly
      ? unanalyzedItems()
      : currentItems;
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
  probe.className = "qi";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = "100%";
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
    // "File vide." reads as "nothing was ever here" — misleading when a track is still
    // shown in Detail (currentOpenId set) because it's the last one just treated and the
    // pane hasn't advanced away from it yet. Finding F4, audit-heuristique-visuel.md.
    const emptyLabel =
      currentItems.length && queueSearchTerm
        ? "Aucun morceau ne correspond."
        : currentItems.length && queueUnanalyzedOnly
          ? "Tous les morceaux en file sont déjà analysés."
          : currentOpenId != null
            ? "Tous les morceaux ont été traités."
            : "File vide.";
    ql.innerHTML =
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">${emptyLabel}</div>`;
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

/** One-time (guarded) scroll listener on #ql, rAF-throttled: re-renders the visible window on
 * scroll without doing so on every fired scroll event (which can be dozens per second).
 *
 * Guarded on the NODE itself, not on a module boolean: app.js's renderRevue() rebuilds the whole
 * screen with `content.innerHTML = …` on every nav to Revue, so #ql is a BRAND NEW element each
 * time. A module flag stayed true across that rebuild, leaving the listener attached to the
 * detached old node — after one nav round-trip the visible list never re-rendered on scroll
 * (virtualized rows past the first window stayed blank). A fresh node carries no marker, so it
 * gets wired; the same node re-passed (every renderQueue call) is skipped as before. */
function ensureQueueScroll(ql: HTMLElement): void {
  if (ql.dataset.siftScrollWired) return;
  ql.dataset.siftScrollWired = "1";
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
export function prefetchNextAfter(id: number): void {
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
function stepQueueSelection(delta: 1 | -1): void {
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
    if (reviewMode === "batch") enterDetailMode();
    const mid = document.getElementById("mid");
    if (mid) {
      void openFilingInto(mid, next);
      prefetchNextAfter(next.id);
    }
  }, 150);
}

/** Guarded so installLiveWiring can call this once even if it ever re-runs. */
let queueNavKeysWired = false;
export function installQueueNavKeys(): void {
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
export let reviewMode: "detail" | "batch" = "detail";

// Verdict = meaning only, vert/ambre uniquement (voir brief refonte 2026-07) — jamais un hex en
// dur ici (l'ancien `#e2685e` rouge cassait cette règle) : lire les tokens CSS, pas une 3e teinte.
const VERDICT_DOT: Record<string, [string, string]> = {
  ok: ["var(--color-text-success)", "authentique"],
  fake: ["var(--color-text-warning)", "faux / sur-encodé"],
  grey: ["var(--color-text-warning)", "zone grise"],
};
export function verdictDot(v: string | null): string {
  if (v && VERDICT_DOT[v]) {
    const [c, title] = VERDICT_DOT[v];
    return `<span title="${title}" style="flex:none;width:9px;height:9px;border-radius:50%;background:${c}"></span>`;
  }
  // not analysed yet
  return `<span title="en attente d'analyse" style="flex:none;width:9px;height:9px;border-radius:50%;border:1.5px solid var(--color-text-tertiary);box-sizing:border-box"></span>`;
}

// `it` needs analysis_attempts to distinguish "still in the pipeline" from "terminally failed"
// (>= MAX_ANALYSIS_ATTEMPTS) — same distinction batch-panel's pendingRow() already makes; before
// this fix Detail mode showed "analyse…" for both, mislabelling a give-up as forever-in-progress.
function verdictWord(it: Pick<QueueItem, "verdict" | "analysis_attempts">): [string, string] {
  const v = it.verdict;
  return v === "fake"
    ? ["faux", "var(--color-text-warning)"]
    : v === "grey"
      ? ["à vérifier", "var(--color-text-warning)"]
      : v === "ok"
        ? ["", "var(--color-text-success)"]
        : it.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS
          ? ["échec", "var(--color-text-warning)"]
          : ["analyse…", "var(--color-text-tertiary)"];
}

/** One queue row's markup. `active` stamps the `.cur` highlight at creation time — required so
 * the highlight survives virtualization (Task 2): once #ql only mounts the visible window, a
 * row for the open track may not exist in the DOM to be found and classed after the fact. */
function queueRowHtml(it: QueueItem, active: boolean): string {
  const [word, wordColor] = verdictWord(it);
  // A conversion that failed in the background (P5/D5) outranks the analysis verdict on the row:
  // it is the one thing about this track the user must see, and it has to survive navigation — it
  // is re-read from filing-state on every paint, so leaving Revue and coming back keeps it.
  const failure = filingFailure(it.id);
  const title = esc(it.filename || it.path);
  const artist = it.artist ? esc(it.artist) : "";
  return (
    `<div class="qi${active ? " cur" : ""}" data-id="${it.id}" data-path="${esc(it.path)}" title="Écouter et convertir" style="cursor:pointer">` +
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
    (failure
      ? `<span title="${esc(failure)}" style="flex:none;display:inline-flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--color-text-warning)"><i class="ti ti-alert-triangle"></i>conversion échouée</span>`
      : word
        ? `<span style="flex:none;font-size:var(--text-xs);color:${wordColor}">${word}</span>`
        : "") +
    // Only for a not-yet-analysed row — retry a track stuck without a verdict (e.g. a
    // transient decode error on first pass) instead of leaving it silently unreachable.
    // data-reanalyze is checked BEFORE the .qi row-open branch in the delegated click handler
    // (sift-live.ts) so clicking it never also opens the track. Shown for every needs_analysis row
    // (incl. terminally-broken ones dropped from the count) so a manual retry stays reachable.
    // The in-flight spinner is rendered FROM reanalyzingIds, never by mutating the button node —
    // the rail is rebuilt on every queue:changed, which would otherwise strand the spinner on a
    // detached element.
    (it.needs_analysis
      ? reanalyzingIds.has(it.id)
        ? `<button data-reanalyze="${it.id}" class="lk-icon" title="Réanalyse en cours" disabled aria-label="Réanalyse en cours"><i class="ti ti-loader-2 sift-spin"></i></button>`
        : `<button data-reanalyze="${it.id}" class="lk-icon" title="Réanalyser ce morceau" aria-label="Réanalyser ce morceau"><i class="ti ti-refresh"></i></button>`
      : "") +
    `</div>`
  );
}

/** Replaces the mockup queue list with real pending items (Revue screen). */
export async function renderQueue(touchDetail = true) {
  const ql = document.getElementById("ql");
  if (!ql) return;

  // Live destination bins + neutral detail prompt (replace the mockup's hardcoded ones).
  const fldz = requireEl("#fldz", "renderQueue");
  void refreshBins(fldz);

  // Returning to Revue after visiting another screen: app.js's renderRevue rebuilds
  // #qcol/#ql/#mid from scratch on every nav click (content.innerHTML, unconditional), even
  // though currentItems already holds a freshly-loaded queue in memory — only the DOM was wiped,
  // not the state. Detect that exact case (freshly (re)created empty #ql + state already loaded)
  // and paint synchronously from the cached currentItems instead of flashing "Chargement…" and
  // re-issuing a full listQueue() IPC round-trip on every tab switch. Real data changes keep
  // arriving through the backend's "queue:changed" event (onQueueChanged → refresh(),
  // sift-live.ts) independently of navigation — a genuine change while #ql already has rows still
  // falls through to the full reload below, same as before.
  if (!ql.childElementCount && currentItems.length && !queueCacheStale) {
    ensureReviewSeg();
    const qcol = document.getElementById("qcol");
    if (qcol) {
      ensureQueueDoneToggle(qcol);
      ensureQueueSearch(qcol);
    }
    if (touchDetail) {
      if (reviewMode === "batch") {
        batchRenderer?.();
      } else {
        const mid = requireEl("#mid", "renderQueue");
        if (mid) {
          currentOpenId = syncDetail(mid, currentItems);
        }
      }
    }
    renderQueueWindow(ql);
    ensureQueueScroll(ql);
    // The rail and the Revue nav badge must never disagree: this repaint is a delivery of the
    // queue too (from cache), and refresh() — the only other caller of updateRevueBadge — does
    // not run on a plain navigation. Without this the badge keeps the count from the last
    // refresh() while the rail already shows one row less (a track converting in the background).
    updateRevueBadge(currentItems.length);
    return;
  }

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
  // P5 (PRD 2026-07-27, D3): a track whose conversion is still running in the background has left
  // the user's loop, but it is still `pending` backend-side (it only becomes `filed` once the encode
  // commits), so list_queue keeps returning it. Dropping it HERE — the single point where the front
  // takes delivery of the queue — is what stops the auto-advance from re-opening it and the user
  // from converting it a second time, in the rail as well as in Lot mode (both read currentItems).
  // It comes back on its own if the conversion fails: see the onFilingOutcome subscription below.
  items = items.filter((it) => !isFilingInFlight(it.id));
  currentItems = items;
  // This IS the fresh delivery the stale flag was waiting for, and the single point where the
  // front takes the queue in — so it is also where the badge is brought back in step with the rail.
  queueCacheStale = false;
  updateRevueBadge(currentItems.length);
  ensureReviewSeg();
  const qcol = document.getElementById("qcol");
  if (qcol) {
    ensureQueueDoneToggle(qcol);
    ensureQueueSearch(qcol);
  }
  // Background-analysis progress moved to the global progress zone (bottom of #nav, persistent
  // across views) — see pushAnalyzeProgress, fed by the analysis:changed event below.

  // Only sync the detail pane on structural changes (nav, queue add/remove/file). A background
  // ANALYSIS finishing must NOT re-open / switch the open track — that thrashes and aborts the
  // player's audio load (waveform shows from peaks, but no sound). See touchDetail=false caller.
  if (touchDetail) {
    // Live destination bins + neutral detail prompt (replace the mockup's hardcoded ones). Gated
    // on touchDetail like the pane sync: the bins are the library root + its folders on disk
    // (loadBins → getSetting + list_bins), which a background analysis finishing cannot change.
    // list_bins walks the WHOLE library root recursively backend-side, so leaving this ungated
    // ran a full recursive directory scan on every 300ms analysis-progress redraw.
    const fldz = requireEl("#fldz", "renderQueue");
    void refreshBins(fldz);
    if (reviewMode === "batch") {
      batchRenderer?.();
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

/** Detail|Batch segmented control (board `topseg`), injected once at the top of the queue
 * column. Owned here (not app.js) so it works inside Tauri where the live wiring renders the
 * Revue. Reflects `reviewMode`; clicks are handled in the #pa delegate. */
export function ensureReviewSeg() {
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

/** "Non analysés uniquement" filter toggle — surfaces tracks still waiting on/stuck in background
 * analysis, without hiding the rest of the pending queue by default (see queueUnanalyzedOnly's
 * doc comment for why the prior default-hide behavior was wrong). Injected once, right after #ql
 * (before the search bar — call order in renderQueue matters here, both are appended to `qcol`).
 * Hidden entirely when there's nothing unanalyzed to filter down to. */
function ensureQueueDoneToggle(qcol: HTMLElement): void {
  let el = document.getElementById("sift-qdone-toggle");
  if (!el) {
    el = document.createElement("button");
    el.id = "sift-qdone-toggle";
    el.className = "sift-qdone-toggle";
    el.addEventListener("click", () => {
      queueUnanalyzedOnly = !queueUnanalyzedOnly;
      const ql = document.getElementById("ql");
      if (ql) {
        ql.scrollTop = 0;
        renderQueueWindow(ql);
      }
      ensureQueueDoneToggle(qcol); // relabel + re-evaluate hidden state
    });
    qcol.appendChild(el);
  }
  const unanalyzedCount = unanalyzedItems().length;
  // Nothing left to filter down to: hide the toggle AND clear the filter. Leaving it ON while the
  // control that turns it off is hidden would strand the user in an empty filtered view over a full
  // pending queue with no way back (module state survives navigation) — review-caught regression.
  if (unanalyzedCount === 0 && queueUnanalyzedOnly) {
    queueUnanalyzedOnly = false;
    rerenderQueueWindow();
  }
  el.hidden = unanalyzedCount === 0;
  el.textContent = queueUnanalyzedOnly
    ? "Tout afficher"
    : `Non analysés uniquement (${unanalyzedCount})`;
  ensureQueueReanalyzeAllButton(qcol, unanalyzedCount);
}

/** Confirmation threshold for the bulk retry — a few stuck tracks retry on one click, but a mass
 *  reset (e.g. a whole fresh import still showing as unanalysed) requires an in-app confirmation
 *  (CLAUDE.md: destructive/costly actions never fire unguarded). */
const BULK_REANALYZE_CONFIRM_THRESHOLD = 10;

/** Add/remove ids from the in-flight retry set and re-render so the row spinner reflects it.
 *  Exported for the per-row retry handler in sift-live.ts (the bulk button uses them internally). */
export function beginReanalyze(ids: number[]): void {
  for (const id of ids) reanalyzingIds.add(id);
  rerenderQueueWindow();
}
export function endReanalyze(ids: number[]): void {
  for (const id of ids) reanalyzingIds.delete(id);
  rerenderQueueWindow();
}

/** "Réanalyser (N)" — retries every currently-unanalysed track in one click, regardless of
 * whether the "Non analysés uniquement" filter is on. Sibling of the filter toggle, same
 * hidden-when-nothing-to-act-on rule. */
function ensureQueueReanalyzeAllButton(qcol: HTMLElement, unanalyzedCount: number): void {
  let el = document.getElementById("sift-qreanalyze-all") as HTMLButtonElement | null;
  if (!el) {
    el = document.createElement("button");
    el.id = "sift-qreanalyze-all";
    el.className = "sift-qdone-toggle";
    el.addEventListener("click", async () => {
      if (bulkReanalyzing) return; // already running — ignore re-clicks
      const ids = unanalyzedItems().map((it) => it.id);
      if (!ids.length) return;
      if (
        ids.length >= BULK_REANALYZE_CONFIRM_THRESHOLD &&
        !(await confirmAction(
          `Réanalyser ${ids.length} morceaux ? Leur analyse en cache est effacée et recalculée.`,
          "Réanalyser",
        ))
      ) {
        return;
      }
      bulkReanalyzing = true;
      beginReanalyze(ids);
      ensureQueueDoneToggle(qcol); // reflect "Relance…" + disabled
      try {
        await reanalyzeTracks(ids);
        // queue:changed (emitted unconditionally by the backend) drives the queue re-render.
        toast(`${ids.length} morceau${ids.length > 1 ? "x" : ""} réanalysé${ids.length > 1 ? "s" : ""}`);
      } catch (e) {
        console.error("reanalyze_tracks failed", e);
        // Humanized fallback (audit UX/accessibilité 2026-07-24) — raw error kept in console.error
        // above only; same pattern as filing-identify.ts's doApplyTags/doUndoApply.
        toast("Échec de la réanalyse — réessaie");
      } finally {
        bulkReanalyzing = false;
        endReanalyze(ids);
        ensureQueueDoneToggle(qcol); // re-label + re-enable from the settled state
      }
    });
    qcol.appendChild(el);
  }
  el.hidden = unanalyzedCount === 0;
  // State-driven, not a mid-flight eager re-enable: the button is disabled iff a bulk retry is
  // actually running (bulkReanalyzing), so a queue:changed re-render during the retry can't flip it
  // back to enabled under the in-flight handler (review-caught double-submit race).
  el.disabled = bulkReanalyzing;
  el.textContent = bulkReanalyzing ? "Relance…" : `Réanalyser (${unanalyzedCount})`;
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

/** Fill the Review nav badge with the pending count (board's "Revue [18]"). Runs from refresh()
 * — i.e. on every queue change, on any screen — so it's correct even off the Revue view. Empty
 * text collapses the pill via the `.nav-badge:empty` CSS rule. `count` is the queue length
 * `renderQueue` just fetched — no redundant `listQueue()` re-fetch here. */
export function updateRevueBadge(count: number) {
  const badge = requireEl<HTMLElement>('.nav-badge[data-badge="revue"]', "updateRevueBadge");
  badge.textContent = count ? String(count) : "";
}

// Debounces the heavy report/audio-decode load triggered by a queue-row selection (click or
// ↑/↓, which dispatches a real .click() — see installFilingKeys). Flicking through several
// rows fast would otherwise fire a full fetch+decodeAudioData per row, most immediately
// discarded. Row highlighting itself stays instant — only this load is deferred.
let queueSelectTimer: ReturnType<typeof setTimeout> | undefined;

/** Queue row click (Revue): opens the filing pane after a 150ms debounce (flicking through rows
 *  fast must not fire a decode+fetch per row). Extracted from installLiveWiring's #pa click
 *  listener (Phase 1, tranche 1b) — same split as handleRekordboxAction (tranche 1a): the state
 *  this reads/writes (currentItems, currentOpenId, reviewMode) already lives in this module. */
export function handleQueueItemClick(qi: HTMLElement, e: MouseEvent): void {
  e.stopPropagation();
  // In batch mode a row-click means "inspect this one" → drop back to the detail pane.
  if (reviewMode === "batch") enterDetailMode();
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
}

/** Raw reviewMode mutator, no side effects — used by sift-live.ts's setReviewMode for the
 *  "batch" branch, which needs batch-owned code (renderBatch, batchGroupCap) this module must
 *  never import (Phase 1, tranche 1b: see the coupling analysis in the plan's Architecture
 *  section). Only enterDetailMode() below calls this internally for the "detail" case. */
export function setReviewModeRaw(m: "detail" | "batch"): void {
  reviewMode = m;
}

/** The "detail" branch of the old setReviewMode, extracted verbatim — it never touched batch
 *  state, so unlike the "batch" branch it can live here. Called directly by queue code
 *  (handleQueueItemClick, stepQueueSelection) and by sift-live.ts's setReviewMode when switching
 *  away from batch mode. */
export function enterDetailMode(): void {
  // Fail-fast assertion restored from the original setReviewMode, which ran this
  // unconditionally before branching on mode (result unused here — batch branch
  // was the only one that needed #fldz's value).
  requireEl("#fldz", "enterDetailMode");
  setReviewModeRaw("detail");
  ensureReviewSeg();
  // Leave batch pick mode: tree reverts to detail's state.binRel. No manual opacity/checkbox
  // cleanup needed — renderBins (filing.ts) always re-derives .sift-fldz-tree's opacity from
  // the current binPick (null in detail) and renders the one shared in-place checkbox itself.
  clearBinPick();
  // Return the progress zone to its left-sidebar home (it was relocated into the batch rail).
  homeProgressZone();
  void renderQueue(true);
}

// A background conversion just settled (P5). On FAILURE the track is still `pending` and must
// reappear in the file with its marker — it was filtered out of currentItems while in flight, so a
// window re-render alone would not bring it back: re-fetch. `touchDetail: false` on purpose, the
// user is somewhere else by now and the pane they are looking at must not be hijacked (same reason
// the analysis-tick refresh passes false). On SUCCESS nothing is done here: the backend emits
// `queue:changed`, whose existing handler already refreshes the whole view.
onFilingOutcome((o) => {
  if (!o.error) return;
  // Mark the cache stale BEFORE re-rendering: off the Revue screen `#ql` does not exist and
  // renderQueue returns at once, so the re-fetch below may not happen at all. The flag is what
  // makes the NEXT paint (on returning to Revue) take the full reload path instead of repainting
  // the cache this track was filtered out of.
  queueCacheStale = true;
  void renderQueue(false);
});

let batchRenderer: (() => void) | null = null;

/** Registers the batch panel's render function so renderQueue's "reviewMode === batch" branch can
 *  trigger it without a static import — queue-panel.ts must never import from sift-live.ts (see
 *  the plan's Architecture section, 2nd occurrence of the same coupling). Call once from
 *  installLiveWiring, before any queue interaction is possible. */
export function registerBatchRenderer(fn: () => void): void {
  batchRenderer = fn;
}
