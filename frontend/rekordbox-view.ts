// Rekordbox integration screen — extracted from sift-live.ts (clean-architecture audit F1,
// 2026-07-09). Dispatch for mdb*/mds*/mas*/ded*/rkb* actions lives here in handleRekordboxAction
// (unlike ecartes-view.ts, where dispatch stays centralized in sift-live.ts's delegated #pa
// handler) — sift-live.ts's #pa handler just calls it and returns early if it handled the action.
//
// Refonte du 2026-09-08 (déclinaison #24, cinquième écran — spec docs/ui-specs/rekordbox.md
// § Décision 2026-09-08 v4, validée par Antoine « go v4 » sans prose). Trois apps Apple font le
// geste de cet écran — des changements en attente, à appliquer sur un autre système — et leurs
// figures officielles disent la même chose :
//   · Finder › appareil (guide Big Sur) : la cible dans la sidebar, en tête son identité et une ligne
//     de faits, des sections à LIBELLÉ ALIGNÉ À DROITE (Software: / Backups:), les actions
//     secondaires DANS la section (Check for Update sous Software:), un seul « Apply ».
//   · Photos › Importer (guide Tahoe) : « Import Selected » inactif sans sélection · « Import All
//     New Photos » primaire ; les éléments en GROUPE NOMMÉ AVEC SON COMPTE, sans boîte.
//   · Utilitaire de disque : la cible en tête, une action = une sheet.
// D'où : barre = Synchroniser la sélection · Tout synchroniser (N) ; zone C bornée à --measure-data,
// tête (nom, faits), Fichier : (chemin, Réexporter, Changer de XML), master.db : (état, dérive),
// En attente : (un groupe par section, une rangée par candidat). Les quatre cartes, la sur-ligne,
// les groupes de session repliés et les quatre boutons « Appliquer la sélection » sont partis.
import {
  rekordboxStatus,
  rekordboxMasterdbPendingRepairs,
  rekordboxMasterdbScanPlaylistDuplicates,
  rekordboxMasterdbPendingMetadataSyncs,
  rekordboxMasterdbPendingArtworkSyncs,
  rekordboxMasterdbDismissRepair,
  rekordboxMasterdbResolveAmbiguous,
  rekordboxMasterdbApplyRepairs,
  rekordboxMasterdbDedupPlaylistGroup,
  rekordboxMasterdbDismissMetadataSync,
  rekordboxMasterdbResolveAmbiguousMetadataSync,
  rekordboxMasterdbApplyMetadataSyncs,
  rekordboxMasterdbDismissArtworkSync,
  rekordboxMasterdbResolveAmbiguousArtworkSync,
  rekordboxMasterdbApplyArtworkSyncs,
  rekordboxMasterdbSetSyncStop,
  onRekordboxSyncProgress,
  revealTrack,
} from "./ipc";
import type {
  RekordboxLinkStatus,
  PendingMasterdbRepair,
  CandidateTrack,
  PlaylistDuplicateGroupDto,
  PendingMetadataSync,
  PendingArtworkSync,
} from "../shared/contracts";
import { AMBIGUITY_BAD_CHOICE, AMBIGUITY_STALE } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { isStaleViewRender, viewEpoch } from "./view-epoch";
import { toast } from "./filing-toast";
import { emptyStateHtml, wireEmptyState } from "./empty-state";
import { confirmAction } from "./confirm-modal";
import { mountBarActions, mountBarSearch } from "./toolbar";
import { openContextMenu, type MenuItem } from "./context-menu";
import { planSync, type RkbSection, type SyncPlan } from "./rekordbox-plan";
import { T } from "./i18n/rekordbox-view";
import { candidateRowHtml, clearedCount, metadataEcartHtml, searchMatches } from "./rekordbox-ecart";
import { sectionView } from "./rekordbox-section";
import { bibState } from "./bibliotheque-view";
import { humanizeError } from "./errors";

// ---------------------------------------------------------------------------
// État — au niveau module, jamais remis à zéro en bloc : l'écran se re-rend après chaque
// synchronisation, et un état local ramènerait l'utilisateur sur « Tout » juste après qu'il ait
// choisi une section. Les sélections sont FILTRÉES contre les lignes vivantes à chaque rendu, donc
// un id périmé (appliqué ou ignoré ailleurs) tombe sans toucher au reste.
// ---------------------------------------------------------------------------

// Tier 1 (corrections de chemin) : sélection + message d'échec par id, transitoire (jamais
// persisté) — effacé quand la ligne est recochée ou que le lot suivant la touche.
const mdbRepairSel = new Set<number>();
const mdbErrorById = new Map<number, string>();
// Tier 2 (doublons de playlist) : sans id côté backend, la clé est `playlist_id::content_id`.
// Le dernier scan vit ici pour que le clic retrouve son groupe.
let lastScannedDuplicateGroups: PlaylistDuplicateGroupDto[] = [];
const dedupSel = new Set<string>();
const mdbDedupErrorByKey = new Map<string, string>();
// Tier 3 métadonnées / pochettes : même discipline.
const mdsSyncSel = new Set<number>();
const mdsErrorById = new Map<number, string>();
const masSyncSel = new Set<number>();
const masErrorById = new Map<number, string>();

// Dernières lignes EN ATTENTE par section, rafraîchies en tête de chaque rendu de section : le
// plan de synchronisation les lit au clic, avant que la prochaine relecture IPC ne réponde.
let lastPendingRepairs: PendingMasterdbRepair[] = [];
let lastPendingMetadataSyncs: PendingMetadataSync[] = [];
let lastPendingArtworkSyncs: PendingArtworkSync[] = [];
/** Groupes de doublons que la recherche laisse voir — le plan les lit ; `lastScannedDuplicateGroups`
 *  garde le relevé entier, où la synchronisation retrouve le groupe d'une clé. */
let lastVisibleDedups: PlaylistDuplicateGroupDto[] = [];

/** Statut du dernier rendu complet — les sections y lisent si le lien lui-même est cassé, pour ne
 *  pas dire « à jour » quand la synchronisation est indisponible (F3, audit-heuristique-visuel). */
let lastLinkStatus: RekordboxLinkStatus | null = null;

/** Section affichée. « Tout » = le XML entier, les quatre sections. */
let activeRkbSection: RkbSection = "all";

/** Sections dont l'appel IPC a échoué au dernier rendu — comptées, jamais tues (impasse A14). */
let failedSections = 0;

