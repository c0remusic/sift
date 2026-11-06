// Doublons — destination du rail sous Revue (Tauri only). Spec : `docs/ui-specs/doublons.md`,
// option B décidée par Antoine le 2026-10-30 : une FILE DE TRI, la grammaire de Revue appliquée aux
// groupes. La file à gauche, UN groupe ouvert au centre, ses copies en colonnes, et une rangée
// « Issue » qui dit en toutes lettres ce que deviendra chaque copie. Entrée résout le groupe tout de
// suite (annulable) et passe au suivant ; le mode Lot résout N groupes en une application confirmée.
//
// Ce qui ne change pas de l'hybride du 2026-10-05 : la formation des groupes, la preuve, la copie
// recommandée (`pick_keep` v2, côté Rust), la corbeille par disque, la garde des copies Rekordbox.
// Le modèle (plan, Issue, conséquence, résumé du Lot) est pur et testé à part :
// `duplicates-model.ts` ; le markup aussi, exécuté par sa story : `duplicates-rows.ts`.
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
import { closeAside, mountBarActions, mountBarSearch } from "./toolbar";
import { openContextMenu } from "./context-menu";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { confirmTrashPlan } from "./confirm-modal";
import { openReportInto, playerPosition, resumeNextPlayer, togglePlay } from "./report-view";
import { anchoredBelowPosition } from "./popover-position";
import { pickNextAfter } from "./queue-next";
import { clickedSelection } from "./queue-selection";
import {
  fileName,
  filterCounts,
  GROUP_FILTERS,
  groupOutcome,
  isKept,
  keepable,
  lotSummary,
  parentDir,
  preferFolder,
  rebasePlan,
  recommendedCopy,
  toggleIssue,
  unverifiedRekordbox,
  visibleGroups,
  type GroupFilter,
  type Plan,
  peindreDeMemoire,
} from "./duplicates-model";
import {
  consequenceHtml,
  fmtSize,
  gridHtml,
  groupFactsHtml,
  keepButtonLabel,
  legendHtml,
  queueRowHtml,
  shortDir,
} from "./duplicates-rows";
import { T } from "./i18n/duplicates-view";

// ---------------------------------------------------------------------------
// État de l'écran
// ---------------------------------------------------------------------------

let groups: DupScreenGroup[] = [];
/** `groups` vient d'une lecture réussie : une liste vide y veut dire « aucun doublon ». */
let lu = false;
let plan: Plan = new Map();
/** Les copies dont l'utilisateur a changé l'Issue : leur choix survit aux relectures des groupes
 *  (`rebasePlan`), indexé par COPIE — l'id d'un groupe change quand sa copie de plus petit id part. */
let decided = new Set<number>();
let filter: GroupFilter = "all";
let query = "";
/** Le groupe ouvert dans la boîte, et la copie sous le curseur. */
let openGid: number | null = null;
let cursorId: number | null = null;
let sources: Source[] = [];
/** Mode Lot (spec § Colonne de file) : la sélection, et l'ancre de Maj+clic. */
let lot = false;
let lotSel = new Set<number>();
let lotAnchor: number | null = null;
let applying = false;
/** Le lot de la dernière application de masse, pour l'Annuler de son rapport d'échec partiel. */
let lastBatch: string | null = null;
let virtual: VirtualList | null = null;
/** Les groupes de la file. Le MÊME tableau vit dans la liste virtualisée : il se modifie sur place,
 *  puis `virtual.render()` (list-virtual.ts garde la référence reçue). */
const rows: DupScreenGroup[] = [];
let wired = false;
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
 *  zéro, pour que son groupe soit dans la file. */
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

function visible(): DupScreenGroup[] {
  return visibleGroups(groups, filter, query);
}

function findGroup(gid: number | null): DupScreenGroup | null {
  return gid == null ? null : (groups.find((g) => g.id === gid) ?? null);
}

function groupOfCopy(copyId: number): DupScreenGroup | null {
  return groups.find((g) => g.copies.some((c) => c.id === copyId)) ?? null;
}

// ---------------------------------------------------------------------------
// Barre et tête de file
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

/** Le compte de la barre (« N groupes », ou « N sélectionnés » en mode Lot, comme Revue) et la
 *  recherche, montée une fois par passage sur l'écran (le routeur vide la barre à chaque
 *  navigation). Fréquence : chaque frappe de recherche, chaque geste de Lot — le compte se MUTE. */
function paintBar(): void {
  const t = T();
  const countEl = document.getElementById("sift-tb-count");
  if (countEl) {
    countEl.textContent = lot ? t.selected(lotSel.size) : t.groups(visible().length);
    countEl.classList.toggle("sift-tb-count-lot", lot);
  }
  if (!document.getElementById("sift-tb-search")?.firstChild) {
    mountBarSearch({
      placeholder: t.search,
      ariaLabel: t.search,
      value: query,
      onInput: (v) => {
        query = v;
        refreshQueue();
      },
    });
  }
}

