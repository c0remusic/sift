// Bibliothèque list rendering: table rows/header (sortable) and grid tiles (cover art),
// both consumed by sift-live.ts's virtualized #biblist mount. Kept separate from
// library-detail.ts (the open-track editor) and sift-live.ts (screen orchestration) —
// this file owns only "how one row/tile of the filed-track list looks".
import type { LibraryTrack } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { esc } from "./dom";
import { libraryColumns, columnStyle, type LibraryColumn, type LibraryColumnField } from "./library-columns";

function qualPill(t: LibraryTrack): string {
  const f = (t.format || "?").toUpperCase();
  return `<span class="pill" style="flex:none">${esc(f)}</span>`;
}

function verdictBadge(v: string | null): string {
  if (v === "fake")
    return `<span class="pill" style="background:var(--color-background-danger);color:var(--color-text-danger);flex:none">fake</span>`;
  if (v === "grey")
    return `<span class="pill" style="background:var(--color-background-warning);color:var(--color-text-warning);flex:none">?</span>`;
  return "";
}

/** Display name for a library row (artist — title, else filename). */
export function bibName(t: LibraryTrack): string {
  return t.artist && t.title ? `${t.artist} — ${t.title}` : t.path.split(/[\\/]/).pop() || t.path;
}

// Le champ de tri EST le champ de colonne : toutes les colonnes sont triables (`DESIGN.md` § 16),
// donc deux listes séparées ne pourraient que diverger. L'alias garde le nom que le reste du code
// emploie déjà.
type LibrarySortField = LibraryColumnField;
export type LibrarySortState = { field: LibrarySortField; dir: "asc" | "desc" };

/** Client-side sort — the filed-track list is small enough (a personal DJ crate, not a
 * streaming catalogue) that a SQL ORDER BY parameter isn't worth the added query surface. */
export function sortTracks(tracks: readonly LibraryTrack[], sort: LibrarySortState): LibraryTrack[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const sorted = [...tracks];
  sorted.sort((a, b) => {
    // Les trois champs NUMÉRIQUES se comparent en nombres, pas en chaînes : un tri lexical
    // classerait un BPM de 100 avant 92, et une durée de 7:48 avant 12:03. `-Infinity` place les
    // valeurs manquantes en tête en ascendant, donc en queue en descendant — c'est le bon défaut
    // pour un DJ qui trie par tempo : ce qui n'a pas de BPM est ce qu'il reste à analyser.
    if (sort.field === "year" || sort.field === "bpm" || sort.field === "duration") {
      const av = a[sort.field] ?? -Infinity,
        bv = b[sort.field] ?? -Infinity;
      return (av - bv) * mul;
    }
    const av = sort.field === "genre" ? (a.genres[0] ?? "") : (a[sort.field] ?? "");
    const bv = sort.field === "genre" ? (b.genres[0] ?? "") : (b[sort.field] ?? "");
    return av.localeCompare(bv) * mul;
  });
  return sorted;
}

// Les colonnes, leur ordre et leurs largeurs vivent dans `library-columns.ts` depuis le 2026-08-19 :
// elles sont devenues un ÉTAT (réordonnable, redimensionnable, mémorisé), et un état ne se déclare
// pas dans le module qui le peint.
//
// BPM et Durée sont des AJOUTS du 2026-08-19, et ce sont les deux plus importants. Les deux champs
// existent depuis toujours dans le contrat (`shared/contracts.ts`, `bpm` et `duration`) et
// n'atteignaient pas l'écran : la table triait sur Artiste, Titre, Genre, Année. Un DJ trie sa
// bibliothèque par tempo.
//
// Ni tonalité ni énergie : vérifié le 2026-08-19, aucun des deux n'existe dans `contracts.ts` ni
// dans `db.rs`. Aucune colonne fantôme n'est déclarée pour du vide — les ajouter est un chantier
// d'analyse Rust, pas une décision de design.

/** `mm:ss` — jamais `Intl.NumberFormat`, qui rendrait une durée comme un nombre. Une valeur
 *  absente rend un tiret cadratin, pas « 0:00 » : zéro seconde est un fait, l'absence en est un
 *  autre, et les confondre ferait croire à un fichier vide. */
function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** BPM entier. Le backend en rend un flottant ; afficher « 121,97 » dans une colonne de 44px
 *  n'aide personne à mixer, et un DJ raisonne au BPM entier. */
function fmtBpm(bpm: number | null): string {
  return bpm == null || !Number.isFinite(bpm) ? "—" : String(Math.round(bpm));
}