/** Une synchronisation à la fois : la barre reste inactive et la feuille refuse un second départ. */
let syncRunning = false;
/** « Annuler » demandé sur la feuille : le prochain appel ne part pas, l'appel en cours s'arrête
 *  côté Rust entre deux entrées (`rekordbox_masterdb_set_sync_stop`). */
let syncStopRequested = false;

/** Recherche de la barre (spec § Zone A). Elle borne l'affichage ET le plan : « Tout
 *  synchroniser (N) » ne compte que les rangées visibles. Gardée d'un rendu à l'autre, comme la
 *  section active. */
let rkbQuery = "";

/** Les rangées du dernier relevé IPC, complètes (en attente ET ambiguës), `null` pour une section
 *  dont l'appel a échoué. La recherche repeint depuis ici, sans relire `master.db` à chaque frappe. */
let fetched: {
  repairs: PendingMasterdbRepair[] | null;
  metas: PendingMetadataSync[] | null;
  arts: PendingArtworkSync[] | null;
  dedups: PlaylistDuplicateGroupDto[] | null;
} = { repairs: [], metas: [], arts: [], dedups: [] };

/** Une section ne peut rien faire dans DEUX cas, pas un (impasse A13, issue #15) : le XML lié est
 *  illisible, OU `master.db` manque — les détecteurs M8 le lisent, et leurs erreurs deviennent des
 *  `None` muets côté Rust. Un corps vide se peindrait « à jour » exactement quand rien ne peut
 *  l'être. */
function syncUnavailable(): boolean {
  return lastLinkStatus?.error != null || lastLinkStatus?.masterdb_error != null;
}

function duplicateGroupKey(g: PlaylistDuplicateGroupDto): string {
  return `${g.playlist_id}::${g.content_id}`;
}

const fileName = (p: string | null | undefined): string => {
  const s = p || "";
  return s.split(/[\\/]/).pop() || s;
};

/** « Artiste — Titre » quand `metadata` les porte, sinon le nom du fichier — même repli que la
 *  rangée Métadonnées, pour que les quatre groupes nomment une piste de la même façon. */
const trackLabel = (artist: string | null, title: string | null, path: string): string =>
  artist && title ? `${artist} — ${title}` : fileName(path);

function candidateList(r: { candidate_tracks: CandidateTrack[] | null; candidate_track_ids: string | null }): CandidateTrack[] {
  return r.candidate_tracks && r.candidate_tracks.length
    ? r.candidate_tracks
    : (r.candidate_track_ids || "")
        .split(",")
        .filter(Boolean)
        .map((track_id) => ({ track_id, folder_path: null }));
}

// Les textes qu'une rangée offre à la recherche : sa piste, son écart, son chemin.
const repairText = (r: PendingMasterdbRepair) => [r.artist, r.title, r.to_path];
const metaText = (r: PendingMetadataSync) => [r.new_artist, r.new_title, r.new_genre, r.new_year, r.new_label, r.sift_path];
const artText = (r: PendingArtworkSync) => [r.artist, r.title, r.sift_path, r.cover_path];
const dedupText = (g: PlaylistDuplicateGroupDto) => [g.playlist_name, g.track_path];
const visible = <R>(rows: R[], text: (r: R) => (string | number | null)[]): R[] =>
  rows.filter((r) => searchMatches(rkbQuery, text(r)));

// ---------------------------------------------------------------------------
// Rangées de candidats — la grammaire de Photos › Importer : un groupe nommé avec son compte, une
// rangée par élément, une case. Le clic sur la rangée coche ; le clic droit porte « Ignorer » et,
// pour un candidat ambigu, le choix de la piste Rekordbox.
// ---------------------------------------------------------------------------


/** Une rangée ambiguë : plusieurs pistes Rekordbox possibles, rien ne s'écrit avant le choix. Pas
 *  de case ; l'écart dit « À choisir » et les pistes candidates suivent, un bouton chacune. */
function ambiguousRowHtml(
  resolve: string,
  id: number,
  piste: string,
  ecart: string,
  cands: CandidateTrack[],
  error: string | undefined,
): string {
  return (
    `<div class="rkb-cand rkb-cand--amb" data-rkbamb="${resolve}" data-id="${id}" tabindex="0">` +
    `<span class="rkb-cand-piste">${piste}</span>` +
    `<span class="rkb-cand-ecart">${ecart} — <span class="rkb-warn">${T().toChoose}</span></span>` +
    `<div class="rkb-cand-choices">` +
    cands
      .map(
        (c) =>
          `<button data-sift="${resolve}" data-id="${id}" data-track="${esc(c.track_id)}" class="sift-meta-ident-btn">` +
          `${T().choose(esc(c.folder_path || c.track_id))}</button>`,
      )
      .join("") +
    `</div>` +
    (error ? `<span class="rkb-cand-err">${esc(error)}</span>` : "") +
    `</div>`
  );
}

/** En-tête de groupe « Métadonnées (1) », Photos « New Photos (15 photos) ». `extra` ajoute
 *  « · 1 à choisir » quand des ambigus attendent. */
function groupHeadHtml(label: string, pending: number, ambiguous: number): string {
  const amb = ambiguous ? T().groupAmbiguous(ambiguous) : "";
  return `<div class="rkb-group-hd">${esc(label)} (${pending}${amb})</div>`;
}

function sectionErrorHtml(): string {
  // Impasse A15 (issue #15) : « réessaie plus tard » était dit à une condition PERMANENTE. Sur une
  // machine sans Rekordbox, `master.db` ne réapparaîtra pas tout seul. Quand la cause est connue on
  // la nomme ; le conseil d'attendre ne subsiste que pour ce qui est vraiment transitoire.
  const known = lastLinkStatus?.masterdb_error;
  const msg = known ? T().sectionUnavailable(known) : T().sectionLoadFailed;
  return `<div class="rkb-cand-err rkb-section-err">${esc(msg)}</div>`;
}

