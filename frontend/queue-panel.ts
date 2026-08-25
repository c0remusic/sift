// Revue queue panel — virtualization, keyboard nav, search, row rendering, and Détail/Lot mode
// state. Extracted from sift-live.ts (Phase 1, tranche 1b). currentItems/currentOpenId/reviewMode
// are owned here — all their reassignments already lived in this code before the move. The batch
// controller (tranche 1c) imports these as read values and calls setReviewMode() to mutate mode,
// never reassigns directly (ES module import bindings are read-only from outside this file).
//
// `reviewMode` reste ici, mais son COMMUTATEUR n'est plus dans cette colonne : le segmenté
// Détail / Lot a été retiré le 2026-08-25 (spec `docs/ui-specs/revue.md` §§ Zone A / Zone B′,
// décision du wireframe « Poste de décision »). Le mode Lot s'arme désormais par l'icône de
// sélection de la barre unifiée. Ne pas réintroduire d'onglet de mode dans #qcol.
import { listQueue, reanalyzeTracks } from "./ipc";
import { openFilingInto, syncDetail } from "./filing";
import { refreshBins, clearBinPick } from "./filing-bins";
import { homeProgressZone } from "./progress-zone";
import { MAX_ANALYSIS_ATTEMPTS, type QueueItem } from "../shared/contracts";
import { confirmAction } from "./confirm-modal";
import { requireEl, esc } from "./dom";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { filingFailure, isFilingInFlight, onFilingOutcome } from "./filing-state";
import { isBatchSheetOpen } from "./batch-sheet";
import { anchoredBelowPosition } from "./popover-position";

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

/** Source dont la file est filtrée, ou `null` pour tout voir. Au niveau module : le filtre survit
 *  aux re-rendus de la file (progression d'analyse, événement `queue:changed`) et ne doit tomber
 *  que sur une action explicite. */
let queueSourceFilter: number | null = null;

/** Restreint la file à une source, ou lève le filtre avec `null`. Rend la valeur appliquée pour
 *  que l'appelant puisse marquer l'entrée de rail correspondante sans relire l'état d'ici. */
export function setQueueSourceFilter(id: number | null): number | null {
  queueSourceFilter = id;
  queueCacheStale = true; // le cache tient la file NON filtrée : le repeindre ignorerait le filtre
  return queueSourceFilter;
}

/** La source filtrée, pour que le rail sache quelle entrée marquer active. */
export function activeQueueSource(): number | null {
  return queueSourceFilter;
}

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

// Filtre par facettes (UNION multi-critères) — cases cochées dans le popover « Filtrer ». Set au
// niveau module : survit aux re-rendus (poll 300ms, queue:changed), ne tombe que sur une action
// explicite (case décochée, « Tout afficher »). Vide = tout montrer. Critères dérivés de QueueItem,
// zéro Rust (verdict/rail/dup, shared/contracts.ts). « MP3 » = approximation `rail==="lossy"` :
// QueueItem n'a pas de champ format/extension, un MP3-vs-AAC exact exigerait un champ de contrat.
const queueFacetFilter = new Set<string>();
const QUEUE_FACETS: readonly { id: string; label: string; match: (it: QueueItem) => boolean }[] = [
  { id: "lossless", label: "Lossless", match: (it) => it.rail === "lossless" },
  { id: "mp3", label: "MP3", match: (it) => it.rail === "lossy" },
  { id: "fake", label: "Faux", match: (it) => it.verdict === "fake" },
  { id: "dup", label: "Doublons", match: (it) => it.dup },
];

