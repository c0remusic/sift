// Doublons — destination du rail sous Revue (Tauri only). Spec : `docs/ui-specs/doublons.md`,
// validée par Antoine le 2026-10-05 (direction hybride : le lieu et la table de A, la décision de
// C, les niveaux de preuve de B).
//
// Une table de TOUS les groupes de la bibliothèque (file et Rangés), une case « Garder » par copie,
// un plan, puis une seule application confirmée. L'inspecteur compare la copie ouverte à la copie
// gardée — ou, quand c'est la gardée qu'on ouvre, à la meilleure des autres. Le modèle (plan,
// effets, encre de différence, filtres) est pur et testé à part : `duplicates-model.ts`.
import {
  applyDuplicatePlan,
  listDuplicateGroups,
  listSources,
  onDuplicatePlanProgress,
  onQueueChanged,
  refuseDuplicateGroup,
  revealTrack,
  revertBatch,
  stopDuplicatePlan,
} from "./ipc";
import type { DupApplyResult, DupScreenCopy, DupScreenGroup, Source } from "../shared/contracts";
import { esc, requireEl } from "./dom";
import { emptyStateHtml, wireEmptyState } from "./empty-state";
import { createVirtualList, type VirtualList } from "./list-virtual";
import { isStaleViewRender, viewEpoch } from "./view-epoch";
import { closeAside, mountBarActions, mountBarSearch, openAside } from "./toolbar";
import { openContextMenu } from "./context-menu";
import { revealAside } from "./chrome";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { confirmTrashPlan } from "./confirm-modal";
import { openReportInto, togglePlay } from "./report-view";
import { anchoredBelowPosition } from "./popover-position";
import {
  compareTarget,
  fileName,
  filterCounts,
  flattenRows,
  GROUP_FILTERS,
  isKept,
  keepable,
  parentDir,
  planTotals,
  preferFolder,
  rebasePlan,
  rekordboxPlaylists,
  restSummary,
  ruleReason,
  visibleGroups,
  type DupRow,
  type GroupFilter,
  type Plan,
} from "./duplicates-model";
import {
  dupRowHtml,
  fmtDuration,
  fmtKbps,
  fmtKhz,
  fmtSize,
  groupEffectHtml,
  headHtml,
  legendHtml,
  shortDir,
  verdictView,
  type DupRowView,
} from "./duplicates-rows";
import { T } from "./i18n/duplicates-view";

// ---------------------------------------------------------------------------
// État de l'écran
// ---------------------------------------------------------------------------

let groups: DupScreenGroup[] = [];
let plan: Plan = new Map();
/** Les groupes que l'utilisateur a modifiés : un groupe À vérifier n'entre dans l'application
 *  qu'une fois tranché à la main (spec § Interactions, « Geste de masse »). Dérivé de `decided` à
 *  chaque relecture des groupes (`rebasePlan`). */
let touched = new Set<number>();
/** Les copies des groupes que l'utilisateur a tranchés — la mémoire du plan, indexée par COPIE :
 *  l'id d'un groupe change quand sa copie de plus petit id part. */
let decided = new Set<number>();
let filter: GroupFilter = "all";
let query = "";
/** La copie ouverte dans l'inspecteur. */
let openId: number | null = null;
let sources: Source[] = [];
/** Les dossiers préférés pendant la session (« Préférer ce dossier »), pour le résumé de repos. */
const preferred = new Map<string, number>();
let applying = false;
/** Le lot de la dernière application, pour l'Annuler de son rapport d'échec partiel. */
let lastBatch: string | null = null;
let virtual: VirtualList | null = null;
/** Les rangées de la table. Le MÊME tableau vit dans la liste virtualisée : il se modifie sur
 *  place, puis `virtual.render()` (list-virtual.ts garde la référence reçue). */
const rows: DupRow[] = [];
/** Les écouteurs de la table vivent sur `#content`, PERMANENT : posés une fois, comme Écartés
 *  (revue du 2026-10-05 : posés à chaque rendu, ils s'empilaient). */
let tableWired = false;
let keysWired = false;
/** La copie à ouvrir au prochain rendu : posée par `showDuplicateGroupOf` (Revue). */
let pendingFocus: number | null = null;
/** La navigation vers l'écran, injectée par le routeur (`router.ts::installRouter`) : ce module
 *  est importé PAR le routeur, un import retour fermerait le cycle (CLAUDE.md, injection de
 *  dépendance plutôt qu'un import statique retour). */
let navigate: (() => void) | null = null;

export function registerDupsNavigator(fn: () => void): void {
  navigate = fn;
}

/** Ouvre l'écran Doublons sur la copie `trackId` : le bandeau doublon de Revue et le menu d'une
 *  ligne badgée y mènent (revue.md, amendement du 2026-10-05). Filtre et recherche repartent de
 *  zéro, pour que la copie soit dans la table. */
export function showDuplicateGroupOf(trackId: number): void {
  pendingFocus = trackId;
  filter = "all";
  query = "";
  if (navigate) navigate();
  else console.error("showDuplicateGroupOf : aucune navigation injectée (registerDupsNavigator)");
}

/** Le délégué des liens `[data-dupsgo]` (bandeau de Revue). Sur `document`, posé une fois : le
 *  bandeau est réécrit à chaque ouverture de piste. */
export function installDuplicatesLinks(): void {
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-dupsgo]");
    if (b) showDuplicateGroupOf(Number(b.dataset.dupsgo));
  });
}

/** Ce que le rendu des rangées lit de l'écran (`duplicates-rows.ts`). */
function rowView(): DupRowView {
  return { plan, touched, sources, openId };
}