/** Tier 1 — corrections de chemin détectées au rangement (actions.rs::detect_masterdb_repair_if_linked). */
function masterdbRepairsSectionHtml(all: PendingMasterdbRepair[]): string {
  const liveIds = new Set(all.map((r) => r.id));
  for (const id of [...mdbRepairSel]) if (!liveIds.has(id)) mdbRepairSel.delete(id);
  const rows = visible(all, repairText);
  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingRepairs = pending;
  if (!pending.length && !ambiguous.length) return `<div id="sift-rkb-masterdb-section"></div>`;
  const ecart = (r: PendingMasterdbRepair) => `${T().pathFixed} <span class="rkb-mono">${esc(r.to_path)}</span>`;
  const piste = (r: PendingMasterdbRepair) => esc(trackLabel(r.artist, r.title, r.to_path));
  return (
    `<div id="sift-rkb-masterdb-section">` +
    groupHeadHtml(T().grpFiles, pending.length, ambiguous.length) +
    pending
      .map((r) => candidateRowHtml("mdbpick", `data-id="${r.id}"`, mdbRepairSel.has(r.id), piste(r), ecart(r), mdbErrorById.get(r.id)))
      .join("") +
    ambiguous.map((r) => ambiguousRowHtml("mdbresolve", r.id, piste(r), ecart(r), candidateList(r), mdbErrorById.get(r.id))).join("") +
    `</div>`
  );
}

/** Tier 3 — écarts de tags détectés quand Sift écrit des ID3 sur un fichier lié à Rekordbox. */
function metadataSyncsSectionHtml(all: PendingMetadataSync[]): string {
  const liveIds = new Set(all.map((r) => r.id));
  for (const id of [...mdsSyncSel]) if (!liveIds.has(id)) mdsSyncSel.delete(id);
  const rows = visible(all, metaText);
  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingMetadataSyncs = pending;
  if (!pending.length && !ambiguous.length) return `<div id="sift-rkb-mds-section"></div>`;
  const piste = (r: PendingMetadataSync) =>
    esc(r.new_artist && r.new_title ? `${r.new_artist} — ${r.new_title}` : fileName(r.sift_path));
  // Rendu dans `rekordbox-ecart.ts` (module pur, gelé par Vitest) : depuis #81 il dit aussi ce
  // que la synchro vide.
  const ecart = (r: PendingMetadataSync) => metadataEcartHtml(r);
  return (
    `<div id="sift-rkb-mds-section">` +
    groupHeadHtml(T().grpMeta, pending.length, ambiguous.length) +
    pending.map((r) => candidateRowHtml("mdspick", `data-id="${r.id}"`, mdsSyncSel.has(r.id), piste(r), ecart(r), mdsErrorById.get(r.id))).join("") +
    ambiguous.map((r) => ambiguousRowHtml("mdsresolve", r.id, piste(r), ecart(r), candidateList(r), mdsErrorById.get(r.id))).join("") +
    `</div>`
  );
}

/** Tier 3 — nouvelle pochette écrite sur un fichier lié à Rekordbox (détecteur distinct des tags). */
function artworkSyncsSectionHtml(all: PendingArtworkSync[]): string {
  const liveIds = new Set(all.map((r) => r.id));
  for (const id of [...masSyncSel]) if (!liveIds.has(id)) masSyncSel.delete(id);
  const rows = visible(all, artText);
  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingArtworkSyncs = pending;
  if (!pending.length && !ambiguous.length) return `<div id="sift-rkb-mas-section"></div>`;
  const ecart = (r: PendingArtworkSync) => `${T().newArtwork} ${esc(fileName(r.cover_path))}`;
  const piste = (r: PendingArtworkSync) => esc(trackLabel(r.artist, r.title, r.sift_path));
  return (
    `<div id="sift-rkb-mas-section">` +
    groupHeadHtml(T().grpArt, pending.length, ambiguous.length) +
    pending.map((r) => candidateRowHtml("maspick", `data-id="${r.id}"`, masSyncSel.has(r.id), piste(r), ecart(r), masErrorById.get(r.id))).join("") +
    ambiguous.map((r) => ambiguousRowHtml("masresolve", r.id, piste(r), ecart(r), candidateList(r), masErrorById.get(r.id))).join("") +
    `</div>`
  );
}

/** Tier 2 — une piste présente plus d'une fois dans une playlist (scan à chaque rendu, lecture
 *  seule, aucune persistance). Une rangée par groupe, cochable comme les autres depuis le
 *  2026-09-08 : « Tout synchroniser » les retire avec le reste. */