/** La tête de file : le pulldown « Tous ▾ » à gauche, « Sélectionner » / « Terminé » à droite.
 *  Posée vide par le shell, remplie une fois, puis seuls les libellés se mutent. */
function paintQueueHead(): void {
  const head = document.querySelector<HTMLElement>("#dqcol .sift-qhead");
  if (!head) return;
  const t = T();
  if (!head.firstChild) {
    head.innerHTML =
      `<button type="button" class="sift-qfacet-btn" data-dups="filterpop" aria-haspopup="true" aria-expanded="false">` +
      `<span class="sift-qfacet-label"></span><i class="ti ti-chevron-down" aria-hidden="true"></i></button>` +
      `<button type="button" class="sift-qselect-btn" data-dups="lot"></button>`;
  }
  const label = head.querySelector<HTMLElement>(".sift-qfacet-label");
  if (label) label.textContent = filterLabel(filter);
  const sel = head.querySelector<HTMLElement>('[data-dups="lot"]');
  if (sel) {
    sel.textContent = lot ? t.selectDone : t.select;
    sel.setAttribute("aria-pressed", String(lot));
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

/** Le menu « Tous ▾ » : un choix exclusif, coché, avec les comptes — même composant que la facette
 *  de Rangés (`.sift-facet-pop`, `.sift-menu-*`, HIG « Pop-up buttons »). */
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
    refreshQueue();
  });
  const dismiss = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Escape") return;
    // Le déclencheur se ferme lui-même au clic : fermer ici sur son `mousedown` le ferait rouvrir
    // aussitôt par le `click` qui suit.
    const target = e.target as HTMLElement | null;
    if (e.type === "mousedown" && (pop.contains(target) || target?.closest?.('[data-dups="filterpop"]'))) return;
    closeFilterPop();
  };
  dismissPop = dismiss;
  document.addEventListener("mousedown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

/** Recalcule les groupes visibles (filtre, recherche) dans le MÊME tableau, puis remonte la fenêtre
 *  de la liste. Fréquence : une frappe dans la recherche (rafale de 5 à 10/s en saisie rapide), un
 *  choix de filtre, une relecture des groupes. Le groupe ouvert reste ouvert même filtré : la boîte
 *  ne se vide pas sous les yeux pendant une frappe. */
function refreshQueue(): void {
  rows.length = 0;
  rows.push(...visible());
  virtual?.render();
  paintQueueHead();
  paintBar();
}

/** Repeint la fenêtre montée de la file : la ligne active, les cases du Lot. Fréquence : ↑ ↓
 *  maintenus (~30/s), un clic de Lot — la liste virtualisée ne réécrit que sa fenêtre. */
function repaintQueue(): void {
  virtual?.render();
}

function scrollGroupIntoView(gid: number): void {
  const ql = document.getElementById("dql");
  const idx = rows.findIndex((g) => g.id === gid);
  const first = ql?.querySelector<HTMLElement>(".qi");
  if (!ql || idx < 0) return;
  const rowH = first?.getBoundingClientRect().height || 46;
  const top = idx * rowH;
  if (top < ql.scrollTop) ql.scrollTop = top;
  else if (top + rowH > ql.scrollTop + ql.clientHeight) ql.scrollTop = top + rowH - ql.clientHeight;
}

// ---------------------------------------------------------------------------
// La boîte du groupe ouvert
// ---------------------------------------------------------------------------

/** La copie dont le lecteur est monté, et le minuteur qui le monte. Le lecteur (`openReportInto`)
 *  détruit le précédent et relance l'analyse en IPC : il ne se monte qu'une fois le curseur STABLE
 *  depuis 150 ms (même délai que l'ouverture d'une piste de la file). ← → maintenus ne bougent donc
 *  que le fond de la colonne. */
let reportFor: number | null = null;
let reportTimer: ReturnType<typeof setTimeout> | undefined;
const REPORT_DELAY_MS = 150;

/** La copie à faire jouer : celle du curseur, sauf une copie introuvable — `openReportInto`
 *  lancerait l'analyse, et l'échec d'un fichier disparu SUPPRIME sa ligne en base (`FILE_GONE`).
 *  L'écran la montre « Introuvable » et ne l'envoie jamais ; il ne la retire pas en douce. */
function playableCopy(g: DupScreenGroup): DupScreenCopy | null {
  const c = g.copies.find((x) => x.id === cursorId);
  if (c && !c.missing) return c;
  return g.copies.find((x) => !x.missing) ?? null;
}

/** Monte la boîte du groupe ouvert (ou le résumé du Lot). Le lecteur pose la coque — en-tête,
 *  rangée d'audition, et les deux emplacements `#filbox-settings` / `#filbox-foot` que la boîte de
 *  Revue réserve (`report-view.ts::playerRowHtml`) ; la grille et le pied s'y peignent. */
function paintBox(): void {
  const mid = document.getElementById("dmid");
  if (!mid) return;
  if (lot) {
    clearTimeout(reportTimer);
    reportFor = null;
    paintLotSummary(mid);
    return;
  }
  const g = findGroup(openGid);
  if (!g) {
    mid.innerHTML = "";
    reportFor = null;
    return;
  }
  const c = playableCopy(g);
  if (!mid.querySelector(".sift-dupb") || reportFor == null || !c) {
    mountReport(mid, g, c);
  } else if (c.id !== reportFor) {
    scheduleReport();
  }
  paintSlots();
}

function mountReport(mid: HTMLElement, g: DupScreenGroup, c: DupScreenCopy | null): void {
  const t = T();
  mid.innerHTML =
    `<div class="sift-dupb">` +
    `<div class="sift-dupb-report"></div>` +
    `<div class="sift-dupb-hidden" hidden><div class="sift-dupb-verdict"></div><div class="sift-dupb-diag"></div></div>` +
    `</div>`;
  const reportEl = requireEl<HTMLElement>(".sift-dupb-report", "mountReport", mid);
  const verdictEl = requireEl<HTMLElement>(".sift-dupb-verdict", "mountReport", mid);
  const diagEl = requireEl<HTMLElement>(".sift-dupb-diag", "mountReport", mid);
  reportFor = c?.id ?? null;
  if (!c) {
    // Toutes les copies sont introuvables : pas de lecteur, mais la grille et le pied restent.
    reportEl.innerHTML = `<div class="sift-filbox-settings" id="filbox-settings"></div><div class="sift-filbox-foot" id="filbox-foot"></div>`;
    return;
  }
  void openReportInto(
    reportEl,
    c.path,
    verdictEl,
    {
      showAnalysisFailure: false,
      title: [g.title, g.version ? `(${g.version})` : ""].filter(Boolean).join(" "),
      subtitle: t.artistCopies(g.artist ?? "", g.copies.length),
    },
    diagEl,
  );
}

/** ← → maintenus : seul le fond de colonne suit à chaque appui ; le lecteur se remonte sur la
 *  nouvelle copie quand le curseur s'arrête, à la position où en était l'écoute (A/B). */
function scheduleReport(): void {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    const mid = document.getElementById("dmid");
    const g = findGroup(openGid);
    if (!mid || !g || lot) return;
    const c = playableCopy(g);
    if (!c || c.id === reportFor) return;
    resumeNextPlayer(playerPosition());
    mountReport(mid, g, c);
    paintSlots();
  }, REPORT_DELAY_MS);
}