/** Recalcule les rangées visibles (filtre, recherche) dans le MÊME tableau, puis remonte la
 *  fenêtre de la liste. Fréquence : une frappe dans la recherche (rafale de 5 à 10/s en saisie
 *  rapide), un choix de filtre, un rendu doux après `queue:changed`. Le jeu de rangées change
 *  réellement, donc la fenêtre se remonte ; la barre se MUTE (`paintBar`), l'inspecteur ne bouge
 *  pas — son résumé ne dépend ni du filtre ni de la recherche. */
function refreshTable(): void {
  const visible = visibleGroups(groups, filter, query);
  rows.length = 0;
  rows.push(...flattenRows(visible));
  virtual?.render();
  paintBar(visible.length);
}

/** Un geste sur le plan (case, Entrée, ⌫, menu, Préférer) : les rangées MONTÉES du groupe se
 *  patchent en place — la case garde son nœud, donc son focus — et l'en-tête reçoit son effet
 *  recalculé. Les rangées hors fenêtre se peindront avec le plan courant à leur montage. */
function patchGroupRows(gid: number): void {
  const g = groups.find((x) => x.id === gid);
  if (!g) return;
  const v = rowView();
  document.querySelectorAll<HTMLElement>(`.lr[data-dupgroup="${gid}"]`).forEach((r) => {
    if (r.dataset.dupcopy) {
      const c = g.copies.find((x) => x.id === Number(r.dataset.dupcopy));
      if (!c) return;
      const kept = isKept(plan, c);
      const ck = r.querySelector<HTMLInputElement>("[data-dupkeep]");
      if (ck && ck.checked !== kept) ck.checked = kept;
      r.querySelector(".sift-dups-rkb")?.classList.toggle("sift-dups-warn", !kept);
      return;
    }
    const eff = r.querySelector<HTMLElement>(".sift-dups-effect");
    if (eff) eff.outerHTML = groupEffectHtml(g, v);
  });
}

// ---------------------------------------------------------------------------
// Barre
// ---------------------------------------------------------------------------

function filterLabel(f: GroupFilter): string {
  const t = T();
  switch (f) {
    case "all":
      return t.filterAll;
    case "identical":
      return t.filterIdentical;
    case "same_sound":
      return t.filterSameSound;
    case "same_name":
      return t.filterSameName;
    case "to_check":
      return t.filterToCheck;
    case "rekordbox":
      return t.filterRekordbox;
  }
}

/** La barre : MONTÉE une fois par passage sur l'écran (le routeur la vide à chaque navigation),
 *  puis MUTÉE — compte, valeur du filtre, libellé et état du bouton d'application. Appelée à chaque
 *  frappe de recherche et à chaque geste sur le plan : un remontage par frappe recréerait les deux
 *  boutons pour changer un nombre. */
function paintBar(visibleCount: number): void {
  const t = T();
  const countEl = document.getElementById("sift-tb-count");
  if (countEl) countEl.textContent = t.groups(visibleCount);
  // Le plan tel que la table le montre — copies que Rekordbox joue comprises quand l'utilisateur
  // les a décochées —, comme `applyPlan` le teste : grisé ici et Ctrl+Entrée refusé, c'est la même
  // règle. La confirmation propose ensuite de garder celles que Rekordbox joue.
  const n = planTotals(visibleGroups(groups, filter, query), plan, touched, false).copies.length;
  let apply = document.querySelector<HTMLButtonElement>('[data-dups="apply"]');
  if (!apply) {
    mountBarActions(
      `<button data-dups="filterpop" class="sift-bib-facet-btn" aria-haspopup="true" aria-expanded="false">` +
        `<span class="sift-bib-facet-kind">${t.groupsMenu}</span>` +
        `<span class="sift-bib-facet-val"></span>` +
        `<i class="ti ti-chevron-down" aria-hidden="true"></i></button>` +
        `<button data-dups="apply" class="sift-secondary-trash sift-bar-btn"></button>`,
    );
    mountBarSearch({
      placeholder: t.search,
      ariaLabel: t.search,
      value: query,
      onInput: (v) => {
        query = v;
        refreshTable();
      },
    });
    apply = document.querySelector<HTMLButtonElement>('[data-dups="apply"]');
  }
  const val = document.querySelector<HTMLElement>('[data-dups="filterpop"] .sift-bib-facet-val');
  if (val) val.textContent = filterLabel(filter);
  if (apply) {
    apply.textContent = t.apply(n);
    apply.disabled = n === 0 || applying;
  }
}

const FILTER_POP_ID = "sift-dups-filter-pop";
/** L'écouteur de fermeture du pop-up ouvert : retiré à CHAQUE fermeture, quel qu'en soit le
 *  chemin — resté posé, celui d'un pop-up fermé par son déclencheur fermait le suivant. */
let dismissPop: ((e: Event) => void) | null = null;

function closeFilterPop(): void {
  document.getElementById(FILTER_POP_ID)?.remove();
  document.querySelector('[data-dups="filterpop"]')?.setAttribute("aria-expanded", "false");
  if (dismissPop) {
    document.removeEventListener("mousedown", dismissPop, true);
    document.removeEventListener("keydown", dismissPop, true);
    dismissPop = null;
  }
}

/** Le pop-up « Groupes » : un choix exclusif, coché, avec les comptes — même composant que la
 *  facette de Rangés (`.sift-facet-pop`, `.sift-menu-*`, HIG « Pop-up buttons »). */