function playlistDuplicatesSectionHtml(all: PlaylistDuplicateGroupDto[]): string {
  const liveKeys = new Set(all.map(duplicateGroupKey));
  for (const k of [...dedupSel]) if (!liveKeys.has(k)) dedupSel.delete(k);
  const groups = visible(all, dedupText);
  lastVisibleDedups = groups;
  if (!groups.length) return `<div id="sift-rkb-dedup-section"></div>`;
  return (
    `<div id="sift-rkb-dedup-section">` +
    groupHeadHtml(T().grpPlaylists, groups.length, 0) +
    groups
      .map((g) => {
        const key = duplicateGroupKey(g);
        const n = g.remove.length;
        const piste = esc(g.playlist_name || T().playlistN(g.playlist_id));
        const ecart = `${esc(fileName(g.track_path) || T().trackN(g.content_id))} — ${T().duplicatesToRemove(n)}`;
        return candidateRowHtml("dedpick", `data-key="${esc(key)}"`, dedupSel.has(key), piste, ecart, mdbDedupErrorByKey.get(key));
      })
      .join("") +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Re-rendu d'une seule section (clic sur une rangée) : aucun IPC, aucune relecture de master.db,
// les trois autres sections intactes. Les clics `[data-sift]` sont délégués une fois sur `#pa`
// (installLiveWiring), donc un `outerHTML` ne perd rien. La barre suit : ses deux boutons
// dérivent de la sélection.
// ---------------------------------------------------------------------------

function rerenderSection(id: string, html: () => string): void {
  const el = document.getElementById(id);
  if (!el) {
    void renderRekordboxLive();
    return;
  }
  el.outerHTML = html();
  refreshBar();
}
const rerenderMasterdbRepairsSection = () => rerenderSection("sift-rkb-masterdb-section", () => masterdbRepairsSectionHtml(fetched.repairs ?? []));
const rerenderMetadataSyncsSection = () => rerenderSection("sift-rkb-mds-section", () => metadataSyncsSectionHtml(fetched.metas ?? []));
const rerenderArtworkSyncsSection = () => rerenderSection("sift-rkb-mas-section", () => artworkSyncsSectionHtml(fetched.arts ?? []));
const rerenderDedupSection = () => rerenderSection("sift-rkb-dedup-section", () => playlistDuplicatesSectionHtml(fetched.dedups ?? []));

// ---------------------------------------------------------------------------
// Barre unifiée — Photos › Importer : « Synchroniser la sélection » (inactif sans sélection) ·
// « Tout synchroniser (N) » (primaire). N est borné à la section active, comme le plan.
// ---------------------------------------------------------------------------

function currentPlan(scope: "all" | "selection"): SyncPlan {
  return planSync(
    activeRkbSection,
    {
      repairs: lastPendingRepairs.map((r) => r.id),
      metas: lastPendingMetadataSyncs.map((r) => r.id),
      arts: lastPendingArtworkSyncs.map((r) => r.id),
      dedups: lastVisibleDedups.map(duplicateGroupKey),
    },
    { repairs: mdbRepairSel, metas: mdsSyncSel, arts: masSyncSel, dedups: dedupSel },
    scope,
  );
}

function refreshBar(): void {
  if (!lastLinkStatus?.linked) {
    mountBarActions("");
    return;
  }
  const all = currentPlan("all").total;
  const sel = currentPlan("selection").total;
  const off = syncUnavailable() || syncRunning;
  mountBarActions(
    `<button data-sift="rkbsyncsel" class="sift-bar-btn"${sel && !off ? "" : " disabled"}>${T().syncSelection}${sel ? ` (${sel})` : ""}</button>` +
      `<button data-sift="rkbsyncall" class="sift-ranger-btn sift-bar-btn"${all && !off ? "" : " disabled"}>${T().syncAll} (${all})</button>`,
  );
}

// ---------------------------------------------------------------------------
// Zone C — la grammaire du Finder › appareil : tête (icône, nom, une ligne de faits), puis des
// sections à libellé aligné à droite, la valeur en face, les actions secondaires dans la section.
// ---------------------------------------------------------------------------

function factRowHtml(label: string, body: string): string {
  return `<div class="rkb-fact"><span class="rkb-fact-label">${label}</span><div class="rkb-fact-body">${body}</div></div>`;
}

function headHtml(s: RekordboxLinkStatus, totalPending: number): string {
  const L = T();
  const file = fileName(s.path) || L.xmlFallback;
  const state = syncUnavailable()
    ? `<span class="rkb-warn">${L.syncUnavailable}</span>`
    : failedSections > 0
      ? `<span class="rkb-warn">${L.sectionsNoReply(failedSections)}</span>`
      : totalPending > 0
        ? L.pendingSync(totalPending)
        : L.upToDate;
  const sub = s.error
    ? `<span class="rkb-danger">${L.xmlUnreadable}</span>`
    : L.xmlLinked(s.playlist_count, s.track_count, state);
  return (
    `<div class="sift-usage-head rkb-head">` +
    `<span class="rkb-glyph" aria-hidden="true"><i class="ti ti-disc"></i></span>` +
    `<div class="sift-usage-ident"><span class="sift-usage-name">${esc(file)}</span><span class="sift-usage-sub">${sub}</span></div>` +
    `</div><div class="sift-usage-rule"></div>`
  );
}

/** Rekordbox integration page (data-view="rkb"). Renders the whole page fresh each call, same
 *  pattern as renderBiblioLive/renderJournal — no mock DOM survives. */
export async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  // Jeton capturé dans le même geste que `#content` (issue #42). Cet écran est le plus exposé de
  // tous : CINQ allers-retours IPC séquentiels avant sa première écriture complète, chacun bloqué
  // par le `Mutex<Connection>` que le scan tient en rafale.
  const token = viewEpoch();
  // Squelette statique au premier passage (DESIGN.md § 6). Un re-rendu garde l'écran précédent.
  if (!content.querySelector(".sift-rkb-layout, .sift-empty-state")) {
    content.innerHTML =
      `<div class="sift-rkb-layout"><nav class="sift-rkb-side"></nav>` +
      `<div class="sift-rkb-main"><span class="sift-skel sift-skel-line"></span></div></div>`;
  }
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
    lastLinkStatus = status;
  } catch (e) {
    console.error("rekordbox_status failed", e);
    if (isStaleViewRender(token)) return;
    lastLinkStatus = null;
    mountBarActions("");
    content.innerHTML = `<div class="rkb-fact-body rkb-danger">${T().statusUnavailable}</div>`;
    return;
  }
  if (isStaleViewRender(token)) return;

  if (!status.linked) {
    mountBarActions("");
    content.innerHTML = emptyStateHtml({
      title: T().emptyTitle,
      note: T().emptyNote,
      actionHtml: `<button data-bib="rkblink">${T().emptyAction}</button>`,
    });
    wireEmptyState(content);
    return;
  }

  // Le relevé : quatre appels, un `null` pour une section tombée. Impasse A14 (issue #15) : une
  // section en erreur se COMPTE (`failedSections`, dans `paintRekordbox`) — quatre sections en
  // erreur donnaient un total de 0 et une tête « à jour ».
  const next: typeof fetched = { repairs: null, metas: null, arts: null, dedups: null };
  try {
    next.repairs = await rekordboxMasterdbPendingRepairs();
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
  }
  try {
    next.dedups = await rekordboxMasterdbScanPlaylistDuplicates();
  } catch (e) {
    console.error("rekordbox_masterdb_scan_playlist_duplicates failed", e);
  }
  try {
    next.metas = await rekordboxMasterdbPendingMetadataSyncs();
  } catch (e) {
    console.error("rekordbox_masterdb_pending_metadata_syncs failed", e);
  }
  try {
    next.arts = await rekordboxMasterdbPendingArtworkSyncs();
  } catch (e) {
    console.error("rekordbox_masterdb_pending_artwork_syncs failed", e);
  }
  if (isStaleViewRender(token)) return;
  fetched = next;
  lastScannedDuplicateGroups = next.dedups ?? [];
  paintRekordbox(content, status);
  installRekordboxWiring(content);
}

/** Peint l'écran depuis le dernier relevé (`fetched`) et la recherche — sans IPC. Appelée après
 *  chaque relevé, et à chaque frappe dans la recherche de la barre. */