/** Peint la grille et le pied dans les emplacements de la boîte. Fréquence : un geste sur l'Issue
 *  (clic, G), un remontage du lecteur — jamais en rafale : ← → ne passent pas par ici
 *  (`moveCursor` mute les classes). */
function paintSlots(): void {
  const g = findGroup(openGid);
  const settings = document.querySelector<HTMLElement>("#dmid #filbox-settings");
  const foot = document.querySelector<HTMLElement>("#dmid #filbox-foot");
  if (!g || !settings || !foot || cursorId == null) return;
  const t = T();
  const scroll = settings.querySelector<HTMLElement>(".sift-dupb-scroll")?.scrollLeft ?? 0;
  settings.innerHTML = groupFactsHtml(g) + gridHtml(g, plan, cursorId, sources) + consequenceHtml(g, plan);
  const sc = settings.querySelector<HTMLElement>(".sift-dupb-scroll");
  if (sc) sc.scrollLeft = scroll;
  foot.innerHTML =
    `<span class="sift-rail-kbd">${legendHtml()}</span>` +
    `<div class="sift-rail-abtns">` +
    `<button type="button" class="sift-baction" data-dups="notdups">${t.notDupsButton}</button>` +
    `<button type="button" class="sift-ranger-btn" data-dups="keep">${esc(keepButtonLabel(g, plan))}</button>` +
    `</div>`;
}

/** Pose le curseur sur une copie : la colonne prend le fond de sélection tout de suite, le lecteur
 *  suit une fois le curseur stable (`scheduleReport`). */
function moveCursor(id: number): void {
  const g = findGroup(openGid);
  if (!g || !g.copies.some((c) => c.id === id)) return;
  cursorId = id;
  document.querySelectorAll<HTMLElement>("#dmid [data-dupscol]").forEach((el) => {
    el.classList.toggle("cur", Number(el.dataset.dupscol) === id);
  });
  const col = document.querySelector<HTMLElement>(`#dmid .sift-dupb-head[data-dupscol="${id}"]`);
  col?.scrollIntoView({ block: "nearest", inline: "nearest" });
  scheduleReport();
}

function stepCursor(delta: 1 | -1): void {
  const g = findGroup(openGid);
  if (!g) return;
  const i = g.copies.findIndex((c) => c.id === cursorId);
  const next = g.copies[Math.min(g.copies.length - 1, Math.max(0, i + delta))];
  if (next) moveCursor(next.id);
}

