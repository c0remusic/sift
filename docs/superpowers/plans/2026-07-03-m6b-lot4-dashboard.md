# M6b Lot 4 — Dashboard Bibliothèque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small stats dashboard to the Bibliothèque screen (totals, lossless/mp3 split, remaining duplicates, tracks to re-source, genre breakdown), each stat clickable to apply the matching filter to the track list.

**Architecture:** A new `library_stats(conn)` function in `src-tauri/src/library.rs` aggregates counts with plain SQL and reuses `crate::dedup::scan_library_duplicates` for the duplicate count, exposed as the `library_stats` Tauri command in `ipc_library.rs`. The frontend renders stat cards above the Bibliothèque list in `frontend/sift-live.ts`; clicking a card sets `bibState.filter` (and, for duplicates, opens the Doublons panel) and re-renders.

**Tech Stack:** Rust (rusqlite), TypeScript (vanilla), Tauri IPC.

## Global Constraints

- MSRV Rust 1.77.2. Tests via `cargo test --manifest-path src-tauri/Cargo.toml`.
- Frontend type-check: `npx tsc --noEmit`. Use existing `--color-*`/`--text-*`/`--border-radius-*` tokens, no inline literals.
- Fail-fast, no silent fallback.
- **Hard prerequisite:** this plan calls `crate::dedup::scan_library_duplicates`, added by the Lot 3 plan (`docs/superpowers/plans/2026-07-03-m6b-lot3-doublons.md`). Do not start this plan until that one is merged to the branch you're building on — `cargo build` will fail with "cannot find function `scan_library_duplicates` in module `dedup`" otherwise. Also reuses the "Doublons" chip/panel state (`dupShown`, `dupGroups`) from that same plan's Task 3.
- Spec source: `docs/superpowers/specs/2026-06-24-m6b-library-design.md`, section "Lot 4".

---

### Task 1: Backend — `library_stats` in `library.rs` + `verdict` filter

**Files:**
- Modify: `src-tauri/src/library.rs` (add `verdict` filter field + types + function + tests, in the existing `#[cfg(test)] mod tests` block)

**Interfaces:**
- Consumes: `crate::dedup::scan_library_duplicates` (from Lot 3, already merged).
- Produces: `pub struct GenreCount { genre: String, count: i64 }`, `pub struct DashboardStats { total: i64, lossless: i64, mp3: i64, duplicates: i64, fake: i64, genres: Vec<GenreCount> }`, `pub fn library_stats(conn: &rusqlite::Connection) -> rusqlite::Result<DashboardStats>`, and a new `pub verdict: Option<String>` field on the existing `LibraryFilter`. Task 2 (IPC) calls `library_stats` by fully-qualified path `library::library_stats`; Task 3 (frontend) sets `bibState.filter.verdict` to make the "À re-sourcer" dashboard card actually filter the list.

- [ ] **Step 0: Add the `verdict` filter to `LibraryFilter`/`list_filed`**

The spec's dashboard card "12 faux → chip À re-sourcer" requires the list to actually filter by verdict — `LibraryFilter` doesn't have that field yet. In `src-tauri/src/library.rs`, add a field to the existing struct:

```rust
pub struct LibraryFilter {
    pub folder: Option<String>,
    pub quality: Option<String>,
    pub genre: Option<String>,
    pub q: Option<String>,
    /// Restrict to a verdict (currently only "fake" is used, by the dashboard's "À re-sourcer" card).
    pub verdict: Option<String>,
}
```

and in `list_filed`, add the clause (after the `quality` block, before the `q` block):

```rust
    if f.verdict.is_some() {
        sql.push_str(" AND t.verdict = :verdict");
    }
```

and bind it in the params vector (after the `folder` push, alongside `like`/`genre`):

```rust
        if let Some(v) = &f.verdict {
            p.push((":verdict", v));
        }
```

Add one test in the existing `mod tests` block, after `list_filed_joins_metadata_and_genres`:

```rust
    #[test]
    fn list_filed_filters_by_verdict() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, status, verdict) VALUES(1, '/lib/a.mp3', 'filed', 'fake')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, status, verdict) VALUES(2, '/lib/b.mp3', 'filed', 'ok')",
            [],
        )
        .unwrap();
        let f = LibraryFilter { verdict: Some("fake".into()), ..Default::default() };
        let rows = list_filed(&conn, &f).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 1);
    }
```

Run `cargo test --manifest-path src-tauri/Cargo.toml library::tests::list_filed_filters_by_verdict` and confirm it passes before continuing to Step 1.