function paintRekordbox(content: HTMLElement, status: RekordboxLinkStatus): void {
  const L = T();
  // En-tête « Fichiers (—) », jamais « (0) » : une section qui n'a rien pu dire n'a pas zéro
  // rangée, elle a un compte inconnu — même « — » que la colonne B′ (#84).
  const failedHtml = (id: string, label: string) =>
    `<div id="${id}"><div class="rkb-group-hd">${esc(label)} (—)</div>${sectionErrorHtml()}</div>`;
  // #84 : sans `master.db`, aucune section ne peut rien détecter, même celles dont l'appel a réussi
  // (elles lisent la base de Sift). Chacune dit alors pourquoi (`sectionView`), sans compte ni
  // rangées d'avant. Borné à `masterdb_error` : le XML illisible garde son rendu, non tranché ici.
  const unavailable = status.masterdb_error != null;
  const view = (rows: unknown[] | null, count: number) => sectionView({ callFailed: !rows, unavailable, count });
  // Une section tombée n'a rien en attente : le plan ne doit pas viser ses rangées d'avant.
  if (!fetched.repairs || unavailable) lastPendingRepairs = [];
  if (!fetched.metas || unavailable) lastPendingMetadataSyncs = [];
  if (!fetched.arts || unavailable) lastPendingArtworkSyncs = [];
  if (!fetched.dedups || unavailable) lastVisibleDedups = [];
  const pendingOf = (rows: { status: string }[] | null) => (rows ?? []).filter((r) => r.status === "pending").length;
  const vFiles = view(fetched.repairs, pendingOf(fetched.repairs));
  const vMeta = view(fetched.metas, pendingOf(fetched.metas));
  const vArt = view(fetched.arts, pendingOf(fetched.arts));
  const vDedup = view(fetched.dedups, fetched.dedups?.length ?? 0);

  // Colonne B′ — la sidebar d'Utilitaire de disque, au plan de la file de Revue. QUATRE entrées
  // plus « Tout » : une section dont l'appel a échoué GARDE son entrée, compte remplacé par « — »
  // (une section absente se lirait « rien à faire », ce qui est un mensonge). Les comptes sont
  // ceux de la section entière : la recherche filtre la zone C, pas la colonne.
  const sections: { key: Exclude<RkbSection, "all">; label: string; html: string; count: number; countLabel: string; rows: number; failed: boolean }[] = [
    {
      key: "files",
      label: L.grpFiles,
      html: fetched.repairs && !vFiles.error ? masterdbRepairsSectionHtml(fetched.repairs) : failedHtml("sift-rkb-masterdb-section", L.grpFiles),
      count: vFiles.error ? 0 : pendingOf(fetched.repairs),
      countLabel: vFiles.count,
      rows: vFiles.error ? 0 : (fetched.repairs?.length ?? 0),
      failed: vFiles.error,
    },
    {
      key: "meta",
      label: L.grpMeta,
      html: fetched.metas && !vMeta.error ? metadataSyncsSectionHtml(fetched.metas) : failedHtml("sift-rkb-mds-section", L.grpMeta),
      count: vMeta.error ? 0 : pendingOf(fetched.metas),
      countLabel: vMeta.count,
      rows: vMeta.error ? 0 : (fetched.metas?.length ?? 0),
      failed: vMeta.error,
    },
    {
      key: "art",
      label: L.grpArt,
      html: fetched.arts && !vArt.error ? artworkSyncsSectionHtml(fetched.arts) : failedHtml("sift-rkb-mas-section", L.grpArt),
      count: vArt.error ? 0 : pendingOf(fetched.arts),
      countLabel: vArt.count,
      rows: vArt.error ? 0 : (fetched.arts?.length ?? 0),
      failed: vArt.error,
    },
    {
      key: "dedup",
      label: L.grpPlaylists,
      html: fetched.dedups && !vDedup.error ? playlistDuplicatesSectionHtml(fetched.dedups) : failedHtml("sift-rkb-dedup-section", L.grpPlaylists),
      count: vDedup.error ? 0 : (fetched.dedups?.length ?? 0),
      countLabel: vDedup.count,
      rows: vDedup.error ? 0 : (fetched.dedups?.length ?? 0),
      failed: vDedup.error,
    },
  ];
  failedSections = sections.filter((x) => x.failed).length;
  const totalPending = sections.reduce((n, x) => n + x.count, 0);
  if (activeRkbSection !== "all" && !sections.some((x) => x.key === activeRkbSection)) activeRkbSection = "all";
  const entry = (key: RkbSection, label: string, count: string): string =>
    `<div class="fld${activeRkbSection === key ? " on" : ""}" data-rkb="section" data-sec="${key}" tabindex="0" role="button">` +
    `<span>${esc(label)}</span><span class="rkb-entry-count">${count}</span></div>`;
  const side =
    `<nav class="sift-rkb-side" aria-label="${L.sideAria}">` +
    `<div class="col-h">${L.sideHeader}</div>` +
    entry("all", L.sideAll, failedSections ? "—" : String(totalPending)) +
    sections.map((x) => entry(x.key, x.label, x.countLabel)).join("") +
    `</nav>`;

  // Fichier : le chemin, et les deux actions du XML près du XML (Finder : Check for Update sous
  // Software:). Pas de « Réexporter » tant que le fichier lié est illisible — le backend refuse
  // déjà l'export dans ce cas (export_rekordbox_xml_inner relit le même chemin avant de fusionner).
  const fileRow = factRowHtml(
    L.factFile,
    `<div class="rkb-mono">${esc(status.path || "")}</div>` +
      `<div class="rkb-fact-actions">` +
      (status.error ? "" : `<button data-sift="rkbreexport" class="sift-meta-ident-btn">${L.reexportNow}</button>`) +
      `<button data-bib="rkblink" class="sift-meta-ident-btn">${L.changeXml}</button></div>`,
  );
  // master.db : l'état, puis la dérive — phrase entière, jamais tronquée (spec § États). Elle
  // était un bandeau ; un fait à côté de son libellé dit la même chose sans crier.
  const dbRow = factRowHtml(
    L.factMasterdb,
    (status.masterdb_error ? `<div class="rkb-warn">${esc(status.masterdb_error)}</div>` : `<div>${L.readable}</div>`) +
      (status.drift_detected
        ? `<div class="rkb-warn">${L.driftFailed}</div>`
        : `<div class="rkb-fact-muted">${L.driftNone}</div>`),
  );
  const shown = activeRkbSection === "all" ? sections : sections.filter((x) => x.key === activeRkbSection);
  const groups = shown.map((x) => x.html).join("");
  const anyRow = shown.some((x) => x.html.includes("rkb-cand") || x.html.includes("rkb-section-err"));
  // Rien de visible : soit la section est à jour, soit la recherche a tout masqué — deux
  // situations à ne pas confondre, la seconde n'est pas « à jour ».
  const hidden = rkbQuery.trim() !== "" && shown.some((x) => x.rows > 0);
  const empty = hidden ? L.noMatch(rkbQuery.trim()) : L.nothingPending(activeRkbSection === "all");
  const pendingRow = factRowHtml(
    L.factPending,
    anyRow ? groups : `<div class="rkb-fact-muted">${esc(empty)}</div>` + groups,
  );

  content.innerHTML =
    `<div class="sift-rkb-layout">${side}<div class="sift-rkb-main"><div class="rkb-main">` +
    headHtml(status, totalPending) +
    fileRow +
    `<div class="rkb-rule"></div>` +
    dbRow +
    `<div class="rkb-rule"></div>` +
    pendingRow +
    `</div></div></div>`;
  refreshBar();
  mountBarSearch({
    placeholder: L.search,
    ariaLabel: L.search,
    value: rkbQuery,
    onInput: (v) => {
      rkbQuery = v;
      if (syncRunning || !lastLinkStatus?.linked || document.body.dataset.view !== "rkb") return;
      paintRekordbox(requireEl("#content", "rekordbox search"), lastLinkStatus);
    },
  });
}