/** Ouvre un groupe : curseur sur la copie recommandée (ou sur `focus`, venue de Revue). */
function openGroup(gid: number | null, focus: number | null = null): void {
  openGid = gid;
  const g = findGroup(gid);
  cursorId = g ? (focus != null && g.copies.some((c) => c.id === focus) ? focus : recommendedCopy(g, plan).id) : null;
  reportFor = null;
  repaintQueue();
  if (gid != null) scrollGroupIntoView(gid);
  paintBox();
}

function stepGroup(delta: 1 | -1): void {
  if (!rows.length) return;
  const i = rows.findIndex((g) => g.id === openGid);
  const next = i < 0 ? rows[0] : rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
  if (next && next.id !== openGid) openGroup(next.id);
}

// ---------------------------------------------------------------------------
// Gestes sur l'Issue
// ---------------------------------------------------------------------------

function toggleCopy(id: number): void {
  const g = findGroup(openGid);
  if (!g || !toggleIssue(g, plan, id)) return;
  decided.add(id);
  paintSlots();
}

function keepOnly(g: DupScreenGroup, id: number): void {
  const c = g.copies.find((x) => x.id === id);
  if (!c || !keepable(c)) return;
  for (const x of g.copies) {
    if (!keepable(x)) continue;
    plan.set(x.id, x.id === id);
    decided.add(x.id);
  }
  paintSlots();
}

function keepAlso(g: DupScreenGroup, id: number): void {
  const c = g.copies.find((x) => x.id === id);
  if (!c || !keepable(c) || isKept(plan, c)) return;
  plan.set(id, true);
  decided.add(id);
  paintSlots();
}

function openMenu(x: number, y: number, g: DupScreenGroup, c: DupScreenCopy): void {
  const t = T();
  openContextMenu(x, y, [
    { label: t.keepOnly, onPick: keepable(c) ? () => keepOnly(g, c.id) : undefined },
    { label: t.keepAlso, onPick: keepable(c) && !isKept(plan, c) ? () => keepAlso(g, c.id) : undefined },
    {
      label: t.preferFolder,
      onPick: keepable(c)
        ? () => {
            const res = preferFolder(groups, plan, parentDir(c.path));
            const label = t.preferred(shortDir(c, sources), res.changed.length);
            if (!res.changed.length) {
              toast(label);
              return;
            }
            // Un clic recoche N groupes d'un coup : le toast offre Annuler, qui rend le plan d'avant.
            const before = { plan: new Map(plan), decided: new Set(decided) };
            plan = res.plan;
            for (const gid of res.changed) for (const x of findGroup(gid)?.copies ?? []) decided.add(x.id);
            toast(label, true, () => {
              plan = before.plan;
              decided = before.decided;
              paintSlots();
            });
            paintSlots();
          }
        : undefined,
    },
    { label: t.listen, separated: true, onPick: c.missing ? undefined : () => moveCursor(c.id) },
    {
      label: t.reveal,
      onPick: c.missing
        ? undefined
        : () => void revealTrack(c.id).catch((err: unknown) => toast(humanizeError(err, T().revealFailed, "reveal_track"))),
    },
    { label: t.notDuplicates, separated: true, onPick: () => void refuseGroup(g) },
  ]);
}

// ---------------------------------------------------------------------------
// Résolution d'un groupe
// ---------------------------------------------------------------------------

/** Après une résolution : relit les groupes, puis ouvre le suivant dans la liste AFFICHÉE avant le
 *  geste (règle de `queue-next.ts` : le suivant, ou le précédent au bout). */
async function advanceAfter(doneGid: number): Promise<void> {
  const order = rows.map((g) => g.id);
  await renderDoublons({ keepOpen: false });
  if (document.body.dataset.view !== "dups" || lot) return;
  const next = pickNextAfter(order, doneGid, rows);
  openGroup(next?.id ?? rows[0]?.id ?? null);
}

/** Entrée, ou le bouton primaire : applique l'Issue du groupe ouvert, tout de suite, en un lot de
 *  journal annulable. Un groupe où rien ne part (À vérifier, ou toutes les copies gardées) se
 *  résout en « ce ne sont pas des doublons ». */
async function resolveOpen(): Promise<void> {
  const g = findGroup(openGid);
  if (!g || applying) return;
  const o = groupOutcome(g, plan);
  if (o.trashed.length === 0) {
    await refuseGroup(g);
    return;
  }
  const t = T();
  applying = true;
  try {
    const res = await applyDuplicatePlan(o.trash.map((c) => c.id));
    if (res.failed.length) {
      for (const f of res.failed) console.error("doublons : copie non envoyée", f.id, f.error);
      toast(t.partial(res.trashed.length, res.failed.length));
    } else if (res.batch_id) {
      const batch = res.batch_id;
      toast(t.resolved(res.trashed.length), true, () => undoAndRefresh(batch));
    }
  } catch (err) {
    toast(humanizeError(err, t.applyFailed, "apply_duplicate_plan"));
    return;
  } finally {
    applying = false;
  }
  await advanceAfter(g.id);
}