function openFilterPop(btn: HTMLElement): void {
  closeFilterPop();
  const counts = filterCounts(groups);
  const pop = document.createElement("div");
  pop.id = FILTER_POP_ID;
  pop.className = "sift-facet-pop";
  pop.setAttribute("role", "menu");
  const item = (f: GroupFilter) =>
    `<button type="button" class="sift-menu-item" data-dupsfilter="${f}" role="menuitemradio" aria-checked="${filter === f}">` +
    `<span class="sift-menu-check" aria-hidden="true">${filter === f ? "✓" : ""}</span>` +
    `<span class="sift-menu-label">${filterLabel(f)}</span><span class="sift-menu-count">${counts[f]}</span></button>`;
  pop.innerHTML =
    `<div class="sift-menu-section">${item("all")}</div>` +
    `<div class="sift-menu-section">${GROUP_FILTERS.filter((f) => f === "identical" || f === "same_sound" || f === "same_name").map(item).join("")}</div>` +
    `<div class="sift-menu-section">${item("to_check")}${item("rekordbox")}</div>`;
  document.body.appendChild(pop);
  btn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
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
    }),
  );
  pop.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-dupsfilter]");
    if (!b) return;
    filter = b.dataset.dupsfilter as GroupFilter;
    closeFilterPop();
    refreshTable();
  });
  const dismiss = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Escape") return;
    // Le déclencheur se ferme lui-même au clic (`wireTable`) : fermer ici sur son `mousedown` le
    // ferait rouvrir aussitôt par le `click` qui suit.
    const target = e.target as HTMLElement | null;
    if (e.type === "mousedown" && (pop.contains(target) || target?.closest?.('[data-dups="filterpop"]'))) return;
    closeFilterPop();
  };
  dismissPop = dismiss;
  document.addEventListener("mousedown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
}

// ---------------------------------------------------------------------------
// Inspecteur
// ---------------------------------------------------------------------------

function renderRest(): void {
  const host = openAside();
  if (!host) return;
  const t = T();
  const s = restSummary(groups, plan, touched);
  const row = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;
  host.innerHTML =
    `<div class="col-h">${t.restTitle}</div>` +
    `<div class="sift-sel-count">${t.groups(s.groups)}</div>` +
    `<dl class="sift-sel-rows">` +
    row(t.restExtra, String(s.extraCopies)) +
    row(t.restInPlan, String(s.inPlan)) +
    row(t.restRecoverable, fmtSize(s.bytes)) +
    `</dl>` +
    `<dl class="sift-sel-rows sift-dups-rest-h">` +
    row(t.filterIdentical, String(s.identical)) +
    row(t.filterSameSound, String(s.sameSound)) +
    row(t.filterSameName, String(s.sameName)) +
    `</dl>` +
    `<dl class="sift-sel-rows sift-dups-rest-h">` +
    row(t.restToCheck, String(s.toCheck)) +
    row(t.filterRekordbox, String(s.withRekordbox)) +
    `</dl>` +
    `<div class="col-h sift-dups-rest-h">${t.restRuleTitle}</div>` +
    `<div class="sift-ec-rule">${t.restRule}</div>` +
    (preferred.size
      ? `<div class="col-h sift-dups-rest-h">${t.restPreferred}</div><dl class="sift-sel-rows">` +
        [...preferred.entries()].map(([dir, n]) => row(esc(fileName(dir)), t.groups(n))).join("") +
        `</dl>`
      : "");
}

function findCopy(id: number): { g: DupScreenGroup; c: DupScreenCopy } | null {
  for (const g of groups) {
    const c = g.copies.find((x) => x.id === id);
    if (c) return { g, c };
  }
  return null;
}

function whySentence(g: DupScreenGroup, kept: DupScreenCopy, other: DupScreenCopy): string {
  const t = T();
  const fmt = kept.format.toUpperCase();
  switch (ruleReason(g, kept, other)) {
    case "missing":
      return t.whyMissing;
    case "truncated":
      return t.whyTruncated;
    case "verdict":
      return t.whyVerdict(fmt);
    case "verdict_grey":
      return t.whyVerdictGrey(fmt);
    case "lossless":
      return t.whyLossless(fmt);
    case "bitrate":
      return t.whyBitrate(fmt);
    case "rate":
      return t.whyRate(fmt);
    case "aiff":
      return t.whyAiff;
    case "tie":
      return t.whyTie;
    case "user":
      return t.whyUser;
    case "rekordbox":
      return t.whyRekordbox;
  }
}

function linkSentence(g: DupScreenGroup, a: DupScreenCopy, b: DupScreenCopy): string {
  const t = T();
  const link = g.links.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
  if (link?.kind === "identical") return t.linkIdentical;
  if (link?.kind === "same_sound") return t.linkSameSound((link.similarity ?? 1).toFixed(2).replace(".", t.decimalSep));
  return a.name_key && a.name_key === b.name_key ? t.linkSameName : "";
}

