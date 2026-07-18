# Bibliothèque : vue tableau + grille pochettes + arbre Artistes — Implementation Plan

> **Statut (2026-07-09) : LIVRÉ.** Les 8 tâches sont commitées sur `m6a-discogs`
> (`f0c700f`, `bcd77ed`, `0b3d36e`, `f9551cb`, `acc5f09`, `61ac35c`, `b3c58f7`) ;
> checkboxes cochées après coup (le suivi n'avait pas été tenu pendant
> l'exécution initiale). Task 8 re-vérifiée : `cargo test` 329✓, `clippy`
> clean, rendu confirmé sur données réelles (facette Artistes, tri, table+
> grille). Anomalie séparée notée hors scope : la Bibliothèque affiche
> parfois "vide" en session live malgré des pistes `filed` en DB — non
> attribuable au code de ce plan, à creuser séparément si elle se reproduit.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Bibliothèque screen a sortable multi-column table view and a cover-art grid view (toggle between them), plus a 3rd sidebar facet ("Artistes") alongside the existing Dossiers/Genres.

**Architecture:** Backend gains one new facet query (`artists`, mirrors the existing `genres` query) and one new filter field (`artist`, mirrors `genre`). All display logic — table row/header rendering, grid tile rendering, client-side sort — moves into a new frontend module `frontend/library-views.ts`, which `sift-live.ts`'s `renderBiblioLive()` calls into instead of building rows inline. Both view modes stay virtualized (`createVirtualList`) to avoid reintroducing the large-library freeze (see `docs/design-system-states.md`, "Front — événements répétés").

**Tech Stack:** Rust (`rusqlite`), vanilla TypeScript, existing `.sift-seg`/`.sift-ui-card` design-system components — no new dependencies.

## Global Constraints

- No `duration` column in the table view (explicit user decision).
- No "Album" tree level — facet is Artiste → Pistes only (schema has no album field; see spec's "Différé" section).
- No Discogs image fetching in this plan — artist rows show no avatar (separate future plan).
- Sort is **client-side** — no SQL `ORDER BY` parameter added to the backend.
- Tokens only (`--color-*`/`--text-*`/`--space-*`/`--border-radius-*`) — no literal colors/sizes in new CSS, per `CLAUDE.md` Front conventions.
- Every new clickable row/tile needs `tabindex="0"` + `role="button"`, wired through `chrome.ts`'s `installNavKeyboard()` (existing convention, see `docs/design-system-states.md` "Écran Bibliothèque — audit référence canonique").

---

### Task 1: Backend — `artists` facet

**Files:**
- Modify: `src-tauri/src/library.rs:60-63` (`LibraryFacets` struct), `src-tauri/src/library.rs:288-302` (`folder_facets`)
- Test: `src-tauri/src/library.rs` (inline `#[cfg(test)]` module, same file)

**Interfaces:**
- Produces: `LibraryFacets.artists: Vec<LibraryFolder>` (same `LibraryFolder { name, count }` type already used by `folders`/`genres`).

- [x] **Step 1: Write the failing test**

Add next to `folder_facets_counts_filed_by_folder_and_genre` (`library.rs:609`):

```rust
#[test]
fn folder_facets_counts_filed_by_artist() {
    let conn = db();
    for (id, artist) in [(1, "Aya"), (2, "Aya"), (3, "Rob & Si")] {
        conn.execute(
            "INSERT INTO tracks(id, path, status) VALUES(?1, ?2, 'filed')",
            rusqlite::params![id, format!("/lib/{id}.aiff")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO metadata(track_id, artist) VALUES(?1, ?2)",
            rusqlite::params![id, artist],
        )
        .unwrap();
    }
    // A pending (non-filed) track with an artist must NOT be counted.
    conn.execute("INSERT INTO tracks(id, path, status) VALUES(4, '/lib/4.aiff', 'pending')", []).unwrap();
    conn.execute("INSERT INTO metadata(track_id, artist) VALUES(4, 'Aya')", []).unwrap();

    let facets = folder_facets(&conn).unwrap();
    assert_eq!(
        facets.artists,
        vec![
            LibraryFolder { name: "Aya".into(), count: 2 },
            LibraryFolder { name: "Rob & Si".into(), count: 1 },
        ]
    );
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml folder_facets_counts_filed_by_artist -- --nocapture`
Expected: FAIL — `no field 'artists' on type 'LibraryFacets'`

- [x] **Step 3: Implement**

`library.rs:60-63`, add the field:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFacets {
    pub folders: Vec<LibraryFolder>,
    pub genres: Vec<LibraryFolder>,
    pub artists: Vec<LibraryFolder>,
}
```

`library.rs:288-302`, add the query and field (same `query_facets` helper, same shape as `genres`):

```rust
pub fn folder_facets(conn: &rusqlite::Connection) -> rusqlite::Result<LibraryFacets> {
    let folders = query_facets(
        conn,
        "SELECT folder, COUNT(*) FROM tracks \
         WHERE status='filed' AND folder IS NOT NULL AND folder <> '' \
         GROUP BY folder ORDER BY folder",
    )?;
    let genres = query_facets(
        conn,
        "SELECT g.genre, COUNT(*) FROM track_genres g \
         JOIN tracks t ON t.id = g.track_id AND t.status='filed' \
         GROUP BY g.genre ORDER BY g.genre",
    )?;
    let artists = query_facets(
        conn,
        "SELECT m.artist, COUNT(*) FROM metadata m \
         JOIN tracks t ON t.id = m.track_id AND t.status='filed' \
         WHERE m.artist IS NOT NULL AND m.artist <> '' \
         GROUP BY m.artist ORDER BY m.artist",
    )?;
    Ok(LibraryFacets { folders, genres, artists })
}
```

Every other construction site of `LibraryFacets` (test fixtures elsewhere in the file, if any) will now fail to compile until Task updates them — check with:

Run: `grep -n "LibraryFacets {" src-tauri/src/library.rs src-tauri/src/ipc_library.rs`

If any literal construction is missing `artists:`, add `artists: vec![]` there (test-only fixtures) — do not change production call sites, `folder_facets` is the only producer.

- [x] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml folder_facets -- --nocapture`
Expected: PASS (both the new test and the existing `folder_facets_counts_filed_by_folder_and_genre`)

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/library.rs
git commit -m "feat(library): add artists facet to folder_facets"
```

---

### Task 2: Backend — `artist` filter

**Files:**
- Modify: `src-tauri/src/library.rs:38-49` (`LibraryFilter`), `src-tauri/src/library.rs:188-` (`list_filed`)
- Test: `src-tauri/src/library.rs` (inline)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LibraryFilter.artist: Option<String>`.

- [x] **Step 1: Write the failing test**

Add next to the existing `list_filed_filters_by_verdict` test (`library.rs:590`):

```rust
#[test]
fn list_filed_filters_by_artist() {
    let conn = db();
    conn.execute("INSERT INTO tracks(id, path, status) VALUES(1, '/lib/a.mp3', 'filed')", []).unwrap();
    conn.execute("INSERT INTO metadata(track_id, artist) VALUES(1, 'Aya')", []).unwrap();
    conn.execute("INSERT INTO tracks(id, path, status) VALUES(2, '/lib/b.mp3', 'filed')", []).unwrap();
    conn.execute("INSERT INTO metadata(track_id, artist) VALUES(2, 'Rob & Si')", []).unwrap();

    let f = LibraryFilter { artist: Some("Aya".into()), ..Default::default() };
    let tracks = list_filed(&conn, &f).unwrap();
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].artist.as_deref(), Some("Aya"));
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_filed_filters_by_artist -- --nocapture`
Expected: FAIL — `no field 'artist' on type 'LibraryFilter'`

- [x] **Step 3: Implement**

`library.rs:38-49`:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryFilter {
    pub folder: Option<String>,
    pub quality: Option<String>,
    pub genre: Option<String>,
    pub q: Option<String>,
    pub verdict: Option<String>,
    /// Restrict by artist (exact match on `metadata.artist`).
    pub artist: Option<String>,
}
```

In `list_filed` (`library.rs:188` onward), find the block that appends `" AND t.folder = :folder"` etc. and add the mirror branch, same pattern:

```rust
if f.artist.is_some() {
    sql.push_str(" AND m.artist = :artist");
}
```

then, in the same function's parameter-binding section (where `:folder`/`:genre` are bound to `f.folder`/`f.genre`), add:

```rust
if let Some(artist) = &f.artist {
    params.push((":artist", artist as &dyn rusqlite::ToSql));
}
```

(Match the exact binding style already used for `:genre` in this function — read the surrounding 20 lines before editing, since the existing code may use `named_params!` or a manual `Vec` push; mirror whichever pattern `:folder`/`:genre` already use rather than introducing a second style.)

- [x] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_filed -- --nocapture`
Expected: PASS (all `list_filed_*` tests, including the new one)

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/library.rs
git commit -m "feat(library): add artist filter to list_filed"
```

---

### Task 3: Mirror types in `shared/contracts.ts`

**Files:**
- Modify: `shared/contracts.ts:236-244`

**Interfaces:**
- Consumes: Task 1's `LibraryFacets.artists`, Task 2's `LibraryFilter.artist`.
- Produces: TS types used by Task 5/6/7.

- [x] **Step 1: Update the interfaces**

```typescript
export interface LibraryFolder { name: string; count: number; }
export interface LibraryFacets { folders: LibraryFolder[]; genres: LibraryFolder[]; artists: LibraryFolder[]; }

export interface LibraryFilter {
  folder?: string | null;
  quality?: "lossless" | "mp3" | null;
  genre?: string | null;
  q?: string | null;
  verdict?: "fake" | null;
  artist?: string | null;
}
```

(Keep whatever trailing fields already exist after `verdict` in the real file — insert `artist` in the same position as the Rust struct, don't reorder existing ones.)

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (any pre-existing unrelated errors are out of scope — if the command was clean before this change, it must stay clean)

- [x] **Step 3: Commit**

```bash
git add shared/contracts.ts
git commit -m "feat(contracts): mirror artists facet + artist filter"
```

---

### Task 4: Keyboard support for grid tiles

**Files:**
- Modify: `frontend/chrome.ts:225-227` (`installNavKeyboard`)

**Interfaces:**
- Consumes: nothing new yet — this selector addition is inert until Task 6 emits `data-bib="tile"` elements.
- Produces: keyboard Enter/Space activation for any element matching `[data-bib="tile"][tabindex]`.

- [x] **Step 1: Edit the selector**

`chrome.ts:225-227`, add `,[data-bib="tile"][tabindex]` to the existing selector list:

```typescript
const el = target?.closest<HTMLElement>(
  '[data-view][tabindex],[data-sift="homerow"][tabindex],[data-fil="bin"][tabindex],[data-bib="pick"][tabindex],[data-bib="row"][tabindex],[data-sift="mdbpick"][tabindex],[data-bib="tile"][tabindex]',
);
```

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (this is a string literal change only)

- [x] **Step 3: Commit**

```bash
git add frontend/chrome.ts
git commit -m "feat(a11y): extend nav-keyboard to library grid tiles"
```

---

### Task 5: New module `frontend/library-views.ts`

**Files:**
- Create: `frontend/library-views.ts`
- Modify: `frontend/sift-live.ts` (delete `fmtDur`/`qualPill`/`verdictBadge`/`bibName`/`biblioRowHtml` at their current locations — lines 1628-1644 and 2139-2156 — replaced by imports from the new module)

**Interfaces:**
- Consumes: `LibraryTrack` (from `shared/contracts.ts`).
- Produces (used by Task 6):
  - `export function fmtDur(sec: number | null): string`
  - `export function qualPill(t: LibraryTrack): string`
  - `export function verdictBadge(v: string | null): string`
  - `export function bibName(t: LibraryTrack): string`
  - `export type LibrarySortField = "artist" | "title" | "genre" | "year";`
  - `export type LibrarySortState = { field: LibrarySortField; dir: "asc" | "desc" };`
  - `export function sortTracks(tracks: readonly LibraryTrack[], sort: LibrarySortState): LibraryTrack[]`
  - `export function libraryTableHeaderHtml(sort: LibrarySortState): string`
  - `export function libraryTableRowHtml(t: LibraryTrack, curId: number | null): string`
  - `export const LIBRARY_GRID_TILES_PER_ROW = 4;`
  - `export function libraryGridRowHtml(rowTracks: readonly LibraryTrack[]): string`
  - `export const LIBRARY_TABLE_PROBE_HTML: string`
  - `export const LIBRARY_GRID_PROBE_HTML: string`

- [x] **Step 1: Create the file with escaping + moved helpers**

```typescript
// Bibliothèque list rendering: table rows/header (sortable) and grid tiles (cover art),
// both consumed by sift-live.ts's virtualized #biblist mount. Kept separate from
// library-detail.ts (the open-track editor) and sift-live.ts (screen orchestration) —
// this file owns only "how one row/tile of the filed-track list looks".
import type { LibraryTrack } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

export function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60),
    s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function qualPill(t: LibraryTrack): string {
  const f = (t.format || "?").toUpperCase();
  return `<span class="pill" style="flex:none">${esc(f)}</span>`;
}

export function verdictBadge(v: string | null): string {
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
```

- [x] **Step 2: Add sort**

```typescript
export type LibrarySortField = "artist" | "title" | "genre" | "year";
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
```

- [x] **Step 3: Add the table header + row builders**

```typescript
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
  return `<div class="sift-lib-thead" role="row"><span class="sift-lib-thead-cov"></span>${cells}</div>`;
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
  return (
    `<div class="lr${cur}" data-bib="row" data-id="${t.id}" tabindex="0" role="button">` +
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
```

- [x] **Step 4: Add the grid tile builder**

```typescript
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
  return (
    `<div class="sift-lib-tile${cur}" data-bib="tile" data-id="${t.id}" tabindex="0" role="button">` +
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
```

Note: `libraryGridRowHtml` deliberately does not thread `curId` through (the grid's "currently open" highlight is a v2 nicety, not required by the spec — the table view already carries `.cur`, which is the primary/default mode).

- [x] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `sift-live.ts` (duplicate `fmtDur`/`qualPill`/`verdictBadge`/`bibName`/`biblioRowHtml` — resolved in Task 6). No errors in `library-views.ts` itself.

- [x] **Step 6: Commit**

```bash
git add frontend/library-views.ts
git commit -m "feat(library): add library-views module (table + grid row rendering)"
```

---

### Task 6: Wire the view-mode toggle + sort into `sift-live.ts`

**Files:**
- Modify: `frontend/sift-live.ts`
  - Imports (near the top, alongside the existing `listLibrary`/`libraryFolders` import block)
  - `bibState` declaration (line 390)
  - `renderBiblioLive()` (lines 2007-2137) — replace inline row rendering with the new module, add the view-mode segmented, wire up sort clicks
  - `positionFacetThumb()` area (line 1996) — add a twin `positionViewModeThumb()`
  - Delegated click handler (`data-bib`, starting line 2288) — add `"sort"` and `"viewmode"` actions
  - Delete `fmtDur`/`qualPill`/`verdictBadge` (1628-1644) and `bibName`/`biblioRowHtml` (2139-2156) — now imported from `library-views.ts`

**Interfaces:**
- Consumes: everything exported by Task 5's `library-views.ts`; `LibraryFacets.artists`/`LibraryFilter.artist` from Task 1-3.
- Produces: nothing new externally — this is the integration task.

- [x] **Step 1: Update imports**

Add to the import block that already pulls in `listLibrary`, `libraryFolders`, etc.:

```typescript
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
```

- [x] **Step 2: Delete the moved helpers**

Delete `fmtDur`/`qualPill`/`verdictBadge` at `sift-live.ts:1628-1644` and `bibName`/`biblioRowHtml` at `sift-live.ts:2139-2156` in full (all 5 functions) — they now come from the import in Step 1.

- [x] **Step 3: Extend `bibState`**

Replace the `bibState` declaration (`sift-live.ts:390`):

```typescript
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
```

- [x] **Step 4: Add the view-mode thumb positioner**

Next to `positionFacetThumb()` (`sift-live.ts:1996-2003`), add:

```typescript
/** Same thumb-glide pattern as positionFacetThumb(), for the Tableau/Grille segmented. */
function positionViewModeThumb(): void {
  const seg = document.getElementById("sift-bib-viewmode-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>("[data-bib='viewmode'].on");
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}
```

- [x] **Step 5: Add the Artistes facet button + view-mode segmented, rewrite the row/virtualization section**

In `renderBiblioLive()` (`sift-live.ts:2007-2137`):

Replace `let facets: LibraryFacets = { folders: [], genres: [] };` (line 2014) with:

```typescript
let facets: LibraryFacets = { folders: [], genres: [], artists: [] };
```

Replace the facet segmented block (`sift-live.ts:2039-2060`, from `const facetList = ...` through the `.join("")` that builds `side`) with:

```typescript
const facetList =
  bibState.facet === "folder" ? facets.folders : bibState.facet === "genre" ? facets.genres : facets.artists;
const sideKey = bibState.facet;
const activeFacetVal =
  bibState.facet === "folder" ? bibState.filter.folder : bibState.facet === "genre" ? bibState.filter.genre : bibState.filter.artist;
const side =
  `<div class="sift-seg sift-seg-thumbed" id="sift-bib-facet-seg" style="margin-bottom:8px">` +
  `<div class="sift-seg-thumb"></div>` +
  `<button class="sift-seg-opt${bibState.facet === "folder" ? " on" : ""}" data-bib="facet" data-f="folder">Dossiers</button>` +
  `<button class="sift-seg-opt${bibState.facet === "genre" ? " on" : ""}" data-bib="facet" data-f="genre">Genres</button>` +
  `<button class="sift-seg-opt${bibState.facet === "artist" ? " on" : ""}" data-bib="facet" data-f="artist">Artistes</button></div>` +
  facetList
    .map(
      (b) =>
        `<div class="fld${activeFacetVal === b.name ? " on" : ""}" data-bib="pick" data-key="${sideKey}" data-val="${esc(b.name)}" tabindex="0" role="button" style="justify-content:space-between"><span>${esc(b.name)}</span><span style="font-size:var(--text-sm);opacity:.7">${b.count}</span></div>`,
    )
    .join("");
```

Add a view-mode segmented to the `header` block (`sift-live.ts:2090-2094`, right before the closing `</div>` of `.sift-library-toolbar`):

```typescript
const header =
  `<div class="sift-library-toolbar">` +
  `<div style="flex:1;display:flex;align-items:center;gap:7px;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:6px 10px"><i class="ti ti-search" style="font-size:var(--text-lg);color:var(--color-text-tertiary)"></i><input id="bibq" placeholder="Rechercher…" aria-label="Rechercher dans la bibliothèque" value="${esc(bibState.filter.q || "")}" style="flex:1;border:0;background:transparent;color:inherit;font-size:var(--text-md);outline:none"></div>` +
  chips +
  `<div class="sift-seg sift-seg-thumbed" id="sift-bib-viewmode-seg">` +
  `<div class="sift-seg-thumb"></div>` +
  `<button class="sift-seg-opt${bibState.viewMode === "table" ? " on" : ""}" data-bib="viewmode" data-mode="table" aria-label="Vue tableau"><i class="ti ti-list"></i></button>` +
  `<button class="sift-seg-opt${bibState.viewMode === "grid" ? " on" : ""}" data-bib="viewmode" data-mode="grid" aria-label="Vue grille"><i class="ti ti-layout-grid"></i></button></div>` +
  `</div>`;
```

Replace the virtualization block (`sift-live.ts:2121-2136`, the `if (biblist) { bibVirtual = createVirtualList(...) }` section) with a mode-aware setup, and add the sorted-tracks + table-header line right above it:

```typescript
const sortedTracks = bibState.viewMode === "table" ? sortTracks(bibState.tracks, bibState.sort) : bibState.tracks;
const tableHead = bibState.viewMode === "table" ? libraryTableHeaderHtml(bibState.sort) : "";

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
    const rows: LibraryTrack[][] = [];
    for (let i = 0; i < sortedTracks.length; i += LIBRARY_GRID_TILES_PER_ROW) {
      rows.push(sortedTracks.slice(i, i + LIBRARY_GRID_TILES_PER_ROW));
    }
    bibVirtual = createVirtualList<LibraryTrack[]>({
      host: biblist,
      scrollContainer: content,
      items: rows,
      rowHtml: (row) => libraryGridRowHtml(row),
      probeHtml: LIBRARY_GRID_PROBE_HTML,
      fallbackRowH: 150,
    });
  }
}
```

`bibVirtual`'s declared type (`sift-live.ts:399`, `let bibVirtual: VirtualList<LibraryTrack> | null = null;`) must widen to accept both shapes:

```typescript
let bibVirtual: VirtualList<LibraryTrack> | VirtualList<LibraryTrack[]> | null = null;
```

Insert `tableHead` into the markup right before the `rows` placeholder (the line building `content.innerHTML` at `sift-live.ts:2102-2108`) — inside `.sift-library-main`, immediately after the header/count line and before `${rows || ...}`:

```typescript
`<div class="sift-library-main sift-ui-card sift-ui-card-pad">${header}<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:var(--text-base);font-weight:500">${esc(activeFacetVal || "Tous")}</span><span style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${bibState.tracks.length} piste${bibState.tracks.length > 1 ? "s" : ""}</span></div>${tableHead}` +
```

Add `positionViewModeThumb();` right after the existing `positionFacetThumb();` call (`sift-live.ts:2110`).

- [x] **Step 6: Wire the new delegated actions**

In the `data-bib` click handler (`sift-live.ts:2288` onward), add two branches. Extend the existing `act === "pick"` branch (`sift-live.ts:2355-2363`) to handle the 3rd key, and add `sort`/`viewmode` as new `else if` branches (place them near `act === "facet"`, `sift-live.ts:2346-2354`):

```typescript
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
```

Replace the `act === "pick"` body (`sift-live.ts:2356-2363`) with the 3-way version:

```typescript
} else if (act === "pick") {
  const key = bibEl.dataset.key as "folder" | "genre" | "artist";
  const val = bibEl.dataset.val;
  const cur =
    key === "folder" ? bibState.filter.folder : key === "genre" ? bibState.filter.genre : bibState.filter.artist;
  const next = cur === val ? undefined : val;
  bibState.filter.folder = key === "folder" ? next : undefined;
  bibState.filter.genre = key === "genre" ? next : undefined;
  bibState.filter.artist = key === "artist" ? next : undefined;
  void renderBiblioLive();
```

- [x] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: clean

- [x] **Step 8: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "feat(library): wire table/grid view toggle, sortable header, artist facet"
```

---

### Task 7: CSS for the table header, grid tiles, and view-mode icons

**Files:**
- Modify: `frontend/styles.css`

**Interfaces:**
- Consumes: `.sift-lib-thead`, `.sift-lib-col`, `.sift-lib-cov`, `.sift-lib-cov-fallback`, `.sift-lib-tile*`, `.sift-lib-grid-row` classes emitted by Task 5/6.
- Produces: nothing consumed by later tasks — this is the terminal task.

- [x] **Step 1: Add the rules**

Append near the existing `.lr` rules (after `styles.css:390`'s `.lk-icon` block, so the whole Bibliothèque row family stays together):

```css
/* Bibliothèque — vue tableau (2026-07-09) : en-tête triable + colonnes, réutilise .lr pour les
   lignes elles-mêmes (cov/play/pill/link inchangés, juste plus de colonnes qu'avant). */
.sift-lib-thead{display:flex;align-items:center;gap:7px;padding:4px 6px;font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary);border-bottom:0.5px solid var(--color-border-tertiary)}
.sift-lib-thead-cov{width:44px;flex:none}
.sift-lib-thead button{padding:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-align:left}
.sift-lib-thead button:hover{color:var(--color-text-primary)}
.sift-lib-cov{width:32px;height:32px;border-radius:var(--border-radius-sm);object-fit:cover;flex:none}
.sift-lib-cov-fallback{width:32px;height:32px;border-radius:var(--border-radius-sm);background:var(--color-background-secondary);display:inline-flex;align-items:center;justify-content:center;color:var(--color-text-tertiary);flex:none}
.sift-lib-col{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Vue grille pochettes — tuiles façon casier de disques, une ligne virtualisée = LIBRARY_GRID_TILES_PER_ROW tuiles. */
.sift-lib-grid-row{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-12);padding:6px 2px}
.sift-lib-tile{cursor:pointer;border-radius:var(--border-radius-md);padding:6px;transition:background .16s ease}
.sift-lib-tile:hover,.sift-lib-tile:focus-within{background:var(--color-row-active)}
.sift-lib-tile.cur{background:var(--color-background-info)}
.sift-lib-tile-cov{width:100%;aspect-ratio:1;border-radius:var(--border-radius-md);object-fit:cover;display:block;margin-bottom:6px}
.sift-lib-tile-cov-fallback{width:100%;aspect-ratio:1;border-radius:var(--border-radius-md);background:var(--color-background-secondary);display:flex;align-items:center;justify-content:center;color:var(--color-text-tertiary);font-size:var(--text-2xl);margin-bottom:6px}
.sift-lib-tile-title{font-size:var(--text-sm);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sift-lib-tile-sub{font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

(`--space-12` is a real token, already used elsewhere for this kind of gap — e.g. `.sift-action-rail`, `styles.css:299`.)

- [x] **Step 2: Type-check / build sanity**

Run: `npx tsc --noEmit`
Expected: clean (CSS doesn't affect this, but confirms no stray edit broke a TS file in the same session)

- [x] **Step 3: Commit**

```bash
git add frontend/styles.css
git commit -m "style(library): table header, grid tiles, cover thumbnails"
```

---

### Task 8: Manual verification in `tauri dev`

**Files:** none (verification only)

- [x] **Step 1: Run the full backend test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass, including the two new tests from Task 1/2 (do not run this while a `tauri dev` process is open — see `avoid-concurrent-cargo-tauri-dev` memory)

- [x] **Step 2: Run clippy**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean

- [x] **Step 3: Manual check in the running app** (Antoine, or Claude via CDP per `sift-cdp-webview2-verification`)

With at least 2-3 filed tracks by different artists/genres/years:
- Bibliothèque → confirm 3rd facet button "Artistes" appears, clicking an artist filters the list.
- Table view: click each column header, confirm sort direction toggles (arrow flips) and rows reorder; confirm cover thumbnails render (or fallback icon); confirm no duration column.
- Click the Grille toggle: confirm tiles appear, covers show, clicking a tile opens the same detail panel as a table row.
- Keyboard: Tab to a table row or grid tile, press Enter — same open/close behavior as before this change.

- [x] **Step 4: Final commit (if verification surfaced fixes)**

```bash
git add -A
git commit -m "fix(library): address issues found in manual verification"
```

(Skip this step if no fixes were needed.)

---

## Self-Review Notes

- **Spec coverage**: Tableau (Task 5/6), Grille (Task 5/6), Artistes facet (Task 1/3/6), pas d'Album (respecté — aucune table/colonne album ajoutée), pas de fetch Discogs (aucune mention réseau dans ce plan), pas de durée dans le tableau (`libraryTableRowHtml` n'a pas de colonne durée), tri client (Task 5's `sortTracks`, aucun `ORDER BY` ajouté en Rust), a11y `aria-sort`/`tabindex`/`role` (Task 4, Task 5 Step 3/4, Task 6).
- **Type consistency checked**: `LibrarySortState`/`LibrarySortField` defined once in Task 5, imported (not redefined) in Task 6. `bibVirtual`'s widened type in Task 6 Step 5 matches the two `createVirtualList<T>` instantiations in the same step. `LibraryFacets`/`LibraryFilter` field names match exactly between Task 1/2 (Rust) and Task 3 (TS mirror).
- **Placeholder scan**: none found — every step has concrete code or an exact command with expected output.