/** ⌫ ou X : la copie sous le curseur part tout de suite ; le groupe reste ouvert s'il lui reste
 *  plusieurs copies. Jamais la dernière copie présente d'un groupe. */
async function trashCursor(): Promise<void> {
  const g = findGroup(openGid);
  const c = g?.copies.find((x) => x.id === cursorId);
  if (!g || !c || c.missing || applying) return;
  if (g.copies.filter((x) => !x.missing).length <= 1) return;
  const t = T();
  applying = true;
  try {
    const res = await applyDuplicatePlan([c.id]);
    if (res.failed.length) toast(res.failed[0].error);
    else if (res.batch_id) {
      const batch = res.batch_id;
      toast(t.trashedOne, true, () => undoAndRefresh(batch));
    }
  } catch (err) {
    toast(humanizeError(err, t.applyFailed, "apply_duplicate_plan"));
    return;
  } finally {
    applying = false;
  }
  const gid = g.id;
  const order = rows.map((x) => x.id);
  await renderDoublons({ keepOpen: true });
  if (document.body.dataset.view !== "dups") return;
  // Le groupe a pu changer d'id (sa plus petite copie est partie) ou disparaître (une seule copie
  // restante) : on le retrouve par une copie survivante, sinon on passe au suivant.
  const still = g.copies.find((x) => x.id !== c.id && groupOfCopy(x.id));
  const now = still ? groupOfCopy(still.id) : null;
  if (now) openGroup(now.id);
  else openGroup(pickNextAfter(order, gid, rows)?.id ?? rows[0]?.id ?? null);
}

/** N, « Pas des doublons », ou Entrée sur un groupe où rien ne part : garder toutes les copies et
 *  ne plus proposer ce groupe. */
async function refuseGroup(g: DupScreenGroup): Promise<void> {
  try {
    await refuseDuplicateGroup(g.copies.map((x) => x.id));
  } catch (err) {
    toast(humanizeError(err, T().notDuplicatesFailed, "refuse_duplicate_group"));
    return;
  }
  await advanceAfter(g.id);
}

/** Annule l'application `batch` — CE lot, pas le plus récent du journal (`undo_last`) : un autre
 *  geste a pu se glisser entre l'application et le clic sur Annuler. */
function undoAndRefresh(batch: string): void {
  void revertBatch(batch)
    .then(() => renderDoublons({ keepOpen: true }))
    .catch((err: unknown) => toast(humanizeError(err, T().undoFailed, "revert_batch")));
}

// ---------------------------------------------------------------------------
// Mode Lot
// ---------------------------------------------------------------------------

function selectedGroups(): DupScreenGroup[] {
  return groups.filter((g) => lotSel.has(g.id));
}

/** Le résumé de la sélection (spec § Zone C en mode Lot), gabarit `.sift-bsel` de Revue. */
function paintLotSummary(mid: HTMLElement): void {
  const t = T();
  const s = lotSummary(selectedGroups(), plan, true);
  const row = (label: string, value: string) => `<dt>${label}</dt><dd>${value}</dd>`;
  mid.innerHTML =
    `<div class="sift-dupb sift-dupb-lot">` +
    `<div class="sift-sel-count">${t.lotTitle(lotSel.size)}</div>` +
    (lotSel.size === 0
      ? `<div class="sift-dupb-consequence">${t.lotEmpty}</div>`
      : `<dl class="sift-sel-rows">` +
        row(t.lotTrash, `${s.copies.length} · ${fmtSize(s.bytes)}`) +
        row(t.lotTies, String(s.ties)) +
        row(t.lotRekordbox, String(s.rekordboxKept)) +
        row(t.lotExcluded, String(s.excluded)) +
        `</dl>`) +
    `<div class="sift-dupb-lot-actions"><button type="button" class="sift-ranger-btn" data-dups="lotresolve"${s.groups === 0 ? " disabled" : ""}>${t.lotResolve(s.groups)}</button></div>` +
    `</div>`;
}

function setLot(on: boolean): void {
  if (lot === on) return;
  lot = on;
  lotSel = new Set();
  lotAnchor = null;
  repaintQueue();
  paintQueueHead();
  paintBar();
  if (!on) reportFor = null;
  paintBox();
}

function clickLot(gid: number, range: boolean): void {
  const order = rows.map((g) => g.id);
  const r = clickedSelection(lotSel, { id: gid, range }, order, lotAnchor, new Set(order));
  lotSel = r.sel;
  lotAnchor = r.anchor;
  repaintQueue();
  paintBar();
  paintBox();
}

/** La ligne d'avertissement de la confirmation : des copies envoyées que Rekordbox n'a pas pu
 *  confirmer absentes. `undefined` : rien à dire, pas de ligne. */
function unverifiedLine(copies: readonly DupScreenCopy[]): string | undefined {
  const u = unverifiedRekordbox(copies);
  return u ? T().confirmUnverified(u.count, u.reason) : undefined;
}