- [ ] **Step 1: Write the failing test**

Add inside the existing `mod tests` block in `src-tauri/src/library.rs`, after `folder_facets_counts_filed_by_folder_and_genre`:

```rust
    #[test]
    fn library_stats_aggregates_counts() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, status, format, verdict) \
             VALUES(1, '/lib/a.flac', 'filed', 'flac', 'ok')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, status, format, verdict) \
             VALUES(2, '/lib/b.mp3', 'filed', 'mp3', 'ok')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, status, format, verdict) \
             VALUES(3, '/lib/c.mp3', 'filed', 'mp3', 'fake')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, status, format) VALUES(9, '/in/p.mp3', 'pending', 'mp3')",
            [],
        )
        .unwrap();
        crate::genres::set_genres(&conn, 1, &["House".into()]).unwrap();
        crate::genres::set_genres(&conn, 2, &["House".into()]).unwrap();
        crate::genres::set_genres(&conn, 3, &["Techno".into()]).unwrap();

        let stats = library_stats(&conn).unwrap();

        assert_eq!(stats.total, 3, "only filed tracks count");
        assert_eq!(stats.lossless, 1);
        assert_eq!(stats.mp3, 2);
        assert_eq!(stats.fake, 1);
        assert_eq!(stats.duplicates, 0, "no fingerprint-matched pair seeded");
        let house = stats.genres.iter().find(|g| g.genre == "House").unwrap();
        assert_eq!(house.count, 2);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml library::tests::library_stats -- --nocapture`
Expected: FAIL with "cannot find function `library_stats`".

- [ ] **Step 3: Implement the types and function**

Add in `src-tauri/src/library.rs`, after the `LibraryFacets` struct definition:

```rust
/// One genre with its `filed`-track count, ordered by count desc then name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreCount {
    pub genre: String,
    pub count: i64,
}

/// Aggregate stats for the Bibliothèque dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total: i64,
    pub lossless: i64,
    pub mp3: i64,
    /// Number of duplicate groups still unresolved (`scan_library_duplicates(conn).len()`).
    pub duplicates: i64,
    /// Tracks with verdict = 'fake', i.e. to re-source.
    pub fake: i64,
    pub genres: Vec<GenreCount>,
}

/// Aggregate counts for the Bibliothèque dashboard. Read-only.
pub fn library_stats(conn: &rusqlite::Connection) -> rusqlite::Result<DashboardStats> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE status='filed'",
        [],
        |r| r.get(0),
    )?;
    let lossless: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE status='filed' AND lower(format) IN ('aiff','aif','wav','flac')",
        [],
        |r| r.get(0),
    )?;
    let mp3: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE status='filed' AND lower(format)='mp3'",
        [],
        |r| r.get(0),
    )?;
    let fake: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tracks WHERE status='filed' AND verdict='fake'",
        [],
        |r| r.get(0),
    )?;
    let duplicates = crate::dedup::scan_library_duplicates(conn)?.len() as i64;

    let mut stmt = conn.prepare(
        "SELECT g.genre, COUNT(*) FROM track_genres g \
         JOIN tracks t ON t.id = g.track_id AND t.status='filed' \
         GROUP BY g.genre ORDER BY COUNT(*) DESC, g.genre",
    )?;
    let genres = stmt
        .query_map([], |r| {
            Ok(GenreCount {
                genre: r.get(0)?,
                count: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(DashboardStats {
        total,
        lossless,
        mp3,
        duplicates,
        fake,
        genres,
    })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml library::tests:: -- --nocapture`
Expected: PASS (all `library.rs` tests including the new one).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/library.rs
git commit -m "feat(library): add library_stats dashboard aggregation"
```

---

### Task 2: IPC command + registration

**Files:**
- Modify: `src-tauri/src/ipc_library.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `crate::library::{library_stats, DashboardStats}` (Task 1).
- Produces: Tauri command `library_stats` returning `DashboardStats`. Task 3 calls it via `invoke("library_stats")`.

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/ipc_library.rs`:

```rust
/// Dashboard aggregate stats for the Bibliothèque (totals, lossless/mp3 split, duplicates,
/// tracks to re-source, genre breakdown).
#[tauri::command]
pub fn library_stats(conn: State<'_, Mutex<Connection>>) -> Result<library::DashboardStats, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    library::library_stats(&conn).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, add after `ipc_library::scan_library_duplicates,` (from Lot 3):

```rust
            ipc_library::library_stats,
```

- [ ] **Step 3: Build to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): expose library_stats command"
```

---

### Task 3: Frontend — dashboard cards

**Files:**
- Modify: `shared/contracts.ts` (add `GenreCount`/`DashboardStats` mirror types)
- Modify: `frontend/ipc.ts` (add `libraryStats` wrapper)
- Modify: `frontend/sift-live.ts` (render cards above the Bibliothèque list, wire clicks to filters)

**Interfaces:**
- Consumes: `bibState`, `renderBiblioLive`, `dupShown` (module-level state added by Lot 3 Task 3 — already merged), `esc`.
- Produces: nothing consumed further (last task in this plan).

- [ ] **Step 1: Add mirror types to `shared/contracts.ts`**

Append after the `DupGroup` interface (added by Lot 3):

```typescript
// ---- M6b Lot 4: dashboard (mirror of src-tauri/src/library.rs) ----