/** UNION : un item passe s'il satisfait AU MOINS une facette active. Set vide = aucun filtre. */
function matchesFacet(it: QueueItem): boolean {
  if (queueFacetFilter.size === 0) return true;
  return QUEUE_FACETS.some((f) => queueFacetFilter.has(f.id) && f.match(it));
}

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
  const q = queueSearchTerm.toLowerCase();
  // Recherche (si présente) ET facettes (union) se composent : la recherche cherche dans tout
  // (ci-dessus), les facettes restreignent ; Set de facettes vide → matchesFacet rend true.
  return base.filter(
    (it) =>
      (!queueSearchTerm ||
        (it.filename ?? it.path).toLowerCase().includes(q) ||
        (it.artist ?? "").toLowerCase().includes(q) ||
        (it.title ?? "").toLowerCase().includes(q)) &&
      matchesFacet(it),
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

/** Compte de la rangée de filtre — « 5 pistes », à DROITE de l'en-tête (wireframe « Poste de
 *  décision » §§ 09-10). Il dit ce que la colonne MONTRE, donc il se lit sur `visibleQueueItems()`
 *  (recherche + facettes appliquées) et jamais sur `currentItems` : le total de la file, lui, est
 *  déjà porté par le badge du rail (`updateRevueBadge`) et par le titre de la barre unifiée.
 *
 *  Appelé depuis `renderQueueWindow`, donc sur le CHEMIN CHAUD de la colonne (poll de 300ms +
 *  scroll rAF-throttlé) : d'où la comparaison avant écriture — une affectation `textContent`
 *  identique reste une écriture DOM, et ce rendu est le point chaud du frontend. La comparaison
 *  interroge le NŒUD et non un cache au niveau module : la navigation recrée l'en-tête vide
 *  (`revueShell`, `content.innerHTML`), et un cache mémoire répondrait alors « déjà peint » sur une
 *  rangée qui n'affiche plus rien. */
function paintQueueCount(n: number): void {
  const el = document.getElementById("sift-qcount");
  if (!el) return;
  // Accord : 0 et 1 prennent le singulier en français, 2 et au-delà le pluriel. Même règle que le
  // compte jumeau de la Bibliothèque (`bibliotheque-view.ts`, `.sift-bib-count`).
  const label = `${n} piste${n > 1 ? "s" : ""}`;
  if (el.textContent !== label) el.textContent = label;
}

/** Ligne portant le CURSEUR CLAVIER de la file — celle d'où `stepQueueSelection` partirait, donc
 *  celle qui doit montrer l'anneau de focus (`.qi.kbd`, peint seulement sous `#ql:focus-visible`).
 *
 *  Ce n'est PAS `.cur` : `.cur` dit « cette piste est ouverte en zone C » (aplat + encre + graisse),
 *  le curseur dit « le clavier est ici » (anneau). Les deux coïncident après une flèche, mais se
 *  séparent dès que la piste ouverte sort de la vue filtrée (recherche, facettes) ou que le mode Lot
 *  supprime tout `.cur` (`highlightId` forcé à `null` plus bas) — d'où deux rendus distincts.
 *
 *  Repli sur la PREMIÈRE ligne visible quand la piste ouverte n'est pas dans la vue : c'est déjà là
 *  qu'un ↓ atterrit (`curIndex` vaut -1, donc `nextIndex` 0), et surtout ça garantit qu'un `#ql`
 *  focalisé montre TOUJOURS un anneau — un conteneur focusable sans focus visible serait un trou
 *  WCAG 2.4.7 créé par le `tabindex` qu'on vient de lui donner.
 *
 *  Coût sur le chemin chaud : un `some()` court-circuité sur la liste DÉJÀ filtrée, sauté
 *  entièrement quand rien n'est ouvert. Un cran sous le balayage de comptes des facettes
 *  (`paintQueueFacetButton`, O(file × facettes)) que ce même rendu paie déjà. */
function keyboardCursorId(items: QueueItem[]): number {
  const open = currentOpenId;
  if (open != null && items.some((it) => it.id === open)) return open;
  return items[0].id;
}

/** Renders only the rows within the visible scroll window (+ QUEUE_ROW_BUFFER above/below) into
 * `ql`, framed by two spacer divs so the scrollbar stays proportional to the full list. Fixes the
 * 7000+-track freeze (memory: sift-large-queue-black-screen) — rebuilding thousands of DOM nodes
 * on every 300ms analysis-progress redraw (see the onAnalysisChanged listener further down) was
 * the actual cost, not just paint. */
function renderQueueWindow(ql: HTMLElement): void {
  const items = visibleQueueItems();
  // Le compte de la rangée de filtre se lit sur CETTE liste, pas sur `currentItems` — d'où sa
  // peinture ici et pas ailleurs : c'est le seul point qui tient la liste réellement affichée.
  paintQueueCount(items.length);
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
    ql.removeAttribute("aria-activedescendant"); // plus aucune option : le curseur n'a plus de cible
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
  const cursorId = keyboardCursorId(items);
  const topSpacer = start * rowH;
  const bottomSpacer = (items.length - end) * rowH;
  let html = topSpacer > 0 ? `<div style="height:${topSpacer}px"></div>` : "";
  // Le curseur clavier est REPEINT à chaque fenêtre, jamais posé sur un nœud : `#ql` étant le seul
  // élément focusable (les lignes ne le sont pas), aucun re-rendu ne peut faire tomber le focus —
  // seul l'anneau se redessine, sur la ligne que ce passage vient de marquer.
  let cursorRendered = false;
  for (let i = start; i < end; i++) {
    const it = items[i];
    const onCursor = it.id === cursorId;
    if (onCursor) cursorRendered = true;
    html += queueRowHtml(it, it.id === highlightId, onCursor);
  }
  if (bottomSpacer > 0) html += `<div style="height:${bottomSpacer}px"></div>`;
  ql.innerHTML = html;
  // `aria-activedescendant` doit nommer un élément RÉELLEMENT monté : la virtualisation ne monte que
  // la fenêtre visible, donc un curseur resté hors fenêtre (l'utilisateur a scrollé loin) laisserait
  // l'attribut pointer sur un id absent du document. On le retire alors plutôt que de mentir.
  if (cursorRendered) ql.setAttribute("aria-activedescendant", `qi-${cursorId}`);
  else ql.removeAttribute("aria-activedescendant");
  // Même fait, versant visible. Un curseur hors fenêtre n'a AUCUN nœud à cercler, et `#ql` peut
  // pourtant garder le focus : Tab dans la file puis Fin/PagePrec la fait défiler nativement sans
  // le lâcher. Sans ce repli, le focus clavier deviendrait invisible — le trou WCAG 2.4.7 que le
  // `tabindex` de `#ql` a créé. La classe reporte alors l'anneau sur la colonne elle-même
  // (`#ql:focus-visible.ql-cursor-off`), et la première flèche le rend à sa ligne :
  // `stepQueueSelection` ramène la cible dans la fenêtre avant de repeindre.
  // Gratuit sur le chemin chaud — le booléen est déjà calculé par la boucle ci-dessus.
  ql.classList.toggle("ql-cursor-off", !cursorRendered);
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
    if (!(active instanceof HTMLElement) || active === document.body) return;
    // `#ql` EXEMPTÉ. Ce blur existe pour décrocher le focus d'un BOUTON avant qu'un raccourci agisse
    // (spec § Clavier : sinon Espace active le bouton focalisé EN PLUS de la lecture). La file, elle,
    // est la cible même de ↑/↓ : la flouter ici éteindrait l'anneau du curseur au premier appui,
    // c'est-à-dire exactement au moment où le clavier prend la main. Un `#ql` focalisé n'a d'ailleurs
    // aucune action par défaut à voler — son défilement natif est déjà coupé par le `preventDefault`
    // ci-dessous.
    if (active.id === "ql") return;
    active.blur();
  };
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // Liste de candidats Discogs ouverte (fork F) : là, ↑/↓ navigue la liste, pas la file. Gate sans
    // importer filing-state (règle d'import unidirectionnelle) ; la listbox gère ses propres flèches.
    if (t && t.closest(".sift-cands")) return;
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

  // Clic sur case de lot — intercepte avant le handler .qi générique (case dans une .qi).
  // Sur `document` : #qcol est reconstruit à chaque navigation, un listener posé dessus
  // disparaîtrait. Même motif que le keydown ci-dessus.
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.sift !== "queuepick") return;
    e.stopPropagation();
    const id = Number((e.target as HTMLElement).dataset.id);
    if (queueBatchSel.has(id)) queueBatchSel.delete(id);
    else queueBatchSel.add(id);
    const ql = document.getElementById("ql");
    if (ql) renderQueueWindow(ql);
  });

  // Clic droit sur une ligne de file en mode Lot — menu contextuel d'action de lot.
  // Sur `document` (pas sur #qcol) : #qcol est reconstruit à chaque navigation, un listener
  // posé dessus disparaîtrait ; `document` est la racine stable de tous les gestionnaires
  // délégataires de cette colonne (même motif que le keydown ci-dessus).
  document.addEventListener("contextmenu", (e) => {
    if (reviewMode !== "batch") return;
    const qi = (e.target as HTMLElement).closest<HTMLElement>(".qi");
    if (!qi) return;
    e.preventDefault();
    const id = Number(qi.dataset.id);
    // Assure que la piste cliquée est dans la sélection
    if (!queueBatchSel.has(id)) { queueBatchSel.add(id); }
    const n = queueBatchSel.size;
    void import("./context-menu").then(({ openContextMenu }) => {
      void import("./batch-panel").then(({ handleBatchQueueAction }) => {
        openContextMenu(e.clientX, e.clientY, [
          { label: `Ranger ${n} piste${n > 1 ? "s" : ""}`, onPick: () => handleBatchQueueAction("file") },
          { label: `Écarter ${n} piste${n > 1 ? "s" : ""}`, danger: true, onPick: () => handleBatchQueueAction("discard") },
        ]);
      });
    });
    const ql = document.getElementById("ql");
    if (ql) renderQueueWindow(ql);
  });
}