async function resolveLot(): Promise<void> {
  if (applying) return;
  const t = T();
  const sel = selectedGroups();
  const withRkb = lotSummary(sel, plan, true);
  const withoutRkb = lotSummary(sel, plan, false);
  if (withoutRkb.copies.length === 0) return;
  const res = await confirmTrashPlan({
    paint: (keepRekordbox) => {
      const s = keepRekordbox ? withRkb : withoutRkb;
      return {
        title: t.confirmTitle(s.groups),
        recap: t.confirmRecap(s.copies.length, fmtSize(s.bytes)),
        confirm: t.confirmButton(s.groups),
      };
    },
    note: t.confirmNote,
    rekordboxCount: withoutRkb.copies.length - withRkb.copies.length,
    rekordboxLabel: t.keepRekordbox(withoutRkb.copies.length - withRkb.copies.length),
    // Les copies non vérifiées partent avec ou sans la case : la ligne est la même des deux côtés.
    warning: unverifiedLine(withoutRkb.copies),
  });
  if (!res.confirmed) return;
  const chosen = res.keepRekordbox ? withRkb : withoutRkb;
  if (!chosen.copies.length) return;
  await runLot(chosen.copies.map((c) => c.id), chosen.groups);
}

/** La feuille, non modale, en haut de la zone C (`.sift-batch-sheet`, forme de la feuille de copie
 *  du Finder), dans une ancre de hauteur nulle : elle ne pousse pas la boîte. */
function mountSheet(state: "progress" | "report", html: string): HTMLElement | null {
  const mid = document.getElementById("dmid");
  if (!mid) return null;
  document.querySelector(".sift-dups-sheet-anchor")?.remove();
  const anchor = document.createElement("div");
  anchor.className = "sift-dups-sheet-anchor";
  const sheet = document.createElement("div");
  sheet.className = "sift-batch-sheet sift-batch-sheet--open";
  sheet.dataset.state = state;
  sheet.innerHTML = html;
  anchor.appendChild(sheet);
  mid.insertBefore(anchor, mid.firstChild);
  return sheet;
}

/** Échec partiel : la feuille devient le rapport — les copies qui ont résisté, et pourquoi. Le
 *  reste est appliqué et s'annule d'un clic. Patron : `batch-sheet.ts::transformToReport`. */
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

async function runLot(ids: number[], nGroups: number): Promise<void> {
  const t = T();
  applying = true;
  const sheet = mountSheet(
    "progress",
    `<div class="sift-bs-head"><div class="sift-bs-title">${t.sheetTitle(ids.length)}</div>` +
      `<button class="sift-baction sift-baction--quiet sift-bs-stop" data-dups="stop">${t.stop}</button></div>` +
      `<progress class="sift-bs-bar" value="0" max="${ids.length}"></progress>` +
      `<div class="sift-bs-step"></div>`,
  );
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
    lastBatch = res.batch_id;
    if (res.failed.length) {
      for (const f of res.failed) console.error("doublons : copie non envoyée", f.id, f.error);
      report = res;
    } else if (res.trashed.length > 0 && res.batch_id) {
      const batch = res.batch_id;
      toast(t.lotDone(nGroups, res.trashed.length), true, () => undoAndRefresh(batch));
    }
  } catch (err) {
    toast(humanizeError(err, t.applyFailed, "apply_duplicate_plan"));
  } finally {
    unlisten?.();
    applying = false;
    lot = false;
    lotSel = new Set();
    lotAnchor = null;
    await renderDoublons({ keepOpen: false });
    if (report && document.body.dataset.view === "dups") showReport(report, names);
  }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/** La coque : la colonne de file et la boîte, sur le gabarit de Revue (`router.ts::revueShell`).
 *  Identifiants PROPRES (`#dqcol`, `#dql`, `#dmid`) et non ceux de Revue : `queue-panel.ts` et
 *  `filing*.ts` cherchent `#qcol`, `#ql` et `#mid` sur le document, et rempliraient ceux-ci. */
function mountShell(content: HTMLElement): void {
  const t = T();
  content.style.display = "flex";
  content.style.overflowY = "hidden";
  content.innerHTML =
    `<div class="sift-revue-row">` +
    `<div class="queue" id="dqcol">` +
    `<div class="sift-qhead"></div>` +
    `<div id="dql" role="listbox" tabindex="0" aria-label="${t.listAria}"><div class="sift-dupq-list"></div></div>` +
    `</div>` +
    `<div class="sift-inspector"><div class="mid" id="dmid"></div></div>` +
    `</div>`;
  const ql = requireEl<HTMLElement>("#dql", "mountShell", content);
  const host = requireEl<HTMLElement>(".sift-dupq-list", "mountShell", content);
  virtual?.destroy();
  virtual = createVirtualList<DupScreenGroup>({
    host,
    scrollContainer: ql,
    items: rows,
    rowHtml: (g) => queueRowHtml(g, { active: !lot && g.id === openGid, checked: lot ? lotSel.has(g.id) : null }),
    probeHtml: rows.length ? queueRowHtml(rows[0], { active: false, checked: null }) : "",
    fallbackRowH: 46,
  });
}