/** Contenu texte d'une cellule, par champ. Les six branches sont exhaustives sur
 *  `LibraryColumnField` : ajouter une colonne sans son rendu casse la compilation, ce qui est le
 *  seul moment où l'oubli est rattrapable — une cellule vide, elle, se lit comme une donnée absente. */
function cellText(field: LibraryColumnField, t: LibraryTrack): string {
  switch (field) {
    case "artist":
      return esc(t.artist || "—");
    case "title":
      return esc(t.title || "—");
    case "bpm":
      return fmtBpm(t.bpm);
    case "duration":
      return fmtDuration(t.duration);
    case "genre":
      return esc(t.genres[0] || "—");
    case "year":
      return esc(t.year ? String(t.year) : "—");
  }
}

/** Une cellule. `data-col` est le crochet que `paintColumnWidth` mute pendant un redimensionnement —
 *  c'est lui qui permet d'écrire une largeur sur les lignes déjà montées sans re-rendre la liste. */
function cellHtml(col: LibraryColumn, t: LibraryTrack): string {
  return `<span class="sift-lib-col ${col.cls}" data-col="${col.field}"${columnStyle(col)}>${cellText(col.field, t)}</span>`;
}

/** Sortable column header row — each header is a real <button> (native keyboard support),
 * aria-sort on the active column announces direction to screen readers.
 *
 * Chaque en-tête porte aussi, depuis le 2026-08-19, les deux gestes de `library-columns.ts` : il est
 * la POIGNÉE de déplacement de sa colonne, et il se termine par un séparateur de redimensionnement.
 * Les deux cohabitent avec le clic de tri par un seuil de déplacement — voir `DRAG_THRESHOLD`. */
export function libraryTableHeaderHtml(sort: LibrarySortState): string {
  const cells = libraryColumns().map((col) => {
    const { field, label, cls } = col;
    const active = sort.field === field;
    const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    const arrow = active ? (sort.dir === "asc" ? " ▴" : " ▾") : "";
    // `<span role="columnheader">` et NON `<th>`. Mesure du 2026-08-19 dans la vraie fenêtre : la
    // ligne d'en-tête est un `<div>`, pas un `<table>`, et le parseur HTML SUPPRIME un `<th>` hors
    // contexte de table — il ne gardait que le `<button>` à l'intérieur. La classe de largeur et
    // l'`aria-sort` partaient donc avec la balise : les colonnes ne s'alignaient pas sur celles de
    // la ligne, et la direction de tri n'était annoncée à personne. Le défaut était antérieur à
    // l'ajout de BPM et Durée ; il ne se voyait pas tant que l'en-tête n'avait aucune largeur à
    // porter.
    return (
      `<span class="${cls} sift-lib-colhead" role="columnheader" aria-sort="${ariaSort}"` +
      ` data-colhead="${field}" data-col="${field}"${columnStyle(col)}>` +
      `<button data-bib="sort" data-field="${field}">${esc(label)}${arrow}</button>` +
      // Le séparateur est un enfant de l'en-tête, pas un frère : il doit rester collé au bord droit
      // de SA colonne quand celle-ci change de largeur ou de place, et un frère se serait décalé.
      `<span class="sift-lib-colsep" data-for="${field}" aria-hidden="true"></span>` +
      `</span>`
    );
  }).join("");
  // No wrapping role="table"/"grid" exists (this is a flex layout, not a real <table>) — role="row"
  // here without that ancestor was a half-applied ARIA table pattern a screen reader can't make
  // sense of. Dropped; each data row instead carries a composite aria-label (see libraryTableRowHtml).
  // Deux espaceurs, pas un. La ligne porte des affordances AVANT ses colonnes (bouton lecture,
  // pochette) et APRÈS (pastille de qualité, lien Discogs) ; sans un espaceur de chaque côté,
  // l'en-tête flotte décalé au-dessus des colonnes qu'il nomme. Mesuré : 62px devant, 69 derrière.
  return (
    `<div class="sift-lib-thead" role="row"><span class="sift-lib-thead-cov"></span>${cells}` +
    `<span class="sift-lib-thead-tail" aria-hidden="true"></span></div>`
  );
}

/** One table row — cover thumbnail + the 4 sortable columns + the existing play/quality/verdict/
 * Discogs affordances (unchanged from the pre-table single-line row, just no longer squeezed into
 * one "artist — title" string). No duration column (explicit decision, see the design spec). */
