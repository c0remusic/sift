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
import { mountBarActions } from "./toolbar";
import { openContextMenu } from "./context-menu";
import { planSync, type RkbSection, type SyncPlan } from "./rekordbox-plan";
import { T } from "./i18n/rekordbox-view";

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

/** Statut du dernier rendu complet — les sections y lisent si le lien lui-même est cassé, pour ne
 *  pas dire « à jour » quand la synchronisation est indisponible (F3, audit-heuristique-visuel). */
let lastLinkStatus: RekordboxLinkStatus | null = null;

/** Section affichée. « Tout » = le XML entier, les quatre sections. */
let activeRkbSection: RkbSection = "all";

/** Sections dont l'appel IPC a échoué au dernier rendu — comptées, jamais tues (impasse A14). */
let failedSections = 0;

/** Une synchronisation à la fois : le bouton reste en état « en cours » et refuse un second clic. */
let syncRunning = false;

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

/** Busy state for the master.db write buttons, class for class on the repo's own precedent
 *  (filing-actions.ts's doRanger: `ti ti-loader-2 sift-spin sift-icon-inline-md` + a label).
 *  `text` is a LABEL — what the button is doing, counted — never an instruction: "close Rekordbox
 *  first" belongs to the confirm dialog that precedes the click. Only numbers and literals reach
 *  this, so the interpolation carries no user input. */
function busyLabel(text: string): string {
  return `<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> ${text}`;
}

// ---------------------------------------------------------------------------
// Rangées de candidats — la grammaire de Photos › Importer : un groupe nommé avec son compte, une
// rangée par élément, une case. Le clic sur la rangée coche ; le clic droit porte « Ignorer » et,
// pour un candidat ambigu, le choix de la piste Rekordbox.
// ---------------------------------------------------------------------------

/** Une rangée cochable. `pick` est le `data-sift` du toggle (mdbpick / mdspick / maspick /
 *  dedpick), `ref` l'attribut d'identité (`data-id` numérique, ou `data-key` pour un doublon). */