/** Première lecture, avant le premier passage (#92). Elle lit des fichiers et la collection
 *  Rekordbox : `sift-live.ts` la lance après le démarrage. L'échec se tait ici : `lu` reste faux, et
 *  le passage suivant l'affiche. */
export async function lireLesDoublonsEnFond(): Promise<void> {
  if (lu) return;
  try {
    [groups, sources] = await Promise.all([listDuplicateGroups(), listSources()]);
    lu = true;
  } catch (e) {
    console.error("list_duplicate_groups failed in the background", e);
  }
}

/** `soft` : rafraîchissement venu de `queue:changed` (rafales coalescées à 400 ms : scan, watcher,
 *  rangement, Ctrl+Z). Rien de changé : rien ne se repeint, et l'écoute continue. `keepOpen` : le
 *  groupe ouvert le reste s'il existe encore (sinon la boîte se vide, l'appelant en choisit un). */
export async function renderDoublons(opts: { soft?: boolean; keepOpen?: boolean } = {}): Promise<void> {
  // Appelé aussi APRÈS coup — fin d'une résolution, Annuler d'un toast — alors que l'utilisateur a
  // pu changer d'écran : le jeton d'époque, pris ici, serait celui de l'autre écran. Le routeur pose
  // `data-view` avant d'appeler.
  if (document.body.dataset.view !== "dups") return;
  const content = requireEl<HTMLElement>("#content", "renderDoublons");
  const token = viewEpoch();
  installDoublonsKeys();
  if (!wired) {
    wire(content);
    wired = true;
  }
  const mounted = !!content.querySelector("#dqcol");
  if (!mounted && !content.querySelector(".sift-empty-state")) {
    content.innerHTML = `<div class="sift-library-main"><span class="sift-skel sift-skel-line"></span></div>`;
  }
  let next = groups;
  const memoire = peindreDeMemoire({
    lu,
    monte: mounted,
    doux: !!opts.soft,
    suitUnGeste: opts.keepOpen !== undefined,
    focus: pendingFocus != null,
  });
  try {
    if (memoire) {
      // Le rendu doux qui suit relit, et ne repeint que si les groupes ont changé.
      setTimeout(() => {
        if (document.body.dataset.view === "dups" && !applying) void renderDoublons({ soft: true });
      });
    } else {
      [next, sources] = await Promise.all([listDuplicateGroups(), listSources()]);
      lu = true;
      if (isStaleViewRender(token)) return;
    }
  } catch (err) {
    console.error("list_duplicate_groups failed", err);
    lu = false;
    if (isStaleViewRender(token)) return;
    virtual?.destroy();
    virtual = null;
    const t = T();
    content.style.display = "";
    content.style.overflowY = "";
    content.innerHTML =
      `<div class="sift-library-main"><div class="sift-ec-fail">${t.loadFailed} ${esc(String(err))} ` +
      `<button data-dups="retry" class="sift-meta-ident-btn">${t.retry}</button></div></div>`;
    mountBarActions("");
    closeAside();
    return;
  }
  if (opts.soft && mounted && JSON.stringify(next) === JSON.stringify(groups)) return;
  const r = rebasePlan(next, plan, decided);
  groups = next;
  plan = r.plan;
  decided = r.decided;
  lotSel = new Set([...lotSel].filter((id) => groups.some((g) => g.id === id)));
  closeAside();

  if (groups.length === 0) {
    virtual?.destroy();
    virtual = null;
    rows.length = 0;
    const t = T();
    content.style.display = "";
    content.style.overflowY = "";
    content.innerHTML = emptyStateHtml({ title: t.emptyTitle, note: t.emptyNote, backToRevue: true });
    wireEmptyState(content);
    const countEl = document.getElementById("sift-tb-count");
    if (countEl) countEl.textContent = "";
    return;
  }

  rows.length = 0;
  rows.push(...visible());
  if (!mounted) mountShell(content);
  paintQueueHead();
  paintBar();

  let focus: number | null = null;
  if (pendingFocus != null) {
    // Venue de Revue : le groupe de la copie s'ouvre, curseur sur elle.
    const g = groupOfCopy(pendingFocus);
    if (g) {
      openGid = g.id;
      focus = pendingFocus;
    }
    pendingFocus = null;
  }
  const stillOpen = findGroup(openGid);
  if (focus != null) openGroup(openGid, focus);
  else if (opts.keepOpen === false) {
    // Après une résolution : l'appelant (`advanceAfter`) ouvre le suivant.
    openGid = null;
    repaintQueue();
    paintBox();
  } else if (stillOpen) {
    // Le groupe ouvert existe encore : il garde son curseur s'il le peut, et l'écoute en cours.
    if (!stillOpen.copies.some((c) => c.id === cursorId)) cursorId = recommendedCopy(stillOpen, plan).id;
    repaintQueue();
    paintBox();
  } else openGroup(rows[0]?.id ?? null);
}

