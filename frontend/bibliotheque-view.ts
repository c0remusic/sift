// Bibliothèque screen — extracted from sift-live.ts (clean-architecture audit F1, 2026-07-09).
// Click handling for data-bib actions stays in sift-live.ts's delegated #pa handler (same split
// as ecartes-view.ts: render+state live here, dispatch stays centralized). The 3 "doublons
// internes" fields (dupGroups/dupLoading/dupShown) are reassigned from BOTH that handler and
// renderBiblioLive here — bare `let`s can't be reassigned across an import boundary in ES
// modules, so they're consolidated into the single exported `bibDup` object below and mutated by
// property assignment instead (same pattern bibState already used).
import {
  listLibrary,
  libraryFolders,
  libraryStats,
  scanLibraryDuplicates,
} from "./ipc";
import type { LibraryTrack, LibraryFacets, LibraryFilter, DupGroup, DashboardStats } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { mountBarActions, mountBarSearch, openAside, closeAside } from "./toolbar";
import { humanizeError } from "./errors";
import { libraryUsage, type UsageReport } from "./ipc";
import { renderUsageChart } from "./usage-chart";
import { emptyStateHtml, wireEmptyState } from "./empty-state";
import { createVirtualList, type VirtualList } from "./list-virtual";
import {
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
import { openLibraryDetailInto } from "./library-detail";

// Bibliothèque browser state: active filter, which facet column (folder/genre) is shown,
// and the last fetched track list (so a row-click can recover the track's path).
export const bibState: {
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

// Doublons internes panel state (Bibliothèque). `groups: null` = not run yet this session.
// Reassigned both here and from sift-live.ts's click handler (the "Doublons" stat/chip and its
// resolve action) — kept as one object rather than 3 loose lets precisely so that cross-module
// reassignment is a property write, not a rebinding.
// `error` distingue « le scan a echoue » de « le scan a rendu zero groupe ». Les deux
// collapsaient en `groups = []` dans les catch de sift-live.ts, donc un scan en ECHEC affichait
// « Aucun doublon dans toute la bibliotheque » — une affirmation sur l'etat du disque de
// l'utilisateur, produite par une commande qui n'a jamais abouti. Audit 2026-07-28, CC-1.
/** Minuterie du debounce de recherche. Au niveau module et non sur le nœud : le champ vit
 *  désormais dans la barre unifiée et survit aux rendus, mais il disparaît au changement d'écran —
 *  une minuterie accrochée à lui partirait alors avec lui, en laissant un rendu programmé. */
let bibSearchTimer: number | undefined;

export const bibDup: {
  groups: DupGroup[] | null;
  loading: boolean;
  shown: boolean;
  error: string | null;
} = {
  groups: null,
  loading: false,
  shown: false,
  error: null,
};

/// Lance le scan de doublons et repeint, quel que soit l'issue.
///
/// Existe pour supprimer une duplication qui avait deja diverge en pratique : `sift-live.ts`
/// portait DEUX copies de cette sequence (chip « doublons » et bouton dupscan), chacune avec son
/// `.catch` posant `groups = []` — donc chacune capable d'annoncer « aucun doublon » sur un scan
/// echoue. Un seul endroit, un seul comportement. Audit 2026-07-28, CC-1.
export function loadDuplicates(): void {
  bibDup.loading = true;
  bibDup.error = null;
  void renderBiblioLive();
  void scanLibraryDuplicates()
    .then((groups) => {
      bibDup.groups = groups;
      bibDup.error = null;
    })
    .catch((e: unknown) => {
      console.error("scan_library_duplicates failed", e);
      // `groups` reste a null : sans resultat, on ne pretend RIEN sur la bibliotheque.
      bibDup.groups = null;
      bibDup.error = humanizeScanError(e);
    })
    .finally(() => {
      bibDup.loading = false;
      void renderBiblioLive();
    });
}

/// Message court et actionnable a partir d'une erreur IPC brute. La chaine brute reste en
/// console.error ; l'ecran n'affiche jamais un `Error: ...` non traduit.
function humanizeScanError(e: unknown): string {
  const raw = String(e);
  if (raw.includes("db lock") || raw.includes("poisoned")) {
    return "La base est occupée. Réessaie dans un instant.";
  }
  return "Vérifie que la bibliothèque est accessible, puis réessaie.";
}

// Virtualized library list controller. Torn down and recreated on each full renderBiblioLive
// (which replaces #content.innerHTML, orphaning the old #biblist host — its scroll listener sits
// on the PERMANENT #content, so it must be explicitly destroyed or it leaks + double-renders).
// Private to this module — nothing outside renderBiblioLive touches it.
let bibVirtual: VirtualList | null = null;
// Which library row is open in the detail panel — stamped as `.cur` at row-creation time so the
// highlight survives virtualization. Private — only openBiblioDetail/renderBiblioLive touch it.
let bibOpenId: number | null = null;

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
      : bibDup.shown
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

/** Positions the Dossiers/Genres thumb from whichever button currently carries `.on`. Called both
 * right after a full rebuild (fresh node — just places it) and immediately on facet click before
 * renderBiblioLive()'s async IPC round-trip rebuilds everything — that's the call that actually
 * animates, same pattern as Journal's positionJournalThumb(). Exported: sift-live.ts's click
 * handler calls this directly for the instant pre-rebuild toggle. */
export function positionFacetThumb(): void {
  const seg = document.getElementById("sift-bib-facet-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-bib='facet'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Same thumb-glide pattern as positionFacetThumb(), for the Tableau/Grille segmented. */
export function positionViewModeThumb(): void {
  const seg = document.getElementById("sift-bib-viewmode-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-bib='viewmode'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Derniere ventilation par format de la bibliotheque, gardee entre deux rendus.
 *
 * `renderBiblioLive` se rejoue a chaque frappe de recherche, chaque facette et chaque tri, et il
 * ecrase `#content` a chaque fois. Or ce graphique decrit la bibliotheque ENTIERE, pas le
 * sous-ensemble filtre : le refaire a chaque touche couterait un aller-retour IPC pour un resultat
 * identique, et le ferait clignoter. On le relit donc au premier affichage de l ecran seulement,
 * et on redessine depuis cette valeur ensuite. */
let bibUsage: UsageReport | null = null;

/** Insere le graphique d occupation en tete de l ecran. `refetch` n est vrai qu au premier
 * affichage : ensuite on redessine depuis `bibUsage`, sans aller-retour. */
function mountBibUsage(content: HTMLElement, refetch: boolean): void {
  const anchor = content.querySelector(".sift-library-layout");
  if (!anchor) return;
  const slot = document.createElement("div");
  slot.id = "sift-bib-usage";
  slot.className = "sift-ui-card-soft sift-ui-card-soft-pad sift-bib-usage";
  content.insertBefore(slot, anchor);

  const draw = (report: UsageReport) => {
    slot.innerHTML = '<div class="sift-settings-title">Occupation par format</div>';
    slot.appendChild(renderUsageChart({ report }));
  };

  if (bibUsage && !refetch) {
    draw(bibUsage);
    return;
  }
  slot.innerHTML =
    '<div class="sift-settings-title">Occupation par format</div>' +
    '<div class="sift-usb-empty">Lecture…</div>';
  void libraryUsage()
    .then((r) => {
      bibUsage = r;
      draw(r);
    })
    .catch((e: unknown) => {
      // Impasse A19 (issue #15) : `slot.remove()` faisait disparaître la section, si bien que du
      // point de vue de l'utilisateur elle n'avait jamais existé — rien à réessayer, rien à
      // signaler. Le cas jumeau de Clé USB (`usb-view.ts::mountUsage`) garde son slot et affiche
      // la chaîne brute ; c'est ce modèle qu'on porte ici, plus une porte de sortie.
      slot.innerHTML =
        '<div class="sift-settings-title">Occupation par format</div>' +
        '<div class="sift-usb-empty">' +
        esc(humanizeError(e, "Occupation indisponible.", "libraryUsage")) +
        "<br>" +
        esc(String(e)) +
        "</div>" +
        '<div class="sift-settings-subactions"><button data-bib="retryusage" class="sift-settings-btn sift-settings-btn-quiet">Réessayer</button></div>';
      slot
        .querySelector<HTMLButtonElement>('[data-bib="retryusage"]')
        ?.addEventListener("click", () => {
          slot.remove();
          mountBibUsage(content, true);
        });
    });
}

/** Live Bibliothèque view: lists filed tracks with search + quality chips + folder/genre
 * facets, wired to real data. Actions go through the #pa delegated handler (data-bib). */
export async function renderBiblioLive() {
  const content = requireEl("#content", "renderBiblioLive");
  // Tear down any previous virtual list first: its scroll listener sits on the permanent #content,
  // which this render is about to overwrite — leaving it attached would leak the listener and fire
  // renders against a detached host.
  bibVirtual?.destroy();
  bibVirtual = null;
  // The IPC round-trip below (Promise.all) can take a beat on a large library — without a signal
  // the FIRST paint would sit frozen (blank #content, nothing rendered yet). Same "Chargement…"
  // pattern as queue-panel.ts's renderQueue(), gated the same way: only when there's no prior
  // Bibliothèque render already on screen. Without this gate, every subsequent renderBiblioLive()
  // call — search keystroke, facet/quality-chip click, table/grid toggle, sort change, dup scan —
  // would blank the whole panel (stats/facets/toolbar/list) before repainting, even though valid
  // data is already showing.
  const alreadyRendered = !!content.querySelector("#sift-bib-facet-seg");
  if (!alreadyRendered) {
    content.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 7px;color:var(--color-text-tertiary);font-size:var(--text-md)">' +
      '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md)"></i> Chargement…</div>';
  }
  let facets: LibraryFacets = { folders: [], genres: [], artists: [] };
  let stats: DashboardStats | null = null;
  try {
    [bibState.tracks, facets, stats] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
    ]);
  } catch (e) {
    // Impasse A20 (issue #15) : cette carte était la seule des trois sans porte de sortie — Écartés
    // (`ecartes-view.ts`) et le bloc doublons plus bas en ont une depuis leur audit respectif.
    // « réessaie » sans bouton demande à l'utilisateur de deviner comment.
    content.innerHTML =
      '<div class="sift-ui-card-soft sift-ui-card-soft-pad" style="color:var(--color-text-danger)">' +
      esc(
        humanizeError(
          e,
          "Impossible de charger la Bibliothèque. Vérifie la connexion à la base et réessaie.",
          "library load",
        ),
      ) +
      '<div style="margin-top:var(--space-8)"><button data-bib="retryload" style="font-size:var(--text-xs);color:var(--color-text-info)">Réessayer</button></div>' +
      "</div>";
    content
      .querySelector<HTMLButtonElement>('[data-bib="retryload"]')
      ?.addEventListener("click", () => void renderBiblioLive());
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
    `<button class="chip${bibDup.shown ? " on" : ""}" data-bib="dupscan">Doublons</button>`;

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
  // bibState.sort is shared across both view modes on purpose: the sortable column headers only
  // exist in Tableau, but Grille inheriting whatever order was last chosen there (instead of
  // reverting to an unrelated default the moment you switch) matches how table/grid toggles behave
  // elsewhere (e.g. Finder/Explorer icon view keeps the list view's sort). Accepted as-is — no
  // Grille-side sort control added; revisit only if that inherited-but-unchangeable order is
  // reported as confusing in practice.
  const sortedTracks = sortTracks(bibState.tracks, bibState.sort);
  const tableHead = bibState.viewMode === "table" ? libraryTableHeaderHtml(bibState.sort) : "";
  // Truly empty (no filed track at all, no filter narrowing it) vs. a filter that just matches
  // nothing right now — only the former is DESIGN.md's "État vide" dead-end with a back-to-Revue
  // link; the latter keeps the search/chips/facets on screen so the filter can be cleared.
  const noFilter =
    !bibState.filter.q &&
    !bibState.filter.quality &&
    !bibState.filter.folder &&
    !bibState.filter.genre &&
    !bibState.filter.artist;
  const trulyEmpty = bibState.tracks.length === 0 && noFilter;

  // L'état d'ERREUR passe avant tout le reste : tant qu'il est posé, on ne dit rien sur le
  // contenu de la bibliothèque. Dire « aucun doublon » après un scan qui a échoué serait
  // affirmer un fait qu'on n'a pas mesuré.
  const dupSection = !bibDup.shown
    ? ""
    : bibDup.loading
      ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Scan en cours (toute la bibliothèque)…</div>`
      : bibDup.error
        ? // Même forme que l'état d'erreur d'Écartés (ecartes-view.ts) : carte douce, texte
          // danger, bouton Réessayer discret. Réutilisé plutôt que réinventé, pour que les deux
          // écrans échouent de la même façon.
          `<div class="sift-ui-card-soft sift-ui-card-soft-pad" style="margin-top:10px;color:var(--color-text-danger)">` +
          `Le scan de doublons n'a pas abouti. ${esc(bibDup.error)}` +
          `<div style="margin-top:8px"><button data-bib="dupretry" style="font-size:var(--text-xs);padding:4px 10px;color:var(--color-text-info)">Réessayer</button></div>` +
          `</div>`
        : bibDup.groups === null
          ? ""
          : bibDup.groups.length === 0
            ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun doublon dans toute la bibliothèque.</div>`
            : `<div style="margin-top:10px"><div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:4px">Doublons détectés dans toute la bibliothèque (pas seulement la vue filtrée actuelle)</div>${bibDup.groups.map((g, i) => dupGroupHtml(g, i)).join("")}</div>`;

  // Export (Rekordbox/Clé USB) lives in the nav rail now, not here — matches the maquette's
  // persistent Export section (index.html nav-export items, wired in installLiveWiring below).
  // Retour Antoine 2026-07-09 : le toolbar (recherche+chips) était sa PROPRE boîte flottante
  // au-dessus du panneau — une seule information (le filtre courant), grouper ça seul ajoute du
  // chrome pour rien (même règle HIG Boxes que la consolidation Réglages, 2026-07-08). Intégré
  // maintenant comme bandeau supérieur du panneau .sift-library-main, séparé par un filet.
  // Étape 2 (DESIGN.md § 17) : filtres, mode de vue et recherche ont quitté le panneau pour la
  // barre unifiée. Ils n'appartenaient pas au contenu — ce sont des contrôles de la fenêtre, et
  // leur place change aujourd'hui d'un écran à l'autre. La recherche y gagne en plus de survivre
  // au rendu : dans `#content` elle était détruite par le rebuild `innerHTML` que sa PROPRE frappe
  // déclenchait, donc le focus tombait à chaque recherche (voir `toolbar.ts`).
  const barActionsHtml =
    chips +
    `<div class="sift-seg sift-seg-thumbed" id="sift-bib-viewmode-seg">` +
    `<div class="sift-seg-thumb"></div>` +
    `<button class="sift-seg-opt${bibState.viewMode === "table" ? " on" : ""}" data-bib="viewmode" data-mode="table" aria-label="Vue tableau"><i class="ti ti-list"></i></button>` +
    `<button class="sift-seg-opt${bibState.viewMode === "grid" ? " on" : ""}" data-bib="viewmode" data-mode="grid" aria-label="Vue grille"><i class="ti ti-layout-grid"></i></button></div>`;

  content.innerHTML = trulyEmpty
    ? emptyStateHtml({
        title: "Bibliothèque vide",
        note: "Les pistes que tu convertis depuis Revue apparaissent ici, prêtes à exporter vers Rekordbox ou une clé USB.",
        backToRevue: true,
      })
    : (stats ? statsCardsHtml(stats) : "") +
      `<div class="sift-library-layout"><div class="sift-library-side sift-ui-card-soft sift-ui-card-soft-pad"><div class="col-h">Bibliothèque</div>${side}</div>` +
      `<div class="sift-library-main sift-ui-card sift-ui-card-pad"><div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:var(--text-base);font-weight:500">${esc(activeFacetVal || "Tous")}</span><span style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${bibState.tracks.length} piste${bibState.tracks.length > 1 ? "s" : ""}</span></div>${tableHead}` +
      (rows ||
        `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun résultat pour ce filtre. <button data-bib="stat" data-stat="all" style="font-size:inherit;color:var(--color-text-info);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline">Réinitialiser les filtres</button></div>`) +
      dupSection +
      `</div></div>`;

  // Emplacement du graphique d occupation, rempli juste apres : `content.innerHTML` vient de tout
  // ecraser, donc rien ne survit d un rendu a l autre et il faut le remonter a chaque fois.
  if (!trulyEmpty) mountBibUsage(content, !alreadyRendered);
  wireEmptyState(content);
  positionFacetThumb(); // fresh node post-rebuild — no prior transform, just place it
  positionViewModeThumb();

  if (trulyEmpty) {
    // Bibliothèque vide : pas de filtre à offrir, donc rien dans la barre. C'est une impasse
    // assumée (DESIGN.md § 8) — le rail et le titre restent, les contrôles non.
    mountBarActions("");
    return;
  }

  mountBarActions(barActionsHtml);
  positionViewModeThumb(); // le nœud vient d'être (re)créé dans la barre — le placer après montage

  // La recherche est le seul contrôle frappé pendant que son écran se re-rend : `mountBarSearch`
  // réutilise le champ existant et ne pousse la valeur que si elle diffère, sinon le curseur
  // sauterait en fin de champ à chaque re-rendu. Le voile d'attente se pose sur l'enveloppe plutôt
  // que par un nœud ajouté-retiré : un nœud créé à chaque frappe est exactement ce que la règle
  // « créer une fois, muter ensuite » interdit.
  const searchInput = mountBarSearch({
    placeholder: "Rechercher…",
    ariaLabel: "Rechercher dans la bibliothèque",
    value: bibState.filter.q ?? "",
    onInput: (value) => {
      bibState.filter.q = value || undefined;
      clearTimeout(bibSearchTimer);
      document.querySelector(".sift-bar-search")?.classList.add("sift-bar-search--pending");
      bibSearchTimer = window.setTimeout(() => void renderBiblioLive(), 250);
    },
  });
  if (searchInput) document.querySelector(".sift-bar-search")?.classList.remove("sift-bar-search--pending");

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
export function openBiblioDetail(id: number): void {
  const t = bibState.tracks.find((x) => x.id === id);
  // Zone D du shell depuis l'étape 3, plus `#bibplayer` en fin de liste. Le détail y était rendu
  // APRÈS la table et après la section doublons : ouvrir une piste au rang 300 poussait son propre
  // détail hors de l'écran, et il fallait faire défiler pour voir ce qu'on venait d'ouvrir.
  const host = openAside();
  if (!host) return;
  if (!t) {
    closeAside();
    return;
  }
  if (bibOpenId === id) {
    bibOpenId = null;
    document.querySelectorAll(".lr.cur").forEach((n) => n.classList.remove("cur"));
    closeAside(); // vider sans refermer laisserait une colonne vide occuper --pane-w
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
      closeAside();
    },
  );
}