export function libraryTableRowHtml(t: LibraryTrack, curId: number | null, selected = false): string {
  const cur = (t.id === curId ? " cur" : "") + (selected ? " sel" : "");
  const cov = t.cover_path
    ? `<img src="${esc(convertFileSrc(t.cover_path))}" alt="" class="sift-lib-cov">`
    : `<i class="ti ti-vinyl sift-lib-cov-fallback"></i>`;
  const link = t.discogs_release_id
    ? `<button class="lk-icon" data-bib="link" data-rid="${esc(t.discogs_release_id)}" aria-label="Page Discogs"><i class="ti ti-external-link" style="font-size:var(--text-base);color:var(--color-text-tertiary)"></i></button>`
    : `<button class="lk-icon" data-bib="identify" data-id="${t.id}" aria-label="Identifier"><i class="ti ti-search" style="font-size:var(--text-md);color:var(--color-text-tertiary)"></i></button>`;
  // Composite name so a screen reader announces the 4 sortable columns for this row instead of
  // just "button" — role="button" alone loses the artist/title/genre/year association a table
  // reading mode would otherwise give.
  const rowLabel = `${t.artist || "Artiste inconnu"} — ${t.title || "Titre inconnu"}, ${fmtBpm(t.bpm)} BPM, ${fmtDuration(t.duration)}, ${t.genres[0] || "genre inconnu"}, ${t.year != null ? t.year : "année inconnue"}`;
  return (
    `<div class="lr${cur}" data-bib="row" data-id="${t.id}" tabindex="0" role="option" aria-selected="${selected}" aria-label="${esc(rowLabel)}">` +
    `<button class="pb" data-bib="play" data-id="${t.id}" aria-label="Écouter"><i class="ti ti-player-play" style="font-size:var(--text-md)"></i></button>` +
    cov +
    libraryColumns().map((col) => cellHtml(col, t)).join("") +
    verdictBadge(t.verdict) +
    qualPill(t) +
    link +
    `</div>`
  );
}

export const LIBRARY_TABLE_PROBE_HTML =
  `<div class="lr"><button class="pb"><i class="ti ti-player-play" style="font-size:var(--text-md)"></i></button>` +
  `<i class="ti ti-vinyl sift-lib-cov-fallback"></i><span class="sift-lib-col">probe</span></div>`;

/** How many tiles sit in one virtualized "row" — the grid is chunked into rows of this many
 * tiles so createVirtualList (one fixed-height row at a time) can still window a cover grid
 * without rendering thousands of DOM nodes at once (see docs/design-system-states.md, the
 * 7000+-track freeze this codebase already hit once with an unvirtualized queue). */
export const LIBRARY_GRID_TILES_PER_ROW = 4;

function libraryGridTileHtml(t: LibraryTrack, curId: number | null): string {
  const cur = t.id === curId ? " cur" : "";
  const cov = t.cover_path
    ? `<img src="${esc(convertFileSrc(t.cover_path))}" alt="" class="sift-lib-tile-cov">`
    : `<i class="ti ti-vinyl sift-lib-tile-cov-fallback"></i>`;
  // Composite name, same reason as libraryTableRowHtml's rowLabel: role="button" alone announces
  // just "button" and the two text lines the tile paints are lost. One rule throughout: the name
  // says what the tile actually paints, nothing more. Hence NOT the row's 4-column label (a tile
  // shows no genre/year, naming them would announce what the sighted user can't see there); hence
  // also no "Artiste inconnu" segment — when t.artist is empty the .sift-lib-tile-sub line below
  // is painted EMPTY, unlike libraryTableRowHtml which paints an explicit "—" that "Artiste
  // inconnu" honestly stands for. The title slot reuses the tile's own bibName() fallback so an
  // untitled track is named by what's actually painted rather than by "Titre inconnu".
  const tileLabel = t.artist ? `${t.artist} — ${t.title || bibName(t)}` : t.title || bibName(t);
  return (
    `<div class="sift-lib-tile${cur}" data-bib="tile" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(tileLabel)}">` +
    cov +
    `<div class="sift-lib-tile-title">${esc(t.title || bibName(t))}</div>` +
    `<div class="sift-lib-tile-sub">${esc(t.artist || "")}</div>` +
    `</div>`
  );
}

/** One virtualized grid "row" = up to LIBRARY_GRID_TILES_PER_ROW tiles side by side. */
export function libraryGridRowHtml(rowTracks: readonly LibraryTrack[]): string {
  return `<div class="sift-lib-grid-row">${rowTracks.map((t) => libraryGridTileHtml(t, null)).join("")}</div>`;
}

export const LIBRARY_GRID_PROBE_HTML =
  `<div class="sift-lib-grid-row"><div class="sift-lib-tile"><i class="ti ti-vinyl sift-lib-tile-cov-fallback"></i><div class="sift-lib-tile-title">probe</div><div class="sift-lib-tile-sub">probe</div></div></div>`;