function wire(content: HTMLElement): void {
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
    const pop = t.closest<HTMLElement>('[data-dups="filterpop"]');
    if (pop) {
      if (document.getElementById(FILTER_POP_ID)) closeFilterPop();
      else openFilterPop(pop);
      return;
    }
    if (t.closest('[data-dups="lot"]')) {
      setLot(!lot);
      return;
    }
    if (t.closest('[data-dups="lotresolve"]')) {
      void resolveLot();
      return;
    }
    if (t.closest('[data-dups="keep"]')) {
      void resolveOpen();
      return;
    }
    if (t.closest('[data-dups="notdups"]')) {
      const g = findGroup(openGid);
      if (g) void refuseGroup(g);
      return;
    }
    const issue = t.closest<HTMLElement>("[data-dupsissue]");
    if (issue) {
      toggleCopy(Number(issue.dataset.dupsissue));
      return;
    }
    const col = t.closest<HTMLElement>("[data-dupscol]");
    if (col) {
      moveCursor(Number(col.dataset.dupscol));
      return;
    }
    const row = t.closest<HTMLElement>("#dql .qi[data-dupgroup]");
    if (row) {
      const gid = Number(row.dataset.dupgroup);
      // Mode Lot : toute la ligne coche, Maj+clic coche une plage (mécanique de Revue).
      if (lot) clickLot(gid, e.shiftKey);
      else if (gid !== openGid) openGroup(gid);
    }
  });
  content.addEventListener("contextmenu", (e) => {
    if (document.body.dataset.view !== "dups") return;
    const col = (e.target as HTMLElement).closest<HTMLElement>("[data-dupscol]");
    const g = findGroup(openGid);
    const c = g?.copies.find((x) => x.id === Number(col?.dataset.dupscol));
    if (!g || !c) return;
    e.preventDefault();
    moveCursor(c.id);
    openMenu(e.clientX, e.clientY, g, c);
  });
}

/** Clavier de l'écran — celui de Revue (spec § Interactions, planche B « Clavier — couche 3 »).
 *  Ctrl+Z est global (`filing.ts::installUndoShortcut`) ; le retour des copies repeint l'écran par
 *  `queue:changed`, que `undo_last` émet. */
function installDoublonsKeys(): void {
  if (keysWired) return;
  keysWired = true;
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "dups" || applying) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (target?.closest('[role="menu"], [role="alertdialog"], #sift-context-menu')) return;
    // Une confirmation ouverte bloque tout, même quand le focus a quitté sa carte (un clic dans son
    // texte le rend à <body>) : repérée par son voile, comme `shortcuts.ts`.
    if (document.getElementById("sift-confirm-overlay")) return;
    // Un curseur du lecteur (volume, position) prend ← → ↑ ↓ pour lui ; un bouton focalisé prend
    // Entrée et Espace — sa propre activation (`chrome.ts`, même règle pour la navigation).
    const onSlider = !!target?.closest('[role="slider"]');
    const onControl = !!target?.closest('button, a, [role="button"], summary');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "a" || e.key === "A") && lot) {
      e.preventDefault();
      lotSel = e.shiftKey ? new Set() : new Set(rows.map((g) => g.id));
      repaintQueue();
      paintBar();
      paintBox();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === "Escape" && lot) {
      e.preventDefault();
      setLot(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (onSlider || lot) return;
      e.preventDefault();
      stepGroup(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (lot) return;
    // Les gestes qui décident ne se rejouent pas en auto-répétition : le premier appui suffit.
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft":
        if (onSlider) return;
        e.preventDefault();
        stepCursor(e.key === "ArrowRight" ? 1 : -1);
        return;
      case " ":
        if (onControl) return;
        e.preventDefault();
        togglePlay();
        return;
      case "Enter":
        if (e.repeat || onControl) return;
        e.preventDefault();
        void resolveOpen();
        return;
      case "Backspace":
      case "x":
      case "X":
        if (e.repeat) return;
        e.preventDefault();
        void trashCursor();
        return;
      case "g":
      case "G":
        if (e.repeat || cursorId == null) return;
        e.preventDefault();
        toggleCopy(cursorId);
        return;
      case "n":
      case "N": {
        if (e.repeat) return;
        const g = findGroup(openGid);
        if (!g) return;
        e.preventDefault();
        void refuseGroup(g);
        return;
      }
    }
    if (/^[1-9]$/.test(e.key)) {
      const g = findGroup(openGid);
      const c = g?.copies[Number(e.key) - 1];
      if (!c) return;
      e.preventDefault();
      moveCursor(c.id);
    }
  });
  // Le retour de copies (Ctrl+Z, Restaurer) et l'arrivée de pistes changent les groupes : repeindre
  // l'écran s'il est affiché. Rafales coalescées ; le rendu DOUX ne repeint rien quand rien n'a
  // changé, et garde le groupe ouvert.
  let timer: ReturnType<typeof setTimeout> | undefined;
  void onQueueChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.body.dataset.view === "dups" && !applying) void renderDoublons({ soft: true });
    }, 400);
  });
}