// Review mode: "detail" = one track at a time (filing pane), "batch" = triage many at once
// (board's Detail|Batch segmented control). `batchSel` holds the ticked track ids; it is
// pruned to the currently-ready set on every batch render so a filed/removed id can't linger.
export let reviewMode: "detail" | "batch" = "detail";

/** Tracks sélectionnés dans la colonne de file pour le mode Lot.
 *  Distinct de batchSel (batch-panel.ts) — source de vérité pour la sélection de file.
 *  Exporté pour être lu par batch-panel et selection-summary. */
export const queueBatchSel = new Set<number>();

/** Pré-sélectionne tous les items avec verdict != null au passage en mode Lot.
 *  Appelé par sift-live.ts au moment d'armer le mode. */
export function initQueueBatchSel(items: QueueItem[]): void {
  queueBatchSel.clear();
  for (const it of items) {
    if (it.verdict !== null) queueBatchSel.add(it.id);
  }
}

// Verdict = sens seul, et la teinte vient de la table verdict de `DESIGN.md` § 16 — la même que la
// colonne Verdict de la Bibliothèque (`library-views.ts`), pour que le même fait n'ait pas deux
// couleurs selon l'écran où on le lit.
//
// Le « vert/ambre uniquement » du brief de refonte 2026-07 est PÉRIMÉ depuis la révision du
// 2026-08-19 : `fake` passe à `danger`. C'était le seul écran où un faux lossless se disait en
// ambre, c'est-à-dire du même ton que « à vérifier » — or « l'échec est l'information qu'on n'a pas
// le droit d'estomper » (§ 4), et c'est la raison d'être de l'app.
//
// La règle qui, elle, ne bouge pas : JAMAIS un hex en dur ici (l'ancien `#e2685e` rouge la
// cassait) — lire les tokens CSS, pas une 3ᵉ teinte inventée à côté.
const VERDICT_DOT: Record<string, [string, string]> = {
  ok: ["var(--color-text-success)", "authentique"],
  fake: ["var(--color-text-danger)", "faux / sur-encodé"],
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
    ? ["faux", "var(--color-text-danger)"]
    : v === "grey"
      ? ["à vérifier", "var(--color-text-warning)"]
      : v === "ok"
        ? ["", "var(--color-text-success)"]
        : it.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS
          ? ["échec", "var(--color-text-danger)"]
          : ["analyse…", "var(--color-text-tertiary)"];
}

/** One queue row's markup. `active` stamps the `.cur` highlight at creation time — required so
 * the highlight survives virtualization (Task 2): once #ql only mounts the visible window, a
 * row for the open track may not exist in the DOM to be found and classed after the fact.
 *
 * `onCursor` marque de même le CURSEUR CLAVIER (`.kbd`, cf. `keyboardCursorId`) : même contrainte,
 * même remède — une classe posée à la construction, jamais cherchée après coup sur un nœud qui peut
 * ne pas exister. La ligne reste NON focusable (`role="option"` + `aria-activedescendant` sur `#ql`,
 * patron listbox de l'APG) : donner un `tabindex` aux lignes ferait perdre le focus au premier
 * repeint qui démonte la ligne focalisée — soit toutes les 300 ms pendant une analyse.
 * ⚠️ Le bouton Réanalyser plus bas est un descendant interactif d'un `role="option"`, ce que l'APG
 * interdit ; conflit connu, signalé au rapport de Q-5, non résolu ici (le sortir de la ligne est un
 * changement de markup qui ne tient pas dans cette tâche). */