function candidateRowHtml(
  pick: string,
  ref: string,
  checked: boolean,
  piste: string,
  ecart: string,
  error: string | undefined,
): string {
  return (
    `<div class="rkb-cand${checked ? " sel" : ""}" data-sift="${pick}" ${ref} tabindex="0" role="checkbox" aria-checked="${checked}">` +
    `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
    `<span class="rkb-cand-piste">${piste}</span>` +
    `<span class="rkb-cand-ecart">${ecart}</span>` +
    (error ? `<span class="rkb-cand-err">${esc(error)}</span>` : "") +
    `</div>`
  );
}

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
function masterdbRepairsSectionHtml(rows: PendingMasterdbRepair[]): string {
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdbRepairSel]) if (!liveIds.has(id)) mdbRepairSel.delete(id);
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
function metadataSyncsSectionHtml(rows: PendingMetadataSync[]): string {
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdsSyncSel]) if (!liveIds.has(id)) mdsSyncSel.delete(id);
  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingMetadataSyncs = pending;
  if (!pending.length && !ambiguous.length) return `<div id="sift-rkb-mds-section"></div>`;
  const piste = (r: PendingMetadataSync) =>
    esc(r.new_artist && r.new_title ? `${r.new_artist} — ${r.new_title}` : fileName(r.sift_path));
  const ecart = (r: PendingMetadataSync) => {
    const L = T();
    const parts: string[] = [];
    if (r.new_artist) parts.push(`${L.artist} ${esc(r.new_artist)}`);
    if (r.new_title) parts.push(`${L.title} ${esc(r.new_title)}`);
    if (r.new_genre) parts.push(`${L.genre} ${esc(r.new_genre)}`);
    if (r.new_year != null) parts.push(`${L.year} ${r.new_year}`);
    if (r.new_label) parts.push(`${L.label} ${esc(r.new_label)}`);
    return parts.join(" · ") || L.tags;
  };
  return (
    `<div id="sift-rkb-mds-section">` +
    groupHeadHtml(T().grpMeta, pending.length, ambiguous.length) +
    pending.map((r) => candidateRowHtml("mdspick", `data-id="${r.id}"`, mdsSyncSel.has(r.id), piste(r), ecart(r), mdsErrorById.get(r.id))).join("") +
    ambiguous.map((r) => ambiguousRowHtml("mdsresolve", r.id, piste(r), ecart(r), candidateList(r), mdsErrorById.get(r.id))).join("") +
    `</div>`
  );
}

/** Tier 3 — nouvelle pochette écrite sur un fichier lié à Rekordbox (détecteur distinct des tags). */
function artworkSyncsSectionHtml(rows: PendingArtworkSync[]): string {
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...masSyncSel]) if (!liveIds.has(id)) masSyncSel.delete(id);
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
function playlistDuplicatesSectionHtml(groups: PlaylistDuplicateGroupDto[]): string {
  const liveKeys = new Set(groups.map(duplicateGroupKey));
  for (const k of [...dedupSel]) if (!liveKeys.has(k)) dedupSel.delete(k);
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
const rerenderMasterdbRepairsSection = () => rerenderSection("sift-rkb-masterdb-section", () => masterdbRepairsSectionHtml(lastPendingRepairs));
const rerenderMetadataSyncsSection = () => rerenderSection("sift-rkb-mds-section", () => metadataSyncsSectionHtml(lastPendingMetadataSyncs));
const rerenderArtworkSyncsSection = () => rerenderSection("sift-rkb-mas-section", () => artworkSyncsSectionHtml(lastPendingArtworkSyncs));
const rerenderDedupSection = () => rerenderSection("sift-rkb-dedup-section", () => playlistDuplicatesSectionHtml(lastScannedDuplicateGroups));

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
      dedups: lastScannedDuplicateGroups.map(duplicateGroupKey),
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

  // Impasse A14 (issue #15) : les quatre `catch` remettent leur tableau à `[]` AVANT le calcul du
  // total. Quatre sections en erreur donnaient un total de 0 et une tête « à jour ». Compter les
  // sections tombées est ce qui permet à la tête de dire autre chose.
  failedSections = 0;
  let masterdbSection = "";
  try {
    masterdbSection = masterdbRepairsSectionHtml(await rekordboxMasterdbPendingRepairs());
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
    lastPendingRepairs = [];
    failedSections++;
    masterdbSection = `<div id="sift-rkb-masterdb-section">${groupHeadHtml(T().grpFiles, 0, 0)}${sectionErrorHtml()}</div>`;
  }
  let dedupSection = "";
  try {
    lastScannedDuplicateGroups = await rekordboxMasterdbScanPlaylistDuplicates();
    dedupSection = playlistDuplicatesSectionHtml(lastScannedDuplicateGroups);
  } catch (e) {
    console.error("rekordbox_masterdb_scan_playlist_duplicates failed", e);
    lastScannedDuplicateGroups = [];
    failedSections++;
    dedupSection = `<div id="sift-rkb-dedup-section">${groupHeadHtml(T().grpPlaylists, 0, 0)}${sectionErrorHtml()}</div>`;
  }
  let metadataSyncSection = "";
  try {
    metadataSyncSection = metadataSyncsSectionHtml(await rekordboxMasterdbPendingMetadataSyncs());
  } catch (e) {
    console.error("rekordbox_masterdb_pending_metadata_syncs failed", e);
    lastPendingMetadataSyncs = [];
    failedSections++;
    metadataSyncSection = `<div id="sift-rkb-mds-section">${groupHeadHtml(T().grpMeta, 0, 0)}${sectionErrorHtml()}</div>`;
  }
  let artworkSyncSection = "";
  try {
    artworkSyncSection = artworkSyncsSectionHtml(await rekordboxMasterdbPendingArtworkSyncs());
  } catch (e) {
    console.error("rekordbox_masterdb_pending_artwork_syncs failed", e);
    lastPendingArtworkSyncs = [];
    failedSections++;
    artworkSyncSection = `<div id="sift-rkb-mas-section">${groupHeadHtml(T().grpArt, 0, 0)}${sectionErrorHtml()}</div>`;
  }
  if (isStaleViewRender(token)) return;

  const totalPending = lastPendingRepairs.length + lastScannedDuplicateGroups.length + lastPendingMetadataSyncs.length + lastPendingArtworkSyncs.length;

  // Colonne B′ — la sidebar d'Utilitaire de disque, au plan de la file de Revue. QUATRE entrées
  // plus « Tout » : une section dont l'appel a échoué GARDE son entrée, compte remplacé par « — »
  // (une section absente se lirait « rien à faire », ce qui est un mensonge).
  const L = T();
  const sections: { key: Exclude<RkbSection, "all">; label: string; html: string; count: number; failed: boolean }[] = [
    { key: "files", label: L.grpFiles, html: masterdbSection, count: lastPendingRepairs.length, failed: masterdbSection.includes("rkb-section-err") },
    { key: "meta", label: L.grpMeta, html: metadataSyncSection, count: lastPendingMetadataSyncs.length, failed: metadataSyncSection.includes("rkb-section-err") },
    { key: "art", label: L.grpArt, html: artworkSyncSection, count: lastPendingArtworkSyncs.length, failed: artworkSyncSection.includes("rkb-section-err") },
    { key: "dedup", label: L.grpPlaylists, html: dedupSection, count: lastScannedDuplicateGroups.length, failed: dedupSection.includes("rkb-section-err") },
  ];
  if (activeRkbSection !== "all" && !sections.some((x) => x.key === activeRkbSection)) activeRkbSection = "all";
  const entry = (key: RkbSection, label: string, count: string): string =>
    `<div class="fld${activeRkbSection === key ? " on" : ""}" data-rkb="section" data-sec="${key}" tabindex="0" role="button">` +
    `<span>${esc(label)}</span><span class="rkb-entry-count">${count}</span></div>`;
  const side =
    `<nav class="sift-rkb-side" aria-label="${L.sideAria}">` +
    `<div class="col-h">${L.sideHeader}</div>` +
    entry("all", L.sideAll, failedSections ? "—" : String(totalPending)) +
    sections.map((x) => entry(x.key, x.label, x.failed ? "—" : String(x.count))).join("") +
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
  const pendingRow = factRowHtml(
    L.factPending,
    anyRow ? groups : `<div class="rkb-fact-muted">${L.nothingPending(activeRkbSection === "all")}</div>` + groups,
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
  wireContextMenu(content);
}

/** Appelée par le dispatch délégué au clic sur une entrée de section. */
export function onRekordboxSectionPick(key: string): void {
  activeRkbSection = key as RkbSection;
  void renderRekordboxLive();
}

// ---------------------------------------------------------------------------
// Clic droit sur une rangée : Ignorer (et rien d'autre — HIG Context menus, « a small number of
// menu items »). Un seul écouteur par rendu, sur `#content`, jamais un par rangée.
// ---------------------------------------------------------------------------

function wireContextMenu(content: HTMLElement): void {
  content.addEventListener("contextmenu", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".rkb-cand");
    if (!row) return;
    const pick = row.dataset.sift || row.dataset.rkbamb || "";
    const id = Number(row.dataset.id);
    const dismiss: (() => Promise<void>) | null =
      pick.startsWith("mdb") ? () => rekordboxMasterdbDismissRepair(id)
      : pick.startsWith("mds") ? () => rekordboxMasterdbDismissMetadataSync(id)
      : pick.startsWith("mas") ? () => rekordboxMasterdbDismissArtworkSync(id)
      : null;
    // Un doublon de playlist n'a pas d'« Ignorer » : rien n'est persisté, le scan le retrouvera.
    if (!dismiss) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      {
        label: T().ignore,
        danger: true,
        onPick: () =>
          void (async () => {
            try {
              await dismiss();
            } catch (err) {
              console.error("rekordbox dismiss failed", err);
              toast(T().actionFailed);
            }
            void renderRekordboxLive();
          })(),
      },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Synchroniser — les quatre écritures enchaînées dans l'ordre des tiers, une confirmation avant,
// un rapport après. Chaque IPC garde son backup et son refus si Rekordbox tourne ; un échec en
// cours de route s'inscrit sur sa rangée et n'arrête pas les suivantes (leur backup est le leur).
// ---------------------------------------------------------------------------

async function runSync(plan: SyncPlan, btn: HTMLButtonElement): Promise<void> {
  if (syncRunning || !plan.total) return;
  const proceed = await confirmAction(T().confirmSync(plan.total), T().confirmSyncButton);
  if (!proceed) return;
  syncRunning = true;
  refreshBar();
  const live = document.querySelector<HTMLButtonElement>(`[data-sift="${btn.dataset.sift}"]`);
  if (live) {
    live.disabled = true;
    live.innerHTML = busyLabel(T().syncing(plan.total));
  }
  let ok = 0;
  let failed = 0;
  const outcome = (o: { id: number; ok: boolean; error: string | null }, sel: Set<number>, errs: Map<number, string>) => {
    sel.delete(o.id);
    if (o.ok) {
      errs.delete(o.id);
      ok++;
    } else {
      errs.set(o.id, o.error || T().unknownFailure);
      failed++;
    }
  };
  try {
    if (plan.repairs.length) {
      try {
        for (const o of await rekordboxMasterdbApplyRepairs(plan.repairs)) outcome(o, mdbRepairSel, mdbErrorById);
      } catch (e) {
        console.error("rekordbox_masterdb_apply_repairs failed", e);
        failed += plan.repairs.length;
      }
    }
    if (plan.metas.length) {
      try {
        for (const o of await rekordboxMasterdbApplyMetadataSyncs(plan.metas)) outcome(o, mdsSyncSel, mdsErrorById);
      } catch (e) {
        console.error("rekordbox_masterdb_apply_metadata_syncs failed", e);
        failed += plan.metas.length;
      }
    }
    if (plan.arts.length) {
      try {
        for (const o of await rekordboxMasterdbApplyArtworkSyncs(plan.arts)) outcome(o, masSyncSel, masErrorById);
      } catch (e) {
        console.error("rekordbox_masterdb_apply_artwork_syncs failed", e);
        failed += plan.arts.length;
      }
    }
    for (const key of plan.dedups) {
      const group = lastScannedDuplicateGroups.find((g) => duplicateGroupKey(g) === key);
      if (!group) continue;
      try {
        await rekordboxMasterdbDedupPlaylistGroup(group);
        mdbDedupErrorByKey.delete(key);
        dedupSel.delete(key);
        ok++;
      } catch (e) {
        console.error("rekordbox_masterdb_dedup_playlist_group failed", e);
        mdbDedupErrorByKey.set(key, e instanceof Error ? e.message : T().unknownFailure);
        failed++;
      }
    }
  } finally {
    syncRunning = false;
  }
  toast(failed > 0 ? T().syncReportFailed(ok, failed) : T().syncReportOk(ok));
  void renderRekordboxLive();
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
      void runSync(currentPlan(act === "rkbsyncall" ? "all" : "selection"), el as HTMLButtonElement);
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