function compareHtml(g: DupScreenGroup, c: DupScreenCopy, other: DupScreenCopy): string {
  const t = T();
  const openedKept = isKept(plan, c);
  const what = `${other.format.toUpperCase()} · ${shortDir(other, sources)}`;
  const sub = openedKept ? t.comparedBestOther(g.copies.length - 1) : t.comparedKept;
  const link = linkSentence(g, c, other);
  const verdictCell = (x: DupScreenCopy) => {
    const v = verdictView(x.verdict);
    return `<span class="${v.cls}"><span class="sift-lib-verdict-dot" aria-hidden="true"></span>${v.word}</span>`;
  };
  const ident = (x: DupScreenCopy) => (x.discogs_release_id ? t.identified(x.year) : t.notIdentified);
  const rkb = (x: DupScreenCopy) => {
    const p = rekordboxPlaylists(x);
    if (p != null) return t.playlists(p);
    return x.rekordbox.state === "unknown" ? t.rekordboxUnknownShort : t.rekordboxAbsent;
  };
  const line = (label: string, a: string, b: string) =>
    `<span class="sift-dups-cmp-l">${label}</span><span class="sift-dups-cmp-v">${a}</span><span class="sift-dups-cmp-v">${b}</span>`;
  const keptOne = openedKept ? c : other;
  const otherOne = openedKept ? other : c;
  return (
    `<div class="sift-dups-cmp-sec">` +
    `<div class="col-h">${esc(t.comparedTo(what))}</div>` +
    `<div class="sift-dups-cmp-proof">${esc([sub, link].filter(Boolean).join(" · "))}</div>` +
    `<div class="sift-dups-cmp">` +
    `<span></span><span class="sift-dups-cmp-h">${t.thisCopy}</span><span class="sift-dups-cmp-h">${esc(other.format.toUpperCase())}</span>` +
    line(t.rowVerdict, verdictCell(c), verdictCell(other)) +
    line(t.rowCutoff, fmtKhz(c.cutoff_hz), fmtKhz(other.cutoff_hz)) +
    line(t.rowFormat, esc(c.format.toUpperCase()), esc(other.format.toUpperCase())) +
    line(t.rowBitrate, fmtKbps(c.bitrate), fmtKbps(other.bitrate)) +
    line(t.rowRate, fmtKhz(c.sample_rate), fmtKhz(other.sample_rate)) +
    line(t.rowDuration, fmtDuration(c.duration), fmtDuration(other.duration)) +
    line(t.rowSize, c.size_bytes == null ? "—" : fmtSize(c.size_bytes), other.size_bytes == null ? "—" : fmtSize(other.size_bytes)) +
    line(t.rowFolder, esc(shortDir(c, sources)), esc(shortDir(other, sources))) +
    line(t.rowIdent, ident(c), ident(other)) +
    line(t.rowRekordbox, rkb(c), rkb(other)) +
    `</div>` +
    `<div class="sift-dups-why">${esc(whySentence(g, keptOne, otherOne))}</div>` +
    `</div>`
  );
}

/** La copie dont le lecteur est monté dans la zone D, et le minuteur qui le monte. Le lecteur
 *  (`openReportInto`) détruit le précédent, relance l'analyse en IPC et coupe l'écoute : il ne se
 *  monte qu'une fois la copie ouverte STABLE depuis 150 ms (même délai que l'ouverture d'une piste
 *  de la file). ↑ ↓ maintenus (auto-répétition ~30/s) ne repeignent donc que la comparaison. */
let reportFor: number | null = null;
let reportTimer: ReturnType<typeof setTimeout> | undefined;
const REPORT_DELAY_MS = 150;

/** Ouvre `id` dans la zone D : l'ossature (lecteur, comparaison, diagnostic) se pose UNE fois, puis
 *  seule la comparaison se repeint ; le lecteur suit, coalescé. */
function renderDetail(id: number): void {
  const host = openAside();
  if (!host || !findCopy(id)) return;
  if (!host.querySelector(".sift-dups-detail")) {
    host.innerHTML =
      `<div class="lib-detail-stack sift-dups-detail">` +
      `<div class="lib-report"></div>` +
      `<div class="sift-dups-cmp-slot"></div>` +
      `<div class="lib-diag"></div>` +
      `<div class="lib-verdict"></div>` +
      `</div>`;
    reportFor = null;
  }
  paintCompare();
  if (reportFor !== id) scheduleReport(id);
}

/** Repeint la seule comparaison de la copie ouverte : un geste sur le plan change la copie
 *  comparée et la phrase de la règle, jamais le lecteur. Fréquence : ↑ ↓ maintenus, ~30/s en
 *  auto-répétition — coalescé à une image (`requestAnimationFrame`), la comparaison peinte est
 *  celle de la copie ouverte quand l'image part. */
let compareFrame = 0;
function paintCompare(): void {
  if (compareFrame) return;
  compareFrame = requestAnimationFrame(() => {
    compareFrame = 0;
    const slot = document.querySelector<HTMLElement>("#sift-aside .sift-dups-cmp-slot");
    const found = openId != null ? findCopy(openId) : null;
    if (!slot || !found) return;
    const other = compareTarget(found.g, found.c.id, plan);
    slot.innerHTML = other ? compareHtml(found.g, found.c, other) : "";
  });
}

function scheduleReport(id: number): void {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const host = document.getElementById("sift-aside");
    const found = findCopy(id);
    if (openId !== id || !host || !found || !host.querySelector(".sift-dups-detail")) return;
    const reportEl = requireEl<HTMLElement>(".lib-report", "scheduleReport", host);
    const diagEl = requireEl<HTMLElement>(".lib-diag", "scheduleReport", host);
    const verdictEl = requireEl<HTMLElement>(".lib-verdict", "scheduleReport", host);
    reportFor = id;
    // Une copie absente ne s'ouvre pas dans le lecteur : `openReportInto` lancerait l'analyse, et
    // l'échec d'un fichier disparu SUPPRIME sa ligne en base (`FILE_GONE`). L'écran la montre
    // « introuvable » et ne l'envoie jamais ; il ne la retire pas en douce.
    if (found.c.missing) {
      reportEl.textContent = "";
      diagEl.textContent = "";
      verdictEl.textContent = "";
      return;
    }
    const { g, c } = found;
    void openReportInto(
      reportEl,
      c.path,
      verdictEl,
      {
        showAnalysisFailure: false,
        title: [g.title, g.version ? `(${g.version})` : ""].filter(Boolean).join(" "),
        subtitle: g.artist ?? undefined,
      },
      diagEl,
    );
  }, REPORT_DELAY_MS);
}