export interface GenreCount { genre: string; count: number; }

export interface DashboardStats {
  total: number;
  lossless: number;
  mp3: number;
  duplicates: number;
  fake: number;
  genres: GenreCount[];
}
```

Also add the new backend filter field to the existing `LibraryFilter` interface (~line 238):

```typescript
export interface LibraryFilter {
  folder?: string | null;
  quality?: "lossless" | "mp3" | null;
  genre?: string | null;
  q?: string | null;
  verdict?: "fake" | null;
}
```

- [ ] **Step 2: Add the IPC wrapper**

Append to `frontend/ipc.ts` after `scanLibraryDuplicates`:

```typescript
/** Dashboard aggregate stats for the Bibliothèque. */
export const libraryStats = (): Promise<DashboardStats> => invoke("library_stats");
```

Add `DashboardStats` to the same type-only import block as `DupGroup`.

- [ ] **Step 3: Fetch stats and render cards in `renderBiblioLive`**

Import `libraryStats` alongside `scanLibraryDuplicates` in `frontend/sift-live.ts`, and `DashboardStats` alongside `DupGroup`.

In `renderBiblioLive` (~line 1100), extend the initial `Promise.all` to also fetch stats:

```typescript
  let facets: LibraryFacets = { folders: [], genres: [] };
  let stats: DashboardStats | null = null;
  try {
    [bibState.tracks, facets, stats] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
    ]);
  } catch (e) {
    console.error("library load failed", e);
    return;
  }
```

Add a card renderer near `dupGroupHtml`:

```typescript
function statsCardsHtml(s: DashboardStats): string {
  const card = (label: string, value: number, action: string, extra = "") =>
    `<button data-bib="stat" data-stat="${action}" style="flex:1;min-width:90px;text-align:left;border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:8px 10px;background:transparent;cursor:pointer">` +
    `<div style="font-size:var(--text-xl);font-weight:600">${value}</div>` +
    `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${esc(label)}${extra}</div>` +
    `</button>`;
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
```

Insert `stats ? statsCardsHtml(stats) : ""` right before the `header` variable's usage in the final template (i.e. prepend to the non-empty branch of the `content.innerHTML =` assignment, before the search/chips `header`).

- [ ] **Step 4: Wire card clicks to filters**

In the `[data-bib]` delegated handler, add a branch before the existing `qual`/`facet`/`dupscan` chain:

```typescript
      if (act === "stat") {
        const stat = bibEl.dataset.stat;
        if (stat === "all") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = undefined;
        } else if (stat === "lossless" || stat === "mp3") {
          bibState.filter.quality = stat;
          bibState.filter.verdict = undefined;
        } else if (stat === "duplicates") {
          dupShown = true;
          if (dupGroups === null) {
            dupLoading = true;
            void renderBiblioLive();
            void scanLibraryDuplicates()
              .then((groups) => {
                dupGroups = groups;
              })
              .finally(() => {
                dupLoading = false;
                void renderBiblioLive();
              });
            return;
          }
        } else if (stat === "fake") {
          bibState.filter.quality = undefined;
          bibState.filter.verdict = "fake";
        }
        void renderBiblioLive();
        return;
      }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual run verification**

Ask the user to verify in `npm run tauri dev`: open Bibliothèque, confirm 5 stat cards show correct counts, click "Lossless"/"MP3" and confirm the list filters, click "Doublons" and confirm it opens the same panel as the chip from Lot 3.

- [ ] **Step 7: Commit**

```bash
git add shared/contracts.ts frontend/ipc.ts frontend/sift-live.ts
git commit -m "feat(library): dashboard stat cards, clickable to filter"
```