/** Appelée par le dispatch délégué au clic sur une entrée de section. */
export function onRekordboxSectionPick(key: string): void {
  // Un rendu complet effacerait la feuille de progression : la section se change après.
  if (syncRunning) return;
  activeRkbSection = key as RkbSection;
  void renderRekordboxLive();
}

// ---------------------------------------------------------------------------
// Câblage posé UNE fois (`#content` survit aux rendus) : le clic droit et la touche Entrée. Il
// était posé à chaque rendu, et la recherche repeint à chaque frappe — un écouteur de plus par
// frappe.
// ---------------------------------------------------------------------------

let wired = false;

function installRekordboxWiring(content: HTMLElement): void {
  if (wired) return;
  wired = true;
  content.addEventListener("contextmenu", (e) => {
    if (document.body.dataset.view !== "rkb") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".rkb-cand");
    if (!row) return;
    const items = rowMenu(row);
    if (!items) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, items);
  });
  // Spec § Clavier : Entrée synchronise la sélection, après confirmation. Aucun raccourci à une
  // lettre sur cet écran : il écrit dans une base tierce.
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "rkb" || e.key !== "Enter" || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || syncRunning) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    // Un bouton ou une entrée de section focalisés prennent Entrée pour leur propre activation ;
    // un menu ouvert ou une confirmation aussi (`duplicates-view.ts`, même règle).
    if (target?.closest('button, a, [role="button"], summary, [role="menu"], #sift-context-menu')) return;
    if (document.getElementById("sift-confirm-overlay")) return;
    const plan = currentPlan("selection");
    if (!plan.total || syncUnavailable()) return;
    e.preventDefault();
    void runSync(plan);
  });
}

/** Le nom d'une piste dans Bibliothèque : le nom du fichier sans extension, comme le Journal. */
const stem = (p: string | null | undefined): string => fileName(p).replace(/\.[^.]+$/, "");

/** Bibliothèque filtrée sur la piste. Par un clic sur la destination du rail, pas par un import du
 *  routeur, qui importe ce module (`journal.ts::showInLibrary`, même chemin). */