function openCopy(id: number | null, scroll = false): void {
  openId = id;
  document
    .querySelectorAll<HTMLElement>(".lr[data-dupcopy]")
    .forEach((r) => {
      const on = Number(r.dataset.dupcopy) === id;
      r.classList.toggle("cur", on);
      r.setAttribute("aria-selected", String(on));
    });
  if (id == null) {
    clearTimeout(reportTimer);
    reportFor = null;
    renderRest();
    return;
  }
  if (scroll) scrollRowIntoView(id);
  renderDetail(id);
}

function scrollRowIntoView(id: number): void {
  const content = document.getElementById("content");
  const idx = rows.findIndex((r) => r.kind === "copy" && r.copy.id === id);
  const first = document.querySelector<HTMLElement>(".lr[data-dupcopy], .lr[data-dupgroup]");
  const host = document.getElementById("sift-dups-list");
  if (!content || !host || idx < 0 || !first) return;
  const rowH = first.getBoundingClientRect().height || 32;
  // Position de la liste DANS la zone défilante, mesurée par les rectangles : `offsetTop` se lit
  // contre le plus proche ancêtre positionné, qui n'est pas `#content` (même piège évité par
  // `list-virtual.ts`).
  const listTop = host.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
  const top = listTop + idx * rowH;
  if (top < content.scrollTop + rowH) content.scrollTop = Math.max(0, top - rowH);
  else if (top + rowH > content.scrollTop + content.clientHeight - 2 * rowH) {
    content.scrollTop = top + 3 * rowH - content.clientHeight;
  }
}

// ---------------------------------------------------------------------------
// Gestes sur le plan
// ---------------------------------------------------------------------------

/** Le groupe est tranché par l'utilisateur : toutes ses copies gardent leur case aux relectures. */
function touch(g: DupScreenGroup): void {
  touched.add(g.id);
  for (const c of g.copies) decided.add(c.id);
}

function setKeep(g: DupScreenGroup, c: DupScreenCopy, keep: boolean): void {
  if (!keepable(c)) return;
  plan.set(c.id, keep);
  touch(g);
}

function keepOnly(id: number): void {
  const found = findCopy(id);
  if (!found || !keepable(found.c)) return;
  for (const x of found.g.copies) setKeep(found.g, x, x.id === id);
  afterPlanChange([found.g.id]);
}

function dontKeep(id: number): void {
  const found = findCopy(id);
  if (!found) return;
  setKeep(found.g, found.c, false);
  afterPlanChange([found.g.id]);
}

/** Après un geste sur le plan : les rangées des groupes touchés se patchent, la barre se mute, et
 *  l'inspecteur ne repeint que ce qui dépend du plan (le résumé au repos, ou la comparaison). */
function afterPlanChange(gids: readonly number[]): void {
  for (const gid of gids) patchGroupRows(gid);
  paintBar(visibleGroups(groups, filter, query).length);
  if (openId == null) renderRest();
  else paintCompare();
}

function moveOpen(delta: 1 | -1): void {
  const copies = rows.filter((r): r is Extract<DupRow, { kind: "copy" }> => r.kind === "copy");
  if (!copies.length) return;
  const i = copies.findIndex((r) => r.copy.id === openId);
  const next = i < 0 ? (delta > 0 ? 0 : copies.length - 1) : Math.min(copies.length - 1, Math.max(0, i + delta));
  openCopy(copies[next].copy.id, true);
}

