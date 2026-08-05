// Bibliothèque list rendering: table rows/header (sortable) and grid tiles (cover art),
// both consumed by sift-live.ts's virtualized #biblist mount. Kept separate from
// library-detail.ts (the open-track editor) and sift-live.ts (screen orchestration) —
// this file owns only "how one row/tile of the filed-track list looks".
import type { LibraryTrack } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { esc } from "./dom";

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

type LibrarySortField = "artist" | "title" | "genre" | "year";
export type LibrarySortState = { field: LibrarySortField; dir: "asc" | "desc" };

/** Client-side sort — the filed-track list is small enough (a personal DJ crate, not a
 * streaming catalogue) that a SQL ORDER BY parameter isn't worth the added query surface. */
export function sortTracks(tracks: readonly LibraryTrack[], sort: LibrarySortState): LibraryTrack[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  const sorted = [...tracks];
  sorted.sort((a, b) => {
    if (sort.field === "year") {
      const av = a.year ?? -Infinity,
        bv = b.year ?? -Infinity;
      return (av - bv) * mul;
    }
    const av = sort.field === "genre" ? (a.genres[0] ?? "") : (a[sort.field] ?? "");
    const bv = sort.field === "genre" ? (b.genres[0] ?? "") : (b[sort.field] ?? "");
    return av.localeCompare(bv) * mul;
  });
  return sorted;
}

const SORT_COLUMNS: { field: LibrarySortField; label: string }[] = [
  { field: "artist", label: "Artiste" },
  { field: "title", label: "Titre" },
  { field: "genre", label: "Genre" },
  { field: "year", label: "Année" },
];

/** Sortable column header row — each header is a real <button> (native keyboard support),
 * aria-sort on the active column announces direction to screen readers. */
export function libraryTableHeaderHtml(sort: LibrarySortState): string {
  const cells = SORT_COLUMNS.map(({ field, label }) => {
    const active = sort.field === field;
    const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
    const arrow = active ? (sort.dir === "asc" ? " ▴" : " ▾") : "";
    return `<th aria-sort="${ariaSort}"><button data-bib="sort" data-field="${field}">${esc(label)}${arrow}</button></th>`;
  }).join("");
  // No wrapping role="table"/"grid" exists (this is a flex layout, not a real <table>) — role="row"
  // here without that ancestor was a half-applied ARIA table pattern a screen reader can't make
  // sense of. Dropped; each data row instead carries a composite aria-label (see libraryTableRowHtml).
  return `<div class="sift-lib-thead"><span class="sift-lib-thead-cov"></span>${cells}</div>`;
}

/** One table row — cover thumbnail + the 4 sortable columns + the existing play/quality/verdict/
 * Discogs affordances (unchanged from the pre-table single-line row, just no longer squeezed into
 * one "artist — title" string). No duration column (explicit decision, see the design spec). */
export function libraryTableRowHtml(t: LibraryTrack, curId: number | null): string {
  const cur = t.id === curId ? " cur" : "";
  const cov = t.cover_path
    ? `<img src="${esc(convertFileSrc(t.cover_path))}" alt="" class="sift-lib-cov">`
    : `<i class="ti ti-vinyl sift-lib-cov-fallback"></i>`;
  const link = t.discogs_release_id
    ? `<button class="lk-icon" data-bib="link" data-rid="${esc(t.discogs_release_id)}" aria-label="Page Discogs"><i class="ti ti-external-link" style="font-size:var(--text-base);color:var(--color-text-tertiary)"></i></button>`
    : `<button class="lk-icon" data-bib="identify" data-id="${t.id}" aria-label="Identifier"><i class="ti ti-search" style="font-size:var(--text-md);color:var(--color-text-tertiary)"></i></button>`;
  // Composite name so a screen reader announces the 4 sortable columns for this row instead of
  // just "button" — role="button" alone loses the artist/title/genre/year association a table
  // reading mode would otherwise give.
  const rowLabel = `${t.artist || "Artiste inconnu"} — ${t.title || "Titre inconnu"}, ${t.genres[0] || "genre inconnu"}, ${t.year != null ? t.year : "année inconnue"}`;
  return (
    `<div class="lr${cur}" data-bib="row" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(rowLabel)}">` +
    `<button class="pb" data-bib="play" data-id="${t.id}" aria-label="Écouter"><i class="ti ti-player-play" style="font-size:var(--text-md)"></i></button>` +
    cov +
    `<span class="sift-lib-col" style="flex:1.4">${esc(t.artist || "—")}</span>` +
    `<span class="sift-lib-col" style="flex:1.4">${esc(t.title || "—")}</span>` +
    `<span class="sift-lib-col" style="flex:1">${esc(t.genres[0] || "—")}</span>` +
    `<span class="sift-lib-col" style="flex:0.6">${esc(t.year ? String(t.year) : "—")}</span>` +
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