function queueRowHtml(it: QueueItem, active: boolean, onCursor: boolean): string {
  const [word, wordColor] = verdictWord(it);
  // A conversion that failed in the background (P5/D5) outranks the analysis verdict on the row:
  // it is the one thing about this track the user must see, and it has to survive navigation — it
  // is re-read from filing-state on every paint, so leaving Revue and coming back keeps it.
  const failure = filingFailure(it.id);
  const title = esc(it.filename || it.path);
  const artist = it.artist ? esc(it.artist) : "";
  return (
    `<div class="qi${active ? " cur" : ""}${onCursor ? " kbd" : ""}" id="qi-${it.id}" role="option" aria-selected="${active}" data-id="${it.id}" data-path="${esc(it.path)}" title="Écouter et convertir" style="cursor:pointer">` +
    (reviewMode === "batch"
      ? `<input type="checkbox" class="qi-ck" data-sift="queuepick" data-id="${it.id}" tabindex="-1"${queueBatchSel.has(it.id) ? " checked" : ""}>`
      : "") +
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
    `<div style="display:flex;align-items:center;gap:6px;min-width:0">` +
    verdictDot(it.verdict) +
    `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500">${title}</span>` +
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
    // Pastille DUPLICATE, au BORD DROIT de la ligne (wireframe « Poste de décision » §§ 09-10 ;
    // spec `docs/ui-specs/revue.md` § Zone B′ : « rendu hors colonne verdict »). Elle a quitté la
    // première ligne — où elle était collée au nom de fichier sous forme de glyphe nu ⧉ teinté
    // warning — pour le niveau `.qi`, seul endroit qui a un bord droit ; c'est la place que la durée
    // occupait avant son retrait du 2026-08-21, retirée précisément parce qu'elle « mangeait la
    // place du signal doublon ». Elle reste NEUTRE (gris de sélection, encre secondaire) et non
    // warning : un doublon n'est pas un verdict — il ne sort pas de `tracks.verdict` mais du scan de
    // dédoublonnage, et `design-system-states.md` (« il n'y a pas de sixième rendu ») en fait le
    // point explicite. Lui donner l'ambre de « à vérifier » ferait deux faits d'une seule couleur.
    // Style en RÈGLE CSS (`.qi-dup`) et non en attributs inline : cette ligne est concaténée dans la
    // boucle de `renderQueueWindow`, donc chaque attribut se paie en octets de chaîne à CHAQUE
    // fenêtre rendue — poll de 300 ms + scroll rAF-throttlé.
    (it.dup ? '<span class="qi-dup" title="Doublon possible (même nom)">DUPLICATE</span>' : "") +
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
    const qcol = document.getElementById("qcol");
    if (qcol) ensureQueueColumnChrome(qcol);
    // Live destination bins. Cet appel vit DANS le bloc de cache et non en tête de fonction :
    // ce chemin `return` plus bas, donc il n'atteint jamais l'appel gardé par `touchDetail`, et
    // les bacs resteraient ceux d'avant la navigation. En tête de fonction en revanche, il
    // s'exécuterait AUSSI sur le redraw 300ms de la progression d'analyse — or `list_bins` marche
    // toute la racine bibliothèque récursivement côté backend, ce que le garde de l'autre appel
    // existe précisément pour éviter. Ici le poll ne passe pas : ce bloc exige `#ql` vide, et un
    // poll d'analyse repeint une liste qui a déjà ses lignes.
    const fldz = requireEl("#fldz", "renderQueue");
    void refreshBins(fldz);
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
    // `data-sift="qloading"` n'est pas décoratif : c'est ce qui permet au `catch` de `listQueue`
    // plus bas de savoir s'il regarde CE placeholder (à remplacer par une erreur) ou de vraies
    // lignes déjà peintes (à ne pas détruire). Sans marque, il faudrait deviner.
    ql.innerHTML =
      '<div data-sift="qloading" style="display:flex;align-items:center;gap:8px;padding:8px 7px;color:var(--color-text-tertiary);font-size:var(--text-md)">' +
      '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md)"></i> Chargement…</div>';
  }
  let items: QueueItem[] = [];
  try {
    items = await listQueue();
  } catch (e) {
    // Impasse A7 (issue #15) : ce `catch` faisait `console.error` + `return` sec, donc le
    // « Chargement… » peint juste au-dessus tournait pour toujours. Un spinner permanent est un
    // échec silencieux — le rail de sources (`rail-sources.ts`) le dit et le
    // corrige déjà, la correction n'avait pas été portée ici.
    const display = humanizeError(
      e,
      "Impossible de charger la file. Vérifie la connexion à la base et réessaie.",
      "listQueue",
    );
    // Deux cas, pas un. Rail encore vide (premier chargement) : c'est LE spinner qu'il faut
    // remplacer, par une carte d'erreur avec sa porte de sortie. Rail déjà peuplé (un poll de
    // `queue:changed` qui échoue) : les lignes affichées restent valides, les écraser perdrait
    // de l'information juste — un toast dit l'échec sans détruire l'état.
    if (ql.querySelector('[data-sift="qloading"]')) {
      ql.innerHTML =
        '<div class="sift-ui-card-soft sift-ui-card-soft-pad" style="color:var(--color-text-danger)">' +
        esc(display) +
        '<div style="margin-top:var(--space-8)"><button data-sift="retryqueue" style="font-size:var(--text-xs);color:var(--color-text-info)">Réessayer</button></div>' +
        "</div>";
      ql.querySelector<HTMLButtonElement>('[data-sift="retryqueue"]')?.addEventListener(
        "click",
        () => {
          ql.innerHTML = "";
          void renderQueue(touchDetail);
        },
      );
    } else {
      toast(display);
    }
    return;
  }
  // P5 (PRD 2026-07-27, D3): a track whose conversion is still running in the background has left
  // the user's loop, but it is still `pending` backend-side (it only becomes `filed` once the encode
  // commits), so list_queue keeps returning it. Dropping it HERE — the single point where the front
  // takes delivery of the queue — is what stops the auto-advance from re-opening it and the user
  // from converting it a second time, in the rail as well as in Lot mode (both read currentItems).
  // It comes back on its own if the conversion fails: see the onFilingOutcome subscription below.
  items = items.filter((it) => !isFilingInFlight(it.id));
  // Filtre de SOURCE (fusion 1, DESIGN.md § 15) : cliquer un dossier surveillé dans le rail
  // restreint la file à ses fichiers, comme cliquer une source dans la sidebar de Finder restreint
  // sa liste. Appliqué ICI, au point unique où le front prend livraison de la file — donc le mode
  // Lot, le badge et l'auto-avance voient tous la même liste, sans qu'aucun ait à connaître le
  // filtre. `source_id` existe déjà dans le contrat : aucun aller-retour backend n'est ajouté.
  if (queueSourceFilter != null) items = items.filter((it) => it.source_id === queueSourceFilter);
  currentItems = items;
  // This IS the fresh delivery the stale flag was waiting for, and the single point where the
  // front takes the queue in — so it is also where the badge is brought back in step with the rail.
  queueCacheStale = false;
  updateRevueBadge(currentItems.length);
  const qcol = document.getElementById("qcol");
  if (qcol) ensureQueueColumnChrome(qcol);
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

// ---------------------------------------------------------------------------
// Ordre de la colonne file — DÉCLARÉ ici, plus déduit de l'ordre d'appel
// ---------------------------------------------------------------------------

/** Ordre vertical de #qcol, de haut en bas (spec `docs/ui-specs/revue.md` § Zone B′) :
 *  recherche → rangée de filtre → liste virtualisée → bascules de pied.
 *
 *  Jusqu'au 2026-08-25 cet ordre était un EFFET DE BORD de l'ordre d'appel dans `renderQueue` :
 *  la recherche s'insérait en `firstChild`, les deux autres blocs s'ajoutaient à la fin, et rien
 *  n'écrivait nulle part que la colonne devait se lire ainsi — permuter deux appels la
 *  réordonnait en silence. Les blocs se posent désormais PAR RAPPORT À CETTE LISTE
 *  (`placeInQueueColumn`), donc l'ordre d'appel de `ensureQueueColumnChrome` n'a plus d'effet.
 *
 *  Tient à la RECONSTRUCTION : un aller-retour de navigation refait #qcol par `content.innerHTML`
 *  (`revueShell`, router.ts — et app.js pour la maquette), donc tous ces nœuds disparaissent
 *  ensemble et sont reposés ensemble au rendu suivant, chacun à son rang.
 *  Tient au POLL de 300ms : chaque `ensure*` sort en tête sur son nœud déjà monté, aucun ne
 *  redéplace un nœud existant — déplacer un `<input>` monté lui ferait perdre le focus en pleine
 *  frappe, et le déplacement lui-même est une écriture DOM que ce poll ne doit pas payer.
 *
 *  `.sift-qhead` et `#ql` ne sont pas injectés ici (ils viennent du markup de `revueShell`) : ils
 *  figurent dans la liste comme ANCRES, c'est-à-dire comme les repères devant lesquels les blocs
 *  injectés doivent se ranger. */
const QCOL_ORDER = [
  "#sift-qsearch", // 1. recherche — en tête de colonne (décision E du 2026-08-24)
  ".sift-qhead", // 2. ancre : rangée de filtre — pulldown + compte de pistes (revueShell)
  "#ql", // 3. ancre : liste virtualisée (revueShell)
  "#sift-qdone-toggle", // 4. pied : « Non analysés uniquement »
  "#sift-qreanalyze-all", // 5. pied : « Réanalyser (N) »
  "#sift-qfacet-pop", // hors flux (`position:fixed`) : rangé en dernier, sa place ne se voit pas
] as const;

/** Une des places déclarées ci-dessus. Union de littéraux : un sélecteur absent de `QCOL_ORDER`
 *  ne compile pas, plutôt que d'atterrir silencieusement en tête de colonne à l'exécution. */
type QcolSlot = (typeof QCOL_ORDER)[number];

/** Insère `el` dans #qcol à la place que `QCOL_ORDER` lui donne : devant le premier successeur
 *  déjà monté, ou à la fin s'il n'y en a aucun (`insertBefore(…, null)` = `appendChild`). Appelé
 *  au seul MONTAGE d'un bloc — les `ensure*` sortent en tête quand leur nœud existe déjà. */
function placeInQueueColumn(qcol: HTMLElement, el: HTMLElement, slot: QcolSlot): void {
  const kids = Array.from(qcol.children);
  let ref: Element | null = null;
  for (let i = QCOL_ORDER.indexOf(slot) + 1; i < QCOL_ORDER.length; i++) {
    const next = kids.find((c) => c.matches(QCOL_ORDER[i]));
    if (next) {
      ref = next;
      break;
    }
  }
  qcol.insertBefore(el, ref);
}

/** Les trois blocs injectés de la colonne file, montés depuis UN seul point d'appel. L'ordre des
 *  trois lignes ci-dessous suit `QCOL_ORDER` pour se lire comme la colonne, mais il ne la décide
 *  plus : c'est `placeInQueueColumn` qui range. */
function ensureQueueColumnChrome(qcol: HTMLElement): void {
  ensureQueueSearch(qcol);
  ensureQueueFacet(qcol);
  ensureQueueDoneToggle(qcol);
}

/** "Non analysés uniquement" filter toggle — surfaces tracks still waiting on/stuck in background
 * analysis, without hiding the rest of the pending queue by default (see queueUnanalyzedOnly's
 * doc comment for why the prior default-hide behavior was wrong). Injected once, au PIED de la
 * colonne (sous `#ql`) — sa place vient de `QCOL_ORDER`, plus de l'ordre d'appel.
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
    placeInQueueColumn(qcol, el, "#sift-qdone-toggle");
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
    placeInQueueColumn(qcol, el, "#sift-qreanalyze-all");
  }
  el.hidden = unanalyzedCount === 0;
  // State-driven, not a mid-flight eager re-enable: the button is disabled iff a bulk retry is
  // actually running (bulkReanalyzing), so a queue:changed re-render during the retry can't flip it
  // back to enabled under the in-flight handler (review-caught double-submit race).
  el.disabled = bulkReanalyzing;
  el.textContent = bulkReanalyzing ? "Relance…" : `Réanalyser (${unanalyzedCount})`;
}

/** Live filter bar for the queue rail (annotation: "on veut une barre de recherche en bas" —
 * remontée en TÊTE de la colonne le 2026-08-25, décision Revue #47 : la recherche coiffe la file,
 * comme le champ de filtre d'un inspecteur macOS). Injected once, à la PREMIÈRE place de
 * `QCOL_ORDER` : `.sift-qhead` puis `#ql` la suivent, donc elle coiffe la liste au lieu de flotter
 * dessous. Sa place ne dépend plus de l'ordre d'appel — voir `placeInQueueColumn`.
 * Filters currentItems client-side only (title/artist) — see visibleQueueItems().
 *
 * GABARIT DU KIT depuis le 2026-08-25 (Big Sur, « Search fields » : 45:812 au repos, 45:825 au
 * focus, 45:899 avec clear), aligné sur le champ JUMEAU de la barre unifiée
 * (`toolbar.ts::mountBarSearch`, `.sift-bar-search`) plutôt qu'en variante inventée : loupe à
 * GAUCHE dans le flux, placeholder « Rechercher », bouton clear dès qu'il y a du texte.
 * Ce que ce geste RETIRE, et qui venait de l'annotation « met juste une icone de loupe sur la
 * droite qui disparait quand on tape » :
 *   · la loupe en overlay `position:absolute` à droite, masquée à la première frappe ;
 *   · les 30px de gouttière droite qu'elle réservait — la gouttière, elle, RESTAIT une fois
 *     l'icône partie, donc un champ rempli montrait 30px de vide inerte exactement là où le kit
 *     pose son clear.
 * L'apparence (hauteur, rayon, trait, focus) vit maintenant dans `.sift-search-wrap`
 * (`styles.css`, région de la colonne file) : plus aucune valeur en dur ici. */
function ensureQueueSearch(qcol: HTMLElement): void {
  if (document.getElementById("sift-qsearch")) return;
  const wrap = document.createElement("div");
  wrap.id = "sift-qsearch";
  // `sift-search-wrap` porte le trait, le rayon, la hauteur ET le traitement de focus : l'input
  // lui-même reste sans bordure, donc le traitement de focus des champs texte (`styles.css`,
  // border-color) ne peut toujours rien montrer sur lui.
  wrap.className = "sift-search-wrap";
  // Aucune donnée d'exécution ici — que des littéraux, rien à passer par `esc()`.
  wrap.innerHTML =
    '<i class="ti ti-search" aria-hidden="true"></i>' +
    '<input id="sift-qsearch-input" type="search" placeholder="Rechercher" ' +
    'aria-label="Filtrer la file">' +
    '<button type="button" id="sift-qsearch-clear" class="sift-search-clear" hidden ' +
    'aria-label="Effacer la recherche" title="Effacer la recherche">' +
    '<i class="ti ti-circle-x" aria-hidden="true"></i></button>';
  // En TÊTE de #qcol : devant `.sift-qhead` puis `#ql`. Le segmenté Détail / Lot, qui vivait au-
  // dessus d'elle, a été retiré le 2026-08-25 — plus rien ne la précède. Guard en tête de fonction
  // → insertion unique : le poll de 300ms ne redéplace pas le champ (il perdrait le focus).
  placeInQueueColumn(qcol, wrap, "#sift-qsearch");
  const input = wrap.querySelector<HTMLInputElement>("#sift-qsearch-input")!;
  const clear = wrap.querySelector<HTMLButtonElement>("#sift-qsearch-clear")!;
  // REMISE EN PHASE AU MONTAGE. Le terme survit à la navigation (`queueSearchTerm`, niveau module)
  // alors que le champ, lui, est recréé VIDE par `revueShell` (`content.innerHTML`). Sans cette
  // ligne, un retour sur Revue rendait une file filtrée par un terme que plus rien n'affichait —
  // et depuis que le clear se cache sur un champ vide, sans plus aucune commande pour en sortir.
  // Même piège que « Non analysés uniquement », qui porte son propre garde-fou daté plus haut, et
  // même choix que `queueFacetFilter` : l'état gouverne, le contrôle se relit dessus.
  input.value = queueSearchTerm;
  clear.hidden = queueSearchTerm === "";
  // UN SEUL point qui applique le terme, partagé par la frappe et par le clear : les deux chemins
  // ne peuvent donc pas diverger. Un clear qui aurait oublié `ql.scrollTop = 0` rendrait la file
  // ENTIÈRE à la position de défilement d'une liste filtrée bien plus courte.
  // Coût par frappe : une propriété booléenne sur le bouton, plus le rendu de la fenêtre
  // virtualisée qui existait déjà. Aucun nœud créé, aucun `innerHTML` — la frappe est l'événement
  // en rafale par excellence (CLAUDE.md § Front).
  const applySearch = (): void => {
    queueSearchTerm = input.value.trim();
    clear.hidden = input.value === "";
    const ql = document.getElementById("ql");
    if (ql) {
      ql.scrollTop = 0; // a shorter filtered list can leave scrollTop referring to nothing
      renderQueueWindow(ql);
    }
  };
  input.addEventListener("input", applySearch);
  clear.addEventListener("click", () => {
    input.value = "";
    applySearch(); // terme vide → la file ENTIÈRE revient, et le bouton repasse en `hidden`
    // La main revient au champ : on efface pour retaper, pas pour partir. Sans ce focus, le clear
    // garderait le focus clavier sur un bouton qui vient de disparaître.
    input.focus();
  });
}

/** Focus + sélectionne le champ de recherche de la file (Revue). Rend false si le champ n'est pas
 *  monté (autre vue, ou colonne file absente) — l'appelant (⌘F, shortcuts.ts) se rabat alors sur la
 *  recherche de la barre unifiée. Testé par présence DOM, pas par un état de vue exporté : aucun
 *  import routeur ici. */
export function focusQueueSearch(): boolean {
  const input = document.getElementById("sift-qsearch-input") as HTMLInputElement | null;
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

// ---------------------------------------------------------------------------
// Filtre par facettes — pulldown de la rangée de filtre + popover cochable
// ---------------------------------------------------------------------------

/** Re-applique le filtre à la file affichée (après une case cochée / « Tout afficher »). */
function applyFacetFilter(): void {
  const ql = document.getElementById("ql");
  if (ql) {
    ql.scrollTop = 0; // une liste plus courte peut laisser scrollTop pointer dans le vide
    renderQueueWindow(ql);
  }
}

/** Ferme le popover de facettes. Exporté pour dismissTopmost (shortcuts.ts) + l'auto-fermeture. */
export function closeQueueFacet(): void {
  const pop = document.getElementById("sift-qfacet-pop");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  document.querySelector('[data-fil="qfacet"]')?.setAttribute("aria-expanded", "false");
}

/** Ancre le popover sous le bouton filtre, depuis la géométrie du moment (rejouable). */
function placeQueueFacet(): void {
  const pop = document.getElementById("sift-qfacet-pop");
  const btn = document.querySelector<HTMLElement>('[data-fil="qfacet"]');
  if (!pop || pop.hidden || !btn) return;
  const r = btn.getBoundingClientRect();
  const { top, left } = anchoredBelowPosition(
    { top: r.top, bottom: r.bottom, left: r.left },
    pop.offsetWidth,
    pop.offsetHeight,
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  );
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

/** Compte par facette (wireframe « Poste de décision » § 10 : « Lossless 5 · MP3 3 · Faux 3 ·
 *  Doublons 2 »), plus le TOTAL de la file sur la rangée « Tout afficher » — ce que cette rangée
 *  ramènerait à l'écran si on la cliquait.
 *
 *  Lus sur `currentItems`, la file SOURCE, et JAMAIS sur `visibleQueueItems()` : sur la liste déjà
 *  filtrée, cocher « Faux » ferait tomber « Lossless », « MP3 » et « Doublons » à 0, et le menu
 *  cesserait de dire ce qu'il y a à filtrer pour ne plus dire que ce qui reste après filtrage. Même
 *  raison, à l'envers, que le compte de la rangée d'en-tête (`paintQueueCount`), qui lui décrit ce
 *  que la colonne MONTRE et se lit donc sur la liste filtrée.
 *
 *  Appelé à l'OUVERTURE du menu seulement (`toggleQueueFacet`), jamais depuis le rendu de la file :
 *  ce balayage est en O(file × facettes) et la colonne se repeint sur un poll de 300ms — c'est le
 *  point chaud du frontend. Une file fermée n'a pas de compte à montrer. */
function paintFacetCounts(pop: HTMLElement): void {
  const counts = new Map<string, number>(QUEUE_FACETS.map((f) => [f.id, 0]));
  // Un seul parcours de la file pour les quatre facettes (elles ne s'excluent pas : un même item
  // peut être compté dans plusieurs, l'union du filtre le dédoublonne ensuite).
  for (const it of currentItems) {
    for (const f of QUEUE_FACETS) if (f.match(it)) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
  }
  for (const f of QUEUE_FACETS) {
    // `f.id` est un littéral de QUEUE_FACETS, pas une donnée : sûr dans un sélecteur.
    const el = pop.querySelector<HTMLElement>(`[data-facet-count="${f.id}"]`);
    const s = String(counts.get(f.id) ?? 0);
    if (el && el.textContent !== s) el.textContent = s;
  }
  const totalEl = pop.querySelector<HTMLElement>("[data-facet-total]");
  const total = String(currentItems.length);
  if (totalEl && totalEl.textContent !== total) totalEl.textContent = total;
}

/** Ouvre/ferme le popover. Les cases ET les comptes reflètent l'état à chaque ouverture (muter, pas
 *  rebuild). Placement au SECOND frame — le style n'est pas recalculé au premier dans WebView2
 *  (même leçon que le popover de facettes de Bibliothèque et le placement du popover Destination). */
function toggleQueueFacet(): void {
  const pop = document.getElementById("sift-qfacet-pop");
  const btn = document.querySelector<HTMLElement>('[data-fil="qfacet"]');
  if (!pop || !btn) return;
  if (!pop.hidden) {
    closeQueueFacet();
    return;
  }
  pop.querySelectorAll<HTMLInputElement>("input[data-facet]").forEach((cb) => {
    cb.checked = queueFacetFilter.has(cb.dataset.facet || "");
  });
  // AVANT `hidden = false`, comme les cases juste au-dessus : le menu ne doit jamais être peint,
  // même une frame, avec des cellules de compte vides. Elles le sont au montage (`ensureQueueFacet`
  // pose le markup sans valeur) et le resteraient jusqu'ici à la première ouverture.
  paintFacetCounts(pop);
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => requestAnimationFrame(() => placeQueueFacet()));
}

/** Résumé EN TOUTES LETTRES de la combinaison cochée — c'est le libellé du pulldown (wireframe
 *  « Poste de décision » §§ 09-10 ; spec § Zone B′ : « le bouton résume la combinaison »). Il
 *  remplace le compte numérique de critères, qui disait « 2 » là où la rangée dit maintenant
 *  « Faux + Doublons » : le filtre actif se lit sans ouvrir le menu.
 *
 *  Ordre de `QUEUE_FACETS`, PAS l'ordre d'insertion du Set — sinon la même combinaison se nommerait
 *  « Faux + Doublons » ou « Doublons + Faux » selon l'ordre des clics.
 *
 *  Rien de coché → « Tout afficher », mot pour mot la commande de remise à zéro du menu : l'état
 *  sans filtre et la sortie du filtre se disent pareil, donc le bouton ne peut pas laisser croire
 *  qu'un filtre est posé alors qu'il n'y en a aucun. */
function facetSummary(): string {
  const on = QUEUE_FACETS.filter((f) => queueFacetFilter.has(f.id)).map((f) => f.label);
  return on.length ? on.join(" + ") : "Tout afficher";
}

/** Repeint le pulldown depuis `queueFacetFilter` : libellé résumé + marque `on` (qui ne pilote plus
 *  qu'une ENCRE, `styles.css` — filtre posé en encre primaire, « Tout afficher » en tertiaire).
 *  Plus d'`aria-pressed` : ce bouton n'est pas une bascule mais un *pop-up button* (`aria-haspopup`
 *  + `aria-expanded`), et son libellé visible dit déjà l'état — le doubler d'un état pressé faisait
 *  lire deux choses contradictoires à un lecteur d'écran. */
function paintFacetButton(btn: HTMLElement): void {
  btn.classList.toggle("on", queueFacetFilter.size > 0);
  const label = btn.querySelector<HTMLElement>(".sift-qfacet-label");
  // `textContent`, pas `innerHTML` : les libellés viennent de `QUEUE_FACETS` (littéraux), et cette
  // fonction est rappelée à chaque rendu de la file — poll de 300ms compris.
  if (label) label.textContent = facetSummary();
}

// Auto-fermeture (scroll / resize / clic extérieur), câblée une fois. Le popover est ancré à un
// POINT : défiler ou redimensionner le ferme plutôt que courir après la géométrie — même règle que
// le menu contextuel et le popover de facettes de Bibliothèque.
let queueFacetDismissWired = false;
function ensureQueueFacetDismiss(): void {
  if (queueFacetDismissWired) return;
  queueFacetDismissWired = true;
  const close = () => closeQueueFacet();
  document.addEventListener("scroll", close, { capture: true });
  window.addEventListener("resize", close);
  document.addEventListener(
    "click",
    (e) => {
      const pop = document.getElementById("sift-qfacet-pop");
      if (!pop || pop.hidden) return;
      const t = e.target as Node;
      if (pop.contains(t) || (t as HTMLElement).closest?.('[data-fil="qfacet"]')) return;
      closeQueueFacet();
    },
    { capture: true },
  );
}

/** Pulldown de filtre (à GAUCHE de la rangée `.sift-qhead`) + son popover cochable, créés UNE fois
 *  puis mutés — appelé au rendu de la file (poll compris), donc JAMAIS innerHTML= en rafale : le
 *  markup est posé au premier montage, les appels suivants ne re-peignent que le libellé. Réutilise
 *  la classe .sift-facet-pop (styles.css) et la géométrie anchoredBelowPosition (popover-position.ts).
 *
 *  GABARIT DU KIT depuis le 2026-08-25 (Big Sur, *pulldown* : 45:152 au repos, 45:169 au survol,
 *  45:186 pressé) — bouton à LIBELLÉ + chevron, plus le bouton icône-seule qu'il était. Ce que ce
 *  geste retire, et pourquoi :
 *    · le glyphe `ti-filter` et le compte numérique de critères (« 2 ») — le libellé les remplace
 *      en toutes lettres, et un CTA à libellé descriptif se dit en TEXTE SEUL (CLAUDE.md § Front) ;
 *    · l'`aria-label` « Filtrer la file » — sur un bouton qui a désormais du texte visible, il le
 *      MASQUERAIT au lecteur d'écran au lieu de l'aider. Le `title` reste : il nomme l'action là où
 *      le libellé ne nomme que l'état.
 *  L'apparence (hauteur, rayon, padding, survol, pressé) vit dans `.sift-qfacet-btn`
 *  (`styles.css`, région de la colonne file) : aucune valeur en dur ici. */
function ensureQueueFacet(qcol: HTMLElement): void {
  ensureQueueFacetDismiss();
  const head = qcol.querySelector<HTMLElement>(".sift-qhead");
  let btn = document.getElementById("sift-qfacet-btn");
  if (head && !btn) {
    btn = document.createElement("button");
    btn.id = "sift-qfacet-btn";
    btn.className = "sift-qfacet-btn";
    btn.setAttribute("type", "button");
    btn.setAttribute("data-fil", "qfacet");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("title", "Filtrer la file");
    // Aucune donnée d'exécution ici — le libellé est posé par `paintFacetButton` en `textContent`.
    btn.innerHTML =
      '<span class="sift-qfacet-label"></span><i class="ti ti-chevron-down" aria-hidden="true"></i>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleQueueFacet();
    });
    // `prepend`, pas `appendChild` : le compte de pistes est déjà dans la rangée (`revueShell`) et
    // le pulldown se range à sa GAUCHE. Insertion unique (gardée par `!btn`), donc le poll de 300ms
    // ne redéplace rien.
    head.prepend(btn);
  }
  if (!document.getElementById("sift-qfacet-pop")) {
    const pop = document.createElement("div");
    pop.id = "sift-qfacet-pop";
    pop.className = "sift-facet-pop";
    pop.hidden = true;
    // Libellés STATIQUES (QUEUE_FACETS), aucune donnée non fiable — esc() par prudence de site neuf.
    //
    // GABARIT DU KIT (Menu/Menu-items 58:49) depuis le 2026-08-25 : chaque option est une rangée à
    // trois cellules — case à cocher, libellé, compte — et « Tout afficher » en est une quatrième,
    // derrière un séparateur. Deux ajouts que le wireframe § 10 dessine et que ce menu n'avait pas :
    //   · la CASE au gabarit du kit — la case native reste le contrôle (clavier, `change`, nom
    //     accessible via le <label>), `.sift-qfacet-box` en est l'habillage peint (`styles.css`) ;
    //   · le COMPTE par facette, à droite, écrit par `paintFacetCounts` à l'ouverture du menu.
    // `.sift-menu-label` / `.sift-menu-count` sont RÉUTILISÉS et non redéclarés : ce sont les deux
    // cellules de la grammaire de menu du dépôt (une seule dans l'app), et `.sift-menu-count` porte
    // déjà les chiffres tabulaires que le wireframe demande.
    pop.innerHTML =
      QUEUE_FACETS.map(
        (f) =>
          `<label class="sift-qfacet-opt">` +
          `<input type="checkbox" class="sift-qfacet-ck" data-facet="${esc(f.id)}">` +
          `<span class="sift-qfacet-box" aria-hidden="true"><i class="ti ti-check"></i></span>` +
          `<span class="sift-menu-label">${esc(f.label)}</span>` +
          `<span class="sift-menu-count" data-facet-count="${esc(f.id)}"></span>` +
          `</label>`,
      ).join("") +
      '<div class="sift-qfacet-sep" role="separator"></div>' +
      '<button type="button" class="sift-qfacet-reset" data-facet-reset>' +
      '<span class="sift-menu-label">Tout afficher</span>' +
      '<span class="sift-menu-count" data-facet-total></span>' +
      "</button>";
    pop.querySelectorAll<HTMLInputElement>("input[data-facet]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const id = cb.dataset.facet || "";
        if (cb.checked) queueFacetFilter.add(id);
        else queueFacetFilter.delete(id);
        const b = document.getElementById("sift-qfacet-btn");
        if (b) paintFacetButton(b);
        applyFacetFilter();
      }),
    );
    pop.querySelector("[data-facet-reset]")?.addEventListener("click", () => {
      queueFacetFilter.clear();
      pop.querySelectorAll<HTMLInputElement>("input[data-facet]").forEach((cb) => (cb.checked = false));
      const b = document.getElementById("sift-qfacet-btn");
      if (b) paintFacetButton(b);
      applyFacetFilter();
      closeQueueFacet();
    });
    // Rangé en dernier dans #qcol : il est `position:fixed` (`.sift-facet-pop`), donc hors flux —
    // sa place dans le DOM ne se voit pas, mais elle est déclarée comme les autres pour que
    // l'ordre de la colonne se lise en un seul endroit. Enfant de #qcol pour disparaître avec lui
    // quand la navigation reconstruit la colonne.
    placeInQueueColumn(qcol, pop, "#sift-qfacet-pop");
  }
  if (btn) paintFacetButton(btn);
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
  // But NOT while a batch filing is running (sheet open) — the queue stays interactive for
  // selecting the next batch (wireframe § 17: "non-modale, la file reste utilisable").
  if (reviewMode === "batch" && !isBatchSheetOpen()) enterDetailMode();
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
  queueRowHeightCache = null; // hauteur change entre détail et lot (case ajoutée)
  if (m === "detail") queueBatchSel.clear();
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
  // Plus de segmenté à repeindre ici depuis le 2026-08-25 : c'est l'icône de sélection de la barre
  // unifiée qui porte l'état armé/désarmé du mode Lot (spec `docs/ui-specs/revue.md` § Zone A).
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