function openMenu(x: number, y: number, g: DupScreenGroup, c: DupScreenCopy): void {
  const t = T();
  const kept = isKept(plan, c);
  openContextMenu(x, y, [
    { label: t.keepOnly, onPick: keepable(c) ? () => keepOnly(c.id) : undefined },
    {
      label: t.keepAlso,
      onPick:
        keepable(c) && !kept
          ? () => {
              setKeep(g, c, true);
              afterPlanChange([g.id]);
            }
          : undefined,
    },
    {
      label: t.preferFolder,
      onPick: keepable(c)
        ? () => {
            const dir = parentDir(c.path);
            const res = preferFolder(groups, plan, dir);
            const label = t.preferred(shortDir(c, sources), res.changed.length);
            if (!res.changed.length) {
              toast(label);
              return;
            }
            // Un clic recoche N groupes d'un coup : le bandeau offre Annuler (spec § Interactions),
            // qui rend le plan d'avant tel quel.
            const before = {
              plan: new Map(plan),
              touched: new Set(touched),
              decided: new Set(decided),
              preferred: new Map(preferred),
            };
            plan = res.plan;
            for (const gid of res.changed) {
              const changed = groups.find((x) => x.id === gid);
              if (changed) touch(changed);
            }
            preferred.set(dir, (preferred.get(dir) ?? 0) + res.changed.length);
            toast(label, true, () => {
              plan = before.plan;
              touched = before.touched;
              decided = before.decided;
              preferred.clear();
              for (const [k, v] of before.preferred) preferred.set(k, v);
              afterPlanChange(res.changed);
            });
            afterPlanChange(res.changed);
          }
        : undefined,
    },
    {
      label: t.listen,
      separated: true,
      onPick: c.missing
        ? undefined
        : () => {
            revealAside();
            openCopy(c.id);
          },
    },
    {
      label: t.reveal,
      onPick: c.missing
        ? undefined
        : () => void revealTrack(c.id).catch((err: unknown) => toast(humanizeError(err, T().revealFailed, "reveal_track"))),
    },
    {
      label: t.notDuplicates,
      separated: true,
      onPick: () =>
        void refuseDuplicateGroup(g.copies.map((x) => x.id))
          .then(() => {
            if (openId != null && g.copies.some((x) => x.id === openId)) openId = null;
            return renderDoublons();
          })
          .catch((err: unknown) => toast(humanizeError(err, T().notDuplicatesFailed, "refuse_duplicate_group"))),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

async function applyPlan(): Promise<void> {
  if (applying) return;
  const t = T();
  const scope = visibleGroups(groups, filter, query);
  const withRkb = planTotals(scope, plan, touched, true);
  const withoutRkb = planTotals(scope, plan, touched, false);
  if (withoutRkb.copies.length === 0) return;
  const res = await confirmTrashPlan({
    paint: (keepRekordbox) => {
      const p = keepRekordbox ? withRkb : withoutRkb;
      return {
        title: t.confirmTitle(p.copies.length),
        recap: t.confirmRecap(p.copies.length, fmtSize(p.bytes), p.groups),
        confirm: t.confirmButton(p.copies.length),
      };
    },
    note: t.confirmNote(withRkb.toCheckLeft),
    rekordboxCount: withRkb.rekordboxCopies,
    rekordboxLabel: t.keepRekordbox(withRkb.rekordboxCopies),
  });
  if (!res.confirmed) return;
  const chosen = res.keepRekordbox ? withRkb : withoutRkb;
  const ids = chosen.copies.map((c) => c.id);
  if (!ids.length) return;
  await runApply(ids);
}

/** La feuille, non modale, en haut de la zone C (`.sift-batch-sheet`, forme de la feuille de copie
 *  du Finder). Elle vit dans une ancre COLLANTE de hauteur nulle, en tête de la table : la zone C
 *  défile, la feuille reste en haut de ce qu'on voit, sans pousser la table. Posée en absolu sur un
 *  hôte non positionné, elle s'ancrait à la fenêtre et couvrait la barre (revue du 2026-10-05). */
function mountSheet(state: "progress" | "report", html: string): HTMLElement | null {
  const main = document.querySelector<HTMLElement>(".sift-dups-main");
  if (!main) return null;
  document.querySelector(".sift-dups-sheet-anchor")?.remove();
  const anchor = document.createElement("div");
  anchor.className = "sift-dups-sheet-anchor";
  const sheet = document.createElement("div");
  sheet.className = "sift-batch-sheet sift-batch-sheet--open";
  sheet.dataset.state = state;
  sheet.innerHTML = html;
  anchor.appendChild(sheet);
  main.insertBefore(anchor, main.firstChild);
  return sheet;
}

/** La feuille de progression : barre déterminée, copie courante, Arrêter. */
function showSheet(total: number): HTMLElement | null {
  const t = T();
  return mountSheet(
    "progress",
    `<div class="sift-bs-head"><div class="sift-bs-title">${t.sheetTitle(total)}</div>` +
      `<button class="sift-baction sift-baction--quiet sift-bs-stop" data-dups="stop">${t.stop}</button></div>` +
      `<progress class="sift-bs-bar" value="0" max="${total}"></progress>` +
      `<div class="sift-bs-step"></div>`,
  );
}

/** Échec partiel (spec § États) : la feuille devient le rapport — les copies qui ont résisté, et
 *  pourquoi. Le reste est appliqué et s'annule d'un clic. Patron : `batch-sheet.ts::transformToReport`. */
function showReport(res: DupApplyResult, names: ReadonlyMap<number, string>): void {
  const t = T();
  const items = res.failed
    .map(
      (f) =>
        `<div class="sift-bs-item"><span class="sift-bs-item-name">${esc(names.get(f.id) ?? String(f.id))}</span>` +
        `<span class="sift-bs-item-err">${esc(f.error)}</span></div>`,
    )
    .join("");
  mountSheet(
    "report",
    `<div class="sift-bs-title sift-bs-title--report">${esc(t.partial(res.trashed.length, res.failed.length))}</div>` +
      `<details class="sift-bs-section sift-bs-section--error" open>` +
      `<summary>${esc(t.reportFailed(res.failed.length))}</summary>` +
      `<div class="sift-bs-items">${items}</div></details>` +
      `<div class="sift-bs-footer">` +
      (res.batch_id ? `<button class="sift-baction sift-baction--quiet" data-dups="reportundo">${t.undo}</button>` : "") +
      `<button class="sift-baction sift-baction--quiet" data-dups="reportclose">${t.close}</button></div>`,
  );
}

async function runApply(ids: number[]): Promise<void> {
  const t = T();
  applying = true;
  paintBar(visibleGroups(groups, filter, query).length);
  const sheet = showSheet(ids.length);
  const names = new Map<number, string>();
  for (const g of groups) for (const c of g.copies) names.set(c.id, fileName(c.path));
  let unlisten: (() => void) | null = null;
  let report: DupApplyResult | null = null;
  try {
    // Dans le `try` : un abonnement refusé ne doit pas laisser `applying` levé pour toujours.
    unlisten = await onDuplicatePlanProgress((p) => {
      if (!sheet) return;
      const bar = sheet.querySelector<HTMLProgressElement>(".sift-bs-bar");
      if (bar) bar.value = p.done;
      const step = sheet.querySelector<HTMLElement>(".sift-bs-step");
      if (step) step.textContent = t.sheetStep(p.done, p.total, names.get(p.id) ?? "");
    });
    const res = await applyDuplicatePlan(ids);
    const n = res.trashed.length;
    lastBatch = res.batch_id;
    if (res.failed.length) {
      for (const f of res.failed) console.error("doublons : copie non envoyée", f.id, f.error);
      report = res;
    } else if (n > 0 && res.batch_id) {
      const batch = res.batch_id;
      toast(t.done(n), true, () => undoAndRefresh(batch));
    }
  } catch (err) {
    toast(humanizeError(err, t.applyFailed, "apply_duplicate_plan"));
  } finally {
    unlisten?.();
    sheet?.closest(".sift-dups-sheet-anchor")?.remove();
    applying = false;
    if (openId != null && !findCopy(openId)) openId = null;
    await renderDoublons();
    if (report && document.body.dataset.view === "dups") showReport(report, names);
  }
}

/** Annule l'application `batch` — CE lot, pas le plus récent du journal (`undo_last`) : un autre
 *  geste a pu se glisser entre l'application et le clic sur Annuler. */
function undoAndRefresh(batch: string): void {
  void revertBatch(batch)
    .then(() => renderDoublons())
    .catch((err: unknown) => toast(humanizeError(err, T().undoFailed, "revert_batch")));
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/** Garde les choix de l'utilisateur sur les copies qu'il a tranchées et qui existent encore ; tout
 *  le reste repart des cases de la règle (`duplicates-model.ts::rebasePlan`). */
function rebase(next: DupScreenGroup[]): void {
  const r = rebasePlan(next, plan, decided);
  plan = r.plan;
  touched = r.touched;
  decided = r.decided;
}

/** `soft` : rafraîchissement venu de `queue:changed` (rafales coalescées à 400 ms : scan, watcher,
 *  rangement, Ctrl+Z). Rien de changé : rien ne se repeint. Sinon la table se remet à jour DANS
 *  l'écran monté, et l'inspecteur garde son lecteur tant que la copie ouverte existe — une
 *  analyse de fond ne coupe pas une écoute. */
export async function renderDoublons(opts: { soft?: boolean } = {}): Promise<void> {
  // Appelé aussi APRÈS coup — fin d'une application, Annuler d'un toast, refus d'un groupe — alors
  // que l'utilisateur a pu changer d'écran : le jeton d'époque, pris ici, serait celui de l'autre
  // écran, et le rendu repeindrait son `#content`. Le routeur pose `data-view` avant d'appeler.
  if (document.body.dataset.view !== "dups") return;
  const content = requireEl<HTMLElement>("#content", "renderDoublons");
  const token = viewEpoch();
  installDoublonsKeys();
  // Posés dès le premier passage, même en erreur : le « Réessayer » d'un premier chargement raté
  // n'a pas d'autre écouteur.
  if (!tableWired) {
    wireTable(content);
    tableWired = true;
  }
  if (!content.querySelector(".sift-dups-main, .sift-empty-state")) {
    content.innerHTML = `<div class="sift-library-main"><span class="sift-skel sift-skel-line"></span></div>`;
  }
  let next: DupScreenGroup[];
  try {
    [next, sources] = await Promise.all([listDuplicateGroups(), listSources()]);
    if (isStaleViewRender(token)) return;
  } catch (err) {
    console.error("list_duplicate_groups failed", err);
    if (isStaleViewRender(token)) return;
    virtual?.destroy();
    virtual = null;
    const t = T();
    content.innerHTML =
      `<div class="sift-library-main"><div class="sift-ec-fail">${t.loadFailed} ${esc(String(err))} ` +
      `<button data-dups="retry" class="sift-meta-ident-btn">${t.retry}</button></div></div>`;
    mountBarActions("");
    closeAside();
    return;
  }
  if (opts.soft && content.querySelector(".sift-dups-main") && groups.length > 0 && next.length > 0) {
    if (JSON.stringify(next) === JSON.stringify(groups)) return;
    groups = next;
    rebase(next);
    if (openId != null && !findCopy(openId)) openCopy(null);
    refreshTable();
    if (openId != null) paintCompare();
    else renderRest();
    return;
  }
  groups = next;
  rebase(next);
  if (pendingFocus != null) {
    // Venue de Revue : la copie s'ouvre si elle est dans un groupe ; sinon l'écran s'ouvre au repos.
    openId = findCopy(pendingFocus) ? pendingFocus : null;
    pendingFocus = null;
  }
  if (openId != null && !findCopy(openId)) openId = null;

  if (groups.length === 0) {
    virtual?.destroy();
    virtual = null;
    rows.length = 0;
    const t = T();
    content.innerHTML = emptyStateHtml({ title: t.emptyTitle, note: t.emptyNote, backToRevue: true });
    wireEmptyState(content);
    mountBarActions("");
    const countEl = document.getElementById("sift-tb-count");
    if (countEl) countEl.textContent = "";
    closeAside();
    return;
  }

  const t = T();
  virtual?.destroy();
  content.innerHTML =
    `<div class="sift-library-main sift-dups-main">${headHtml()}` +
    `<div id="sift-dups-list" role="listbox" aria-label="${t.listAria}"></div>${legendHtml()}</div>`;
  const listHost = requireEl<HTMLElement>("#sift-dups-list", "renderDoublons", content);
  rows.length = 0;
  rows.push(...flattenRows(visibleGroups(groups, filter, query)));
  virtual = createVirtualList<DupRow>({
    host: listHost,
    scrollContainer: content,
    items: rows,
    rowHtml: (row) => dupRowHtml(row, rowView()),
    probeHtml: rows.length ? dupRowHtml(rows[0], rowView()) : "",
    fallbackRowH: 32,
  });
  paintBar(visibleGroups(groups, filter, query).length);
  if (openId != null) {
    scrollRowIntoView(openId);
    renderDetail(openId);
  } else renderRest();
}

function wireTable(content: HTMLElement): void {
  content.addEventListener("click", (e) => {
    if (document.body.dataset.view !== "dups") return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-dups="retry"]')) {
      void renderDoublons();
      return;
    }
    if (t.closest('[data-dups="stop"]')) {
      void stopDuplicatePlan();
      return;
    }
    if (t.closest('[data-dups="reportclose"]')) {
      document.querySelector(".sift-dups-sheet-anchor")?.remove();
      return;
    }
    if (t.closest('[data-dups="reportundo"]')) {
      document.querySelector(".sift-dups-sheet-anchor")?.remove();
      if (lastBatch) undoAndRefresh(lastBatch);
      return;
    }
    const ck = t.closest<HTMLInputElement>("[data-dupkeep]");
    if (ck) {
      const found = findCopy(Number(ck.dataset.dupkeep));
      if (found) {
        setKeep(found.g, found.c, ck.checked);
        afterPlanChange([found.g.id]);
      }
      return;
    }
    const row = t.closest<HTMLElement>("[data-dupcopy]");
    // Le second clic d'un double-clic ne referme pas la copie qu'il vient d'ouvrir : le double-clic
    // a son propre geste, juste dessous.
    if (row && e.detail <= 1) {
      const id = Number(row.dataset.dupcopy);
      openCopy(openId === id ? null : id);
    }
  });
  // Double-clic : écouter (spec § Interactions) — même geste que « Écouter » au menu : la copie
  // s'ouvre dans l'inspecteur, qui porte le lecteur.
  content.addEventListener("dblclick", (e) => {
    if (document.body.dataset.view !== "dups") return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-dupkeep]")) return;
    const row = t.closest<HTMLElement>("[data-dupcopy]");
    const found = row ? findCopy(Number(row.dataset.dupcopy)) : null;
    if (!found || found.c.missing) return;
    revealAside();
    if (openId !== found.c.id) openCopy(found.c.id);
  });
  content.addEventListener("contextmenu", (e) => {
    if (document.body.dataset.view !== "dups") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-dupcopy]");
    if (!row) return;
    e.preventDefault();
    const found = findCopy(Number(row.dataset.dupcopy));
    if (!found) return;
    // Le clic droit OUVRE d'abord la copie (comme dans Rangés), puis le menu.
    if (openId !== found.c.id) openCopy(found.c.id);
    openMenu(e.clientX, e.clientY, found.g, found.c);
  });
  // La barre unifiée vit hors de `#content` : son délégué est sur le document, filtré par vue.
  document.addEventListener("click", (e) => {
    if (document.body.dataset.view !== "dups") return;
    const t = e.target as HTMLElement;
    const pop = t.closest<HTMLElement>('[data-dups="filterpop"]');
    if (pop) {
      if (document.getElementById(FILTER_POP_ID)) closeFilterPop();
      else openFilterPop(pop);
      return;
    }
    if (t.closest('[data-dups="apply"]')) void applyPlan();
  });
}

/** Clavier de l'écran (spec § Interactions) : ↑ ↓, Espace, Entrée, ⌫, Ctrl+Entrée. Ctrl+Z est
 *  global (`filing.ts::installUndoShortcut`) ; le retour des copies repeint l'écran par
 *  `queue:changed`, que `undo_last` émet. Ni Entrée ni ⌫ n'exécutent rien : ils changent le plan. */
function installDoublonsKeys(): void {
  if (keysWired) return;
  keysWired = true;
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "dups" || applying) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      if (!(target instanceof HTMLInputElement && target.type === "checkbox")) return;
    }
    if (target?.closest('[role="menu"], [role="alertdialog"], #sift-context-menu')) return;
    // Une confirmation ouverte bloque tout, même quand le focus a quitté sa carte (un clic dans son
    // texte le rend à <body>) : repérée par son voile, comme `shortcuts.ts`.
    if (document.getElementById("sift-confirm-overlay")) return;
    // Un curseur du lecteur (volume, position) prend ↑ ↓ pour lui ; un bouton ou un lien focalisé
    // prend Entrée et Espace — sa propre activation, pas un geste sur le plan (`chrome.ts`, même
    // règle pour la navigation au clavier). Une case Garder prend Espace : la cocher.
    const onSlider = !!target?.closest('[role="slider"]');
    const onControl = !!target?.closest('button, a, [role="button"], summary');
    const onCheckbox = target instanceof HTMLInputElement && target.type === "checkbox";
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void applyPlan();
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case "ArrowDown":
        if (onSlider) return;
        e.preventDefault();
        moveOpen(1);
        return;
      case "ArrowUp":
        if (onSlider) return;
        e.preventDefault();
        moveOpen(-1);
        return;
      case " ":
        if (openId == null || onControl || onCheckbox) return;
        e.preventDefault();
        togglePlay();
        return;
      // Entrée et ⌫ changent le plan : une touche tenue (auto-répétition ~30/s) ne rejoue pas le
      // geste — le premier appui suffit, les suivants ne changeraient rien qu'à repeindre.
      case "Enter":
        if (openId == null || e.repeat || onControl) return;
        e.preventDefault();
        keepOnly(openId);
        return;
      case "Backspace":
        if (openId == null || e.repeat) return;
        e.preventDefault();
        dontKeep(openId);
        return;
    }
  });
  // Le retour de copies (Ctrl+Z, Restaurer) et l'arrivée de pistes changent les groupes : repeindre
  // l'écran s'il est affiché. Rafales coalescées, comme le rafraîchissement de la file ; le rendu
  // DOUX ne repeint rien quand rien n'a changé.
  let timer: ReturnType<typeof setTimeout> | undefined;
  void onQueueChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.body.dataset.view === "dups" && !applying) void renderDoublons({ soft: true });
    }, 400);
  });
}