function showInLibrary(name: string): void {
  bibState.filter = { q: name };
  document.querySelector<HTMLElement>('[data-view="biblio"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function openLocation(trackId: number): Promise<void> {
  try {
    await revealTrack(trackId);
  } catch (err) {
    toast(humanizeError(err, T().openLocationFailed, "reveal_track"));
  }
}

const EMPTY_PLAN: SyncPlan = { repairs: [], metas: [], arts: [], dedups: [], total: 0 };

/** Spec § Souris : Synchroniser cette entrée · Ignorer · Voir la piste dans Bibliothèque · Ouvrir
 *  l'emplacement. Une entrée impossible reste visible, désactivée (`context-menu.ts`) : une rangée
 *  ambiguë ne se synchronise pas avant le choix de sa piste ; un doublon de playlist n'a ni
 *  « Ignorer » (rien n'est persisté, le scan le retrouverait) ni piste Sift à montrer. */
function rowMenu(row: HTMLElement): MenuItem[] | null {
  const L = T();
  const pick = row.dataset.sift || row.dataset.rkbamb || "";
  const ambiguous = row.dataset.rkbamb != null;
  const id = Number(row.dataset.id);
  let plan: SyncPlan | null = null;
  let dismiss: (() => Promise<void>) | null = null;
  let name = "";
  let trackId: number | null = null;
  if (pick.startsWith("mdb")) {
    const r = fetched.repairs?.find((x) => x.id === id);
    if (!r) return null;
    plan = { ...EMPTY_PLAN, repairs: [id], total: 1 };
    dismiss = () => rekordboxMasterdbDismissRepair(id);
    name = stem(r.to_path);
    trackId = r.sift_track_id;
  } else if (pick.startsWith("mds")) {
    const r = fetched.metas?.find((x) => x.id === id);
    if (!r) return null;
    plan = { ...EMPTY_PLAN, metas: [id], total: 1 };
    dismiss = () => rekordboxMasterdbDismissMetadataSync(id);
    name = stem(r.sift_path);
    trackId = r.track_id;
  } else if (pick.startsWith("mas")) {
    const r = fetched.arts?.find((x) => x.id === id);
    if (!r) return null;
    plan = { ...EMPTY_PLAN, arts: [id], total: 1 };
    dismiss = () => rekordboxMasterdbDismissArtworkSync(id);
    name = stem(r.sift_path);
    trackId = r.track_id;
  } else if (pick === "dedpick") {
    const key = row.dataset.key || "";
    const g = lastScannedDuplicateGroups.find((x) => duplicateGroupKey(x) === key);
    if (!g) return null;
    plan = { ...EMPTY_PLAN, dedups: [key], total: 1 };
    name = stem(g.track_path);
  } else {
    return null;
  }
  const canSync = !ambiguous && !syncRunning && !syncUnavailable();
  const entryPlan = plan;
  const entryDismiss = dismiss;
  const entryTrack = trackId;
  return [
    { label: L.syncEntry, onPick: canSync ? () => void runSync(entryPlan) : undefined },
    {
      label: L.ignore,
      danger: true,
      onPick: entryDismiss && !syncRunning
        ? () =>
            void (async () => {
              try {
                await entryDismiss();
              } catch (err) {
                console.error("rekordbox dismiss failed", err);
                toast(L.actionFailed);
              }
              void renderRekordboxLive();
            })()
        : undefined,
    },
    { label: L.showInLibrary, separated: true, onPick: name ? () => showInLibrary(name) : undefined },
    { label: L.openLocation, onPick: entryTrack != null ? () => void openLocation(entryTrack) : undefined },
  ];
}

// ---------------------------------------------------------------------------
// Synchroniser — les quatre écritures enchaînées dans l'ordre des tiers, une confirmation avant,
// une feuille pendant (spec § États : barre déterminée, étape en texte, Annuler), un rapport
// après. Chaque IPC garde son backup et son refus si Rekordbox tourne ; un échec en cours de route
// s'inscrit sur sa rangée et n'arrête pas les suivantes (leur backup est le leur). « Annuler »
// s'arrête entre deux entrées : ce qui est écrit reste écrit, le reste reste en attente.
// ---------------------------------------------------------------------------

/** La feuille, non modale, en tête de zone C (`.sift-batch-sheet`, forme de la feuille de copie du
 *  Finder, comme Doublons), dans une ancre de hauteur nulle : elle ne pousse pas la page. */
function mountSheet(state: "progress" | "report", html: string): HTMLElement | null {
  const main = document.querySelector<HTMLElement>("#content .rkb-main");
  if (!main) return null;
  document.querySelector(".rkb-sheet-anchor")?.remove();
  const anchor = document.createElement("div");
  anchor.className = "rkb-sheet-anchor";
  const sheet = document.createElement("div");
  sheet.className = "sift-batch-sheet";
  sheet.dataset.state = state;
  sheet.innerHTML = html;
  anchor.appendChild(sheet);
  main.insertBefore(anchor, main.firstChild);
  // La feuille glisse depuis le haut (spec § Retour, `--duration-slow`) — seulement à l'ouverture :
  // le rapport remplace la progression sans rejouer la glissade.
  if (state === "progress") requestAnimationFrame(() => sheet.classList.add("sift-batch-sheet--open"));
  else sheet.classList.add("sift-batch-sheet--open");
  return sheet;
}

interface SyncFailure {
  name: string;
  error: string;
}

/** Le nom d'une entrée dans le rapport — celui de sa rangée. */
function entryName(kind: "mdb" | "mds" | "mas", id: number): string {
  if (kind === "mdb") {
    const r = fetched.repairs?.find((x) => x.id === id);
    return r ? trackLabel(r.artist, r.title, r.to_path) : `#${id}`;
  }
  if (kind === "mds") {
    const r = fetched.metas?.find((x) => x.id === id);
    return r ? (r.new_artist && r.new_title ? `${r.new_artist} — ${r.new_title}` : fileName(r.sift_path)) : `#${id}`;
  }
  const r = fetched.arts?.find((x) => x.id === id);
  return r ? trackLabel(r.artist, r.title, r.sift_path) : `#${id}`;
}

async function runSync(plan: SyncPlan): Promise<void> {
  if (syncRunning || !plan.total) return;
  const L = T();
  const proceed = await confirmAction(
    L.confirmSync(plan.total, clearedCount(lastPendingMetadataSyncs, plan.metas)),
    L.confirmSyncButton,
  );
  if (!proceed || syncRunning) return;
  syncRunning = true;
  syncStopRequested = false;
  refreshBar();
  const sheet = mountSheet(
    "progress",
    `<div class="sift-bs-head"><div class="sift-bs-title">${esc(L.syncing(plan.total))}</div>` +
      `<button class="sift-baction sift-baction--quiet sift-bs-stop" data-sift="rkbsyncstop">${L.stop}</button></div>` +
      `<progress class="sift-bs-bar" value="0" max="${plan.total}"></progress>` +
      `<div class="sift-bs-step"></div>`,
  );
  let ok = 0;
  let base = 0;
  const failures: SyncFailure[] = [];
  const paint = (done: number, step: string) => {
    if (!sheet) return;
    const bar = sheet.querySelector<HTMLProgressElement>(".sift-bs-bar");
    if (bar) bar.value = done;
    const el = sheet.querySelector<HTMLElement>(".sift-bs-step");
    if (el) el.textContent = L.syncStep(Math.min(done + 1, plan.total), plan.total, step);
  };
  let step = "";
  let unlisten: (() => void) | null = null;
  const outcome = (
    kind: "mdb" | "mds" | "mas",
    o: { id: number; ok: boolean; error: string | null },
    sel: Set<number>,
    errs: Map<number, string>,
  ) => {
    sel.delete(o.id);
    if (o.ok) {
      errs.delete(o.id);
      ok++;
    } else {
      const error = o.error || L.unknownFailure;
      errs.set(o.id, error);
      failures.push({ name: entryName(kind, o.id), error });
    }
  };
  // Un appel par tier. `done` de l'événement compte dans l'appel en cours ; `base` y ajoute les
  // appels précédents. Les ids non atteints (Annuler) n'ont pas d'issue : ils restent en attente,
  // et cochés.
  const tier = async <O extends { id: number; ok: boolean; error: string | null }>(
    kind: "mdb" | "mds" | "mas",
    ids: number[],
    label: string,
    call: (ids: number[]) => Promise<O[]>,
    sel: Set<number>,
    errs: Map<number, string>,
    what: string,
  ) => {
    if (!ids.length || syncStopRequested) return;
    step = label;
    paint(base, step);
    try {
      const out = await call(ids);
      for (const o of out) outcome(kind, o, sel, errs);
      base += out.length;
    } catch (e) {
      console.error(`${what} failed`, e);
      for (const id of ids) failures.push({ name: entryName(kind, id), error: String(e) });
      base += ids.length;
    }
    paint(base, step);
  };
  try {
    // Dans le `try` : un abonnement ou un drapeau refusés ne doivent pas laisser `syncRunning` levé.
    await rekordboxMasterdbSetSyncStop(false);
    unlisten = await onRekordboxSyncProgress((p) => paint(base + p.done, step));
    await tier("mdb", plan.repairs, L.grpFiles, rekordboxMasterdbApplyRepairs, mdbRepairSel, mdbErrorById, "rekordbox_masterdb_apply_repairs");
    await tier("mds", plan.metas, L.grpMeta, rekordboxMasterdbApplyMetadataSyncs, mdsSyncSel, mdsErrorById, "rekordbox_masterdb_apply_metadata_syncs");
    await tier("mas", plan.arts, L.grpArt, rekordboxMasterdbApplyArtworkSyncs, masSyncSel, masErrorById, "rekordbox_masterdb_apply_artwork_syncs");
    for (const key of plan.dedups) {
      if (syncStopRequested) break;
      const group = lastScannedDuplicateGroups.find((g) => duplicateGroupKey(g) === key);
      if (!group) continue;
      step = L.grpPlaylists;
      paint(base, step);
      try {
        await rekordboxMasterdbDedupPlaylistGroup(group);
        mdbDedupErrorByKey.delete(key);
        dedupSel.delete(key);
        ok++;
      } catch (e) {
        console.error("rekordbox_masterdb_dedup_playlist_group failed", e);
        const error = e instanceof Error ? e.message : String(e) || L.unknownFailure;
        mdbDedupErrorByKey.set(key, error);
        failures.push({ name: group.playlist_name || L.playlistN(group.playlist_id), error });
      }
      base++;
      paint(base, step);
    }
  } catch (e) {
    console.error("rekordbox sync setup failed", e);
    toast(L.actionFailed);
  } finally {
    unlisten?.();
    syncRunning = false;
  }
  const left = plan.total - ok - failures.length;
  const stopped = syncStopRequested && left > 0;
  syncStopRequested = false;
  await renderRekordboxLive();
  if (document.body.dataset.view !== "rkb") return;
  if (!failures.length && !stopped) {
    document.querySelector(".rkb-sheet-anchor")?.remove();
    toast(L.syncReportOk(ok));
    return;
  }
  // Spec § États › Rapport : résumé chiffré, détail des échecs, une sortie claire.
  const items = failures
    .map(
      (f) =>
        `<div class="sift-bs-item"><span class="sift-bs-item-name">${esc(f.name)}</span>` +
        `<span class="sift-bs-item-err">${esc(f.error)}</span></div>`,
    )
    .join("");
  mountSheet(
    "report",
    `<div class="sift-bs-title sift-bs-title--report">${esc(L.syncReport(ok, failures.length, stopped ? left : 0))}</div>` +
      (failures.length
        ? `<details class="sift-bs-section sift-bs-section--error" open>` +
          `<summary>${esc(L.reportFailed(failures.length))}</summary>` +
          `<div class="sift-bs-items">${items}</div></details>`
        : "") +
      `<div class="sift-bs-footer"><button class="sift-baction sift-baction--quiet" data-sift="rkbsheetclose">${L.close}</button></div>`,
  );
}

/** Routes the Rekordbox screen's delegated clicks (`rkb*`/`mdb*`/`mds*`/`mas*`/`ded*` `data-sift`
 *  actions). Returns true if it handled `act` (caller must stop processing), false otherwise so the
 *  caller's chain can continue to non-Rekordbox actions. `onReexport` is injected because the XML
 *  export (`runNavExport`) stays in sift-live.ts — this avoids a reverse import. */
export function handleRekordboxAction(
  el: HTMLElement,
  act: string,
  e: MouseEvent,
  onReexport: () => void,
): boolean {
  const toggle = (id: number, sel: Set<number>, errs: Map<number, string>, rerender: () => void) => {
    if (sel.has(id)) sel.delete(id);
    else {
      sel.add(id);
      errs.delete(id);
    }
    rerender();
  };
  const resolve = (id: number, trackId: string, call: (id: number, t: string) => Promise<void>, what: string) => {
    void (async () => {
      try {
        await call(id, trackId);
      } catch (err) {
        console.error(`${what} failed`, err);
        const raw = String(err);
        // Deux sentinelles du backend (`rekordbox_repairs.rs`, miroir dans `shared/contracts.ts`),
        // qui remplacent depuis le 2026-09-23 les phrases françaises reconnues par `includes` et
        // affichées telles quelles — traduites, elles auraient cessé de correspondre.
        toast(
          raw.includes(AMBIGUITY_STALE)
            ? T().ambiguityStale
            : raw.includes(AMBIGUITY_BAD_CHOICE)
              ? T().ambiguityBadChoice
              : T().choiceFailed,
        );
      }
      void renderRekordboxLive();
    })();
  };
  const id = Number(el.dataset.id);
  switch (act) {
    case "rkbreexport":
      e.stopPropagation();
      onReexport();
      return true;
    case "rkbsyncall":
    case "rkbsyncsel":
      e.stopPropagation();
      void runSync(currentPlan(act === "rkbsyncall" ? "all" : "selection"));
      return true;
    case "rkbsyncstop":
      e.stopPropagation();
      if (!syncRunning || syncStopRequested) return true;
      syncStopRequested = true;
      (el as HTMLButtonElement).disabled = true;
      el.textContent = T().stopping;
      void rekordboxMasterdbSetSyncStop(true).catch((err) => console.error("rekordbox_masterdb_set_sync_stop failed", err));
      return true;
    case "rkbsheetclose":
      e.stopPropagation();
      document.querySelector(".rkb-sheet-anchor")?.remove();
      return true;
    case "mdbpick":
      e.stopPropagation();
      toggle(id, mdbRepairSel, mdbErrorById, rerenderMasterdbRepairsSection);
      return true;
    case "mdspick":
      e.stopPropagation();
      toggle(id, mdsSyncSel, mdsErrorById, rerenderMetadataSyncsSection);
      return true;
    case "maspick":
      e.stopPropagation();
      toggle(id, masSyncSel, masErrorById, rerenderArtworkSyncsSection);
      return true;
    case "dedpick": {
      e.stopPropagation();
      const key = el.dataset.key || "";
      if (dedupSel.has(key)) dedupSel.delete(key);
      else {
        dedupSel.add(key);
        mdbDedupErrorByKey.delete(key);
      }
      rerenderDedupSection();
      return true;
    }
    case "mdbresolve":
      e.stopPropagation();
      resolve(id, el.dataset.track || "", rekordboxMasterdbResolveAmbiguous, "rekordbox_masterdb_resolve_ambiguous");
      return true;
    case "mdsresolve":
      e.stopPropagation();
      resolve(id, el.dataset.track || "", rekordboxMasterdbResolveAmbiguousMetadataSync, "rekordbox_masterdb_resolve_ambiguous_metadata_sync");
      return true;
    case "masresolve":
      e.stopPropagation();
      resolve(id, el.dataset.track || "", rekordboxMasterdbResolveAmbiguousArtworkSync, "rekordbox_masterdb_resolve_ambiguous_artwork_sync");
      return true;
    default:
      return false;
  }
}
