# Apple system colors palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sift's 2-hue (green/amber) semantic color system with a full
Apple-style system-colors palette: 4 real semantic hues (success=green,
danger=red, warning=orange, info=blue) plus 5 categorical hues (indigo,
purple, pink, teal, yellow) shared across genre families, watched sources,
and the Rekordbox/Clé USB nav items.

**Architecture:** All new colors are CSS custom properties in
`frontend/styles.css`, following the app's existing triplet convention
(`--color-text-{name}` / `--color-background-{name}` / `--color-border-{name}`,
defined once in `:root` and duplicated in the two existing dark blocks).
The 5 categorical hues get ONE shared token set (`--color-hue-{name}-*`)
consumed by three different features (genres, sources, integrations) —
they never appear on-screen together, so reuse is safe. A new frontend-only
module resolves genre strings to a family; source colors are persisted in
SQLite via a new nullable column + IPC command; nav colors are static CSS.

**Tech Stack:** Tauri v2 (Rust/rusqlite backend), vanilla TypeScript
frontend, no framework. `npx tsc --noEmit` for type-checking,
`cargo test --manifest-path src-tauri/Cargo.toml` and
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
for the Rust side.

## Global Constraints

- Never hardcode a color literal outside `:root`/dark blocks — every consumer
  references a `var(--color-*)` token, per CLAUDE.md's "tokens obligatoires"
  rule.
- Every new/changed color token needs a light value (`:root`) AND matching
  dark values in BOTH existing dark blocks
  (`@media (prefers-color-scheme:dark)` and `:root[data-theme="dark"]`) —
  never one without the others.
- Do not run `cargo test`/`cargo clippy` while `tauri dev` is running
  concurrently (corrupts the incremental build cache — see
  `avoid-concurrent-cargo-tauri-dev` in project memory). Ask the user to stop
  `tauri dev` first if it's running, or run these checks between dev
  sessions.
- Never `git add -A`/`git add .` — stage exact files per commit.
- Commit after each task, following the repo's existing commit message
  style (`type(scope): summary`).

---

### Task 1: Real red (danger) and blue (info) hues in `styles.css`

Splits `danger` off the amber it currently shares with `warning`, and gives
`info` a real blue instead of the near-white/near-black neutral it currently
reuses. `warning` keeps its existing amber/orange values unchanged — only
its *meaning* narrows (no longer also covering "danger").

**Files:**
- Modify: `frontend/styles.css:18,20,22` (`:root`, light)
- Modify: `frontend/styles.css:70,72,74` (`@media (prefers-color-scheme:dark)`)
- Modify: `frontend/styles.css:84,86,88` (`:root[data-theme="dark"]`)

**Interfaces:**
- Produces: `--color-text-danger`, `--color-background-danger`,
  `--color-border-danger`, `--color-text-info`, `--color-background-info`,
  `--color-border-info` — same token names as today, new values. Every
  later task that references these tokens by name needs no further changes
  here; the cascade does the work.

- [ ] **Step 1: Update the light `:root` block**

In `frontend/styles.css`, line 18 currently reads:
```css
--color-background-info:rgba(58,53,47,.08);--color-background-danger:rgba(176,122,40,.14);--color-background-success:rgba(76,123,87,.14);--color-background-warning:rgba(176,122,40,.14);
```
Replace with:
```css
--color-background-info:rgba(62,124,177,.10);--color-background-danger:rgba(196,74,58,.14);--color-background-success:rgba(76,123,87,.14);--color-background-warning:rgba(176,122,40,.14);
```

Line 20 currently reads:
```css
--color-text-info:#3A352F;--color-cta-text:#F7F4EF;--color-text-danger:#8f6318;--color-text-success:#3f6d4c;--color-text-warning:#8f6318;
```
Replace with:
```css
--color-text-info:#2B5A82;--color-cta-text:#F7F4EF;--color-text-danger:#a0392a;--color-text-success:#3f6d4c;--color-text-warning:#8f6318;
```

Line 22 currently reads:
```css
--color-border-info:rgba(58,53,47,.35);--color-border-danger:rgba(176,122,40,.45);
```
Replace with:
```css
--color-border-info:rgba(62,124,177,.35);--color-border-danger:rgba(196,74,58,.42);
```

- [ ] **Step 2: Update both dark blocks identically**

`frontend/styles.css:70` and `:84` are byte-identical duplicates (the
`@media` query and the `[data-theme="dark"]` override). Both currently
read:
```css
--color-background-info:rgba(240,237,230,.08);--color-background-danger:rgba(176,122,40,.14);--color-background-success:rgba(76,123,87,.14);--color-background-warning:rgba(176,122,40,.14);
```
Replace BOTH occurrences with:
```css
--color-background-info:rgba(62,124,177,.14);--color-background-danger:rgba(196,74,58,.16);--color-background-success:rgba(76,123,87,.14);--color-background-warning:rgba(176,122,40,.14);
```

Lines `72`/`86` currently read:
```css
--color-text-info:#F5F1E9;--color-cta-text:#26251F;--color-text-danger:#f2c274;--color-text-success:#9fe0af;--color-text-warning:#f2c274;
```
Replace BOTH occurrences with:
```css
--color-text-info:#8EC2EA;--color-cta-text:#26251F;--color-text-danger:#f0a08f;--color-text-success:#9fe0af;--color-text-warning:#f2c274;
```

Lines `74`/`88` currently read:
```css
--color-border-info:rgba(240,237,230,.30);--color-border-danger:rgba(221,166,63,.45);
```
Replace BOTH occurrences with:
```css
--color-border-info:rgba(142,194,234,.30);--color-border-danger:rgba(240,160,143,.40);
```

- [ ] **Step 3: Fix the stale header comment**

`frontend/styles.css:7-9` documents the OLD 2-hue rule inline. Read the
comment block at the top of the file (search for
`"d'accent décoratif"` and `"pointent tous deux vers l'ambre"`) and replace
it with a short note that `info` is now a real blue and `danger`/`warning`
are separate hues — this comment is a common reference point for future
sessions and must not contradict the tokens below it.

- [ ] **Step 4: Verify no TypeScript regressions**

Run: `npx tsc --noEmit` (from the repo root)
Expected: `TypeScript: No errors found` — this task is CSS-only, so this
just confirms nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add frontend/styles.css
git commit -m "feat(colors): give danger and info their own real hues (red, blue)"
```

---

### Task 2: 5 categorical hue tokens (indigo, purple, pink, teal, yellow)

Adds one shared token set per hue, consumed later by genre chips, source
colors, and the Rekordbox/Clé USB nav items.

**Files:**
- Modify: `frontend/styles.css` — insert new tokens in `:root` and both dark
  blocks, right after the existing `--color-border-*` line in each block
  (same location convention as the semantic tokens).

**Interfaces:**
- Produces: `--color-hue-indigo-text`/`-bg`/`-border`,
  `--color-hue-purple-text`/`-bg`/`-border`,
  `--color-hue-pink-text`/`-bg`/`-border`,
  `--color-hue-teal-text`/`-bg`/`-border`,
  `--color-hue-yellow-text`/`-bg`/`-border`. Tasks 3, 6, 7 consume these by
  name.

- [ ] **Step 1: Add the light values to `:root`**

Immediately after the line you edited at `frontend/styles.css:22` in Task 1
(`--color-border-info:...;--color-border-danger:...;`), add a new line:
```css
--color-hue-indigo-text:#4A3F9E;--color-hue-indigo-bg:rgba(88,86,214,.14);--color-hue-indigo-border:rgba(88,86,214,.40);--color-hue-purple-text:#6B3F8F;--color-hue-purple-bg:rgba(175,82,222,.14);--color-hue-purple-border:rgba(175,82,222,.40);--color-hue-pink-text:#8F2F52;--color-hue-pink-bg:rgba(212,83,126,.14);--color-hue-pink-border:rgba(212,83,126,.40);--color-hue-teal-text:#0E6B62;--color-hue-teal-bg:rgba(20,150,140,.14);--color-hue-teal-border:rgba(20,150,140,.40);--color-hue-yellow-text:#8A6D00;--color-hue-yellow-bg:rgba(230,180,0,.14);--color-hue-yellow-border:rgba(230,180,0,.40);
```

- [ ] **Step 2: Add the dark values to both dark blocks**

Immediately after each of the two lines you edited at `styles.css:74` and
`:88` in Task 1, add the SAME new line to both blocks:
```css
--color-hue-indigo-text:#A6A0F0;--color-hue-indigo-bg:rgba(88,86,214,.18);--color-hue-indigo-border:rgba(166,160,240,.35);--color-hue-purple-text:#C9A6E0;--color-hue-purple-bg:rgba(175,82,222,.18);--color-hue-purple-border:rgba(201,166,224,.35);--color-hue-pink-text:#F0A8C2;--color-hue-pink-bg:rgba(212,83,126,.18);--color-hue-pink-border:rgba(240,168,194,.35);--color-hue-teal-text:#7CE0D4;--color-hue-teal-bg:rgba(20,150,140,.18);--color-hue-teal-border:rgba(124,224,212,.35);--color-hue-yellow-text:#F5D76E;--color-hue-yellow-bg:rgba(230,180,0,.18);--color-hue-yellow-border:rgba(245,215,110,.35);
```

- [ ] **Step 3: Verify with a quick grep**

Run: `grep -c "color-hue-" frontend/styles.css`
Expected: `6` (1 in `:root` + 1 in each of the 2 dark blocks + the 3 CSS
comment-free duplicate check — if it's not 6, one block is missing the
line).

- [ ] **Step 4: Commit**

```bash
git add frontend/styles.css
git commit -m "feat(colors): add 5 categorical hue tokens (indigo/purple/pink/teal/yellow)"
```

---

### Task 3: Genre family resolution + chip coloring

New frontend-only module resolving a Discogs genre string to one of 4
colored families or a neutral "Autre" fallback, wired into the existing
genre chip renderer.

**Files:**
- Create: `frontend/genre-families.ts`
- Modify: `frontend/filing.ts:664-672` (`renderGenres`)
- Modify: `frontend/styles.css:390` (`.sift-genre-chip`)

**Interfaces:**
- Produces: `export type GenreFamily = "house" | "techno" | "discofunksoul" | "hiphop" | "autre"`,
  `export function resolveGenreFamily(genre: string): GenreFamily`.
- Consumes (Task 2): `--color-hue-teal-*`, `--color-hue-indigo-*`,
  `--color-hue-pink-*`, `--color-hue-purple-*`.

- [ ] **Step 1: Query the real genre vocabulary before finalizing keywords**

The keyword lists below are a starting point based on common Discogs
"style" vocabulary. Before considering this task done, verify coverage
against the user's actual library: with the app's SQLite DB closed (not
mid- `tauri dev`), run:
```bash
sqlite3 "%APPDATA%/com.sift.app/sift.db" "SELECT DISTINCT genre FROM track_genres ORDER BY genre;" 2>/dev/null || echo "adjust the DB path if this fails — check src-tauri's app data dir"
```
(if `sqlite3` isn't installed, open the DB file with any SQLite browser, or
ask the user to paste the list of distinct genres they see in Bibliothèque).
Add any missing keywords to the arrays in Step 2 so real genres in the
library don't all fall through to "Autre".

- [ ] **Step 2: Write `frontend/genre-families.ts`**

```typescript
// Genre → family resolution for chip coloring (2026-07-06 Apple system-colors
// palette). Frontend-only concern — genres.rs stays a plain free-form string
// store, no DB/backend change. Matching is case-insensitive substring search,
// not exact-match: real Discogs "style" strings vary in formulation ("Deep
// House", "House", "Tech House" all need to resolve to the same family).
export type GenreFamily = "house" | "techno" | "discofunksoul" | "hiphop" | "autre";

interface FamilyDef {
  family: GenreFamily;
  keywords: string[];
}

// Order matters: first matching keyword wins. Keep specific-before-generic
// if a future keyword could overlap two families.
const FAMILIES: FamilyDef[] = [
  { family: "house", keywords: ["house", "garage"] },
  { family: "techno", keywords: ["techno", "electro", "industrial", "ebm"] },
  { family: "discofunksoul", keywords: ["disco", "funk", "soul", "boogie"] },
  { family: "hiphop", keywords: ["hip hop", "hip-hop", "rap", "r&b", "rnb", "trap"] },
];

/** Resolves a raw Discogs genre string to a coloring family. Unrecognized
 *  genres (including empty strings) fall back to "autre" (neutral, no color). */
export function resolveGenreFamily(genre: string): GenreFamily {
  const norm = genre.trim().toLowerCase();
  if (!norm) return "autre";
  for (const def of FAMILIES) {
    if (def.keywords.some((kw) => norm.includes(kw))) return def.family;
  }
  return "autre";
}
```

- [ ] **Step 3: Wire `resolveGenreFamily` into the chip renderer**

In `frontend/filing.ts`, add the import near the top of the file (alongside
the existing imports):
```typescript
import { resolveGenreFamily } from "./genre-families";
```

Replace `renderGenres` (currently at `frontend/filing.ts:666-672`):
```typescript
function renderGenres(): void {
  const el = document.querySelector<HTMLElement>(".sift-genres");
  if (!el) return; // editor not mounted
  el.innerHTML = state.genres
    .map((s) => `<span class="sift-genre-chip" title="Sous-genres Discogs">${esc(s)}</span>`)
    .join("");
}
```
with:
```typescript
function renderGenres(): void {
  const el = document.querySelector<HTMLElement>(".sift-genres");
  if (!el) return; // editor not mounted
  el.innerHTML = state.genres
    .map((s) => {
      const fam = resolveGenreFamily(s);
      return `<span class="sift-genre-chip sift-genre-chip-${fam}" title="Sous-genres Discogs">${esc(s)}</span>`;
    })
    .join("");
}
```

- [ ] **Step 4: Add the per-family chip CSS**

In `frontend/styles.css`, the base rule is at line 390:
```css
.sift-genre-chip{font-size:11px;padding:2px 8px;border-radius:var(--border-radius-pill);background:var(--color-background-info);color:var(--color-text-info);cursor:default}
```
Change it to drop the hardcoded info background/color (now family-specific)
and add the 5 family variants right after it:
```css
.sift-genre-chip{font-size:11px;padding:2px 8px;border-radius:var(--border-radius-pill);cursor:default}
.sift-genre-chip-house{background:var(--color-hue-teal-bg);color:var(--color-hue-teal-text)}
.sift-genre-chip-techno{background:var(--color-hue-indigo-bg);color:var(--color-hue-indigo-text)}
.sift-genre-chip-discofunksoul{background:var(--color-hue-pink-bg);color:var(--color-hue-pink-text)}
.sift-genre-chip-hiphop{background:var(--color-hue-purple-bg);color:var(--color-hue-purple-text)}
.sift-genre-chip-autre{background:var(--color-background-secondary);color:var(--color-text-tertiary)}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Manual verification in `tauri dev`**

Ask the user to open a track in Revue with genres attached and confirm each
genre chip shows a distinct color matching its family (house=teal,
techno=indigo, disco/funk/soul=pink, hip-hop/r&b=purple, unrecognized=gray).
This is markup gated `inTauri` — cannot be verified via browser preview.

- [ ] **Step 7: Commit**

```bash
git add frontend/genre-families.ts frontend/filing.ts frontend/styles.css
git commit -m "feat(colors): color genre chips by family (house/techno/disco-funk-soul/hip-hop)"
```

---

### Task 4: DB migration — per-source color override column

Adds a nullable `color_key` column to `sources`, storing one of the 5 hue
names (`"indigo"|"purple"|"pink"|"teal"|"yellow"`) or `NULL` for
auto-assignment by add-order.

**Files:**
- Modify: `src-tauri/src/db.rs` (append migration v12)
- Modify: `src-tauri/src/sources.rs` (`Source` struct, `add`, `list`, new `set_color`)

**Interfaces:**
- Produces: `sources::Source.color_key: Option<String>`,
  `sources::set_color(conn: &Connection, id: i64, color_key: Option<String>) -> rusqlite::Result<()>`.
- Consumes: nothing new (extends the existing `sources` module).

- [ ] **Step 1: Write the failing test for `set_color`**

In `src-tauri/src/sources.rs`, find the existing `#[cfg(test)] mod tests`
block (`src-tauri/src/sources.rs:90-100`), which already has a `db()`
helper (in-memory `Connection` + `run_migrations`) — reuse it. Add these
two tests inside that module, alongside the existing ones:
```rust
#[test]
fn set_color_persists_and_reads_back() {
    let conn = db();
    let id = add(&conn, ".").unwrap();
    set_color(&conn, id, Some("teal".to_string())).unwrap();
    let sources = list(&conn).unwrap();
    let s = sources.iter().find(|s| s.id == id).unwrap();
    assert_eq!(s.color_key.as_deref(), Some("teal"));
}

#[test]
fn color_defaults_to_none() {
    let conn = db();
    let id = add(&conn, ".").unwrap();
    let sources = list(&conn).unwrap();
    let s = sources.iter().find(|s| s.id == id).unwrap();
    assert_eq!(s.color_key, None);
}
```
- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sources::`
Expected: FAIL — `color_key` field doesn't exist yet, `set_color` function
doesn't exist yet (compile error).

- [ ] **Step 3: Add migration v12**

In `src-tauri/src/db.rs`, the `MIGRATIONS` array's last entry is v11
(`rekordbox_masterdb_repairs`, ending around line 147). Append a new entry
right after it, before the closing `];`:
```rust
    // v12 — Apple system-colors palette: per-source manual color override.
    // NULL = auto-assign by add-order (frontend computes this from list order,
    // no need to store the derived value); a hue name persists an explicit
    // override chosen in Réglages.
    r#"
    ALTER TABLE sources ADD COLUMN color_key TEXT;
    "#,
```

- [ ] **Step 4: Update the `Source` struct and its consumers**

In `src-tauri/src/sources.rs`, the struct at lines 20-27 currently reads:
```rust
#[derive(Debug, Serialize, PartialEq)]
pub struct Source {
    pub id: i64,
    pub path: String,
    pub pending_count: i64,
    pub accessible: bool,
    pub watched: bool,
}
```
Add the new field:
```rust
#[derive(Debug, Serialize, PartialEq)]
pub struct Source {
    pub id: i64,
    pub path: String,
    pub pending_count: i64,
    pub accessible: bool,
    pub watched: bool,
    pub color_key: Option<String>,
}
```

Update `list()` (currently `src-tauri/src/sources.rs:48-67`) to select and
map the new column:
```rust
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Source>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.path,
                (SELECT count(*) FROM tracks t WHERE t.source_id=s.id AND t.status='pending'),
                s.watched, s.color_key
         FROM sources s ORDER BY s.id",
    )?;
    let rows = stmt.query_map([], |r| {
        let path: String = r.get(1)?;
        let accessible = Path::new(&path).is_dir();
        Ok(Source {
            id: r.get(0)?,
            path,
            pending_count: r.get(2)?,
            accessible,
            watched: r.get::<_, i64>(3)? != 0,
            color_key: r.get(4)?,
        })
    })?;
    rows.collect()
}
```

- [ ] **Step 5: Add `set_color`**

In `src-tauri/src/sources.rs`, right after the existing `set_watched`
function, add:
```rust
/// Sets (or clears, with `None`) a source's manual color override. Persists
/// one of the 5 categorical hue names (`"indigo"|"purple"|"pink"|"teal"|"yellow"`)
/// — validation of the value itself happens at the IPC layer, this just stores it.
pub fn set_color(conn: &Connection, id: i64, color_key: Option<String>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sources SET color_key=?2 WHERE id=?1",
        rusqlite::params![id, color_key],
    )?;
    Ok(())
}
```

- [ ] **Step 6: Fix `add_source`'s manual row fetch in `ipc.rs`**

`src-tauri/src/ipc.rs:68-86` (`add_source`) builds a `Source` manually
instead of calling `sources::list`. Update its `SELECT` and struct
construction (currently missing the new column) — find the block starting
at `conn.query_row(` around line 68 and update it:
```rust
    conn.query_row(
        "SELECT s.id, s.path,
                (SELECT count(*) FROM tracks t WHERE t.source_id=s.id AND t.status='pending'),
                s.watched, s.color_key
         FROM sources s WHERE s.id=?1",
        rusqlite::params![id],
        |r| {
            let path: String = r.get(1)?;
            let accessible = std::path::Path::new(&path).is_dir();
            Ok(sources::Source {
                id: r.get(0)?,
                path,
                pending_count: r.get(2)?,
                accessible,
                watched: r.get::<_, i64>(3)? != 0,
                color_key: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sources::`
Expected: PASS (`set_color_persists_and_reads_back`, `color_defaults_to_none`,
plus any pre-existing `sources::` tests still green).

- [ ] **Step 8: Full test suite + clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green (the `add_source` IPC handler change is exercised
indirectly by any existing IPC-level tests; if none exist for `add_source`,
that's pre-existing and out of scope here).

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean, no warnings.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/sources.rs src-tauri/src/ipc.rs
git commit -m "feat(db): add sources.color_key for manual source color override (v12)"
```

---

### Task 5: IPC command + frontend contract for source color

Wires `sources::set_color` up through Tauri's `invoke_handler` and the
frontend's typed IPC wrappers.

**Files:**
- Modify: `src-tauri/src/ipc.rs` (new `set_source_color` command)
- Modify: `src-tauri/src/lib.rs` (register the command)
- Modify: `shared/contracts.ts` (`Source` interface)
- Modify: `frontend/ipc.ts` (`setSourceColor` wrapper)

**Interfaces:**
- Consumes (Task 4): `sources::set_color`.
- Produces: Tauri command `set_source_color(id: number, colorKey: string | null): Promise<void>`
  callable from the frontend as `setSourceColor(id, colorKey)`. Task 6
  consumes this.

- [ ] **Step 1: Add the Tauri command**

In `src-tauri/src/ipc.rs`, right after `set_source_watched` (ends around
line 141), add:
```rust
/// Sets or clears a source's manual color override (one of the 5 categorical
/// hue keys, or None to fall back to auto-assignment by add-order).
#[tauri::command]
pub fn set_source_color(
    conn: State<'_, Mutex<Connection>>,
    id: i64,
    color_key: Option<String>,
) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    sources::set_color(&conn, id, color_key).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register it in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `invoke_handler` list (where
`ipc::set_source_watched,` is registered, around line 90) and add right
after it:
```rust
            ipc::set_source_color,
```

- [ ] **Step 3: Build the Rust side to confirm it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (no errors). If `tauri dev` is currently running,
ask the user to stop it first — see Global Constraints.

- [ ] **Step 4: Update the `Source` TypeScript interface**

In `shared/contracts.ts`, the interface at lines 26-32 currently reads:
```typescript
export interface Source {
  id: number;
  path: string;
  pending_count: number;
  accessible: boolean;
  watched: boolean;
}
```
Add the new field:
```typescript
export interface Source {
  id: number;
  path: string;
  pending_count: number;
  accessible: boolean;
  watched: boolean;
  color_key: string | null;
}
```

- [ ] **Step 5: Add the frontend wrapper**

In `frontend/ipc.ts`, right after `setSourceWatched` (line 46), add:
```typescript
export const setSourceColor = (id: number, colorKey: string | null): Promise<void> =>
  invoke("set_source_color", { id, colorKey });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/src/lib.rs shared/contracts.ts frontend/ipc.ts
git commit -m "feat(ipc): add set_source_color command + TS mirror"
```

---

### Task 6: Source color rendering — auto-assignment + manual picker

Renders each watched source's identity color (a small dot, like the
existing status dot) and adds a manual override control in the source
detail panel.

**Files:**
- Modify: `frontend/home-sources.ts`
- Modify: `frontend/sift-live.ts` (delegated click handler)
- Modify: `frontend/styles.css` (new `.sift-src-color-*` rules)

**Interfaces:**
- Consumes (Task 2): `--color-hue-{indigo,purple,pink,teal,yellow}-text`.
- Consumes (Task 5): `setSourceColor`.
- Produces: `resolveSourceColorKey(sources: Source[], source: Source): string`
  (exported from `home-sources.ts`) — a pure function so it's testable
  independent of rendering; no other task consumes it, but keeping it
  named and exported (not an inline closure) matches this codebase's
  pattern of small focused helpers like `baseName`/`statusMeta`.

- [ ] **Step 1: Add the hue-cycle resolver**

In `frontend/home-sources.ts`, add near the top (after the existing
`esc`/`baseName` helpers, before `statusMeta`):
```typescript
const SOURCE_HUE_CYCLE = ["indigo", "purple", "pink", "teal", "yellow"] as const;

/** A source's identity color: its manual override if set, otherwise the hue
 *  at its position in add-order (id ascending, matching how `sources::list`
 *  already orders rows), cycling through the 5 categorical hues. */
export function resolveSourceColorKey(sources: Source[], source: Source): string {
  if (source.color_key) return source.color_key;
  const sorted = [...sources].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex((s) => s.id === source.id);
  return SOURCE_HUE_CYCLE[idx % SOURCE_HUE_CYCLE.length];
}
```

- [ ] **Step 2: Render the color dot in the list row**

`rowHtml` (currently `frontend/home-sources.ts:41-49`) renders the status
dot. Add the source's identity color as a SECOND small dot before the
name, so identity (always visible) and status (label + its own dot) stay
visually distinct. Replace `rowHtml`:
```typescript
function rowHtml(s: Source, active: boolean, allSources: Source[]): string {
  const sm = statusMeta(s);
  const hue = resolveSourceColorKey(allSources, s);
  return (
    `<div class="qi${active ? " cur" : ""}" data-sift="homerow" data-id="${s.id}" style="flex-direction:column;align-items:stretch;gap:3px;height:auto;padding:8px 9px">` +
    `<span style="display:flex;align-items:center;gap:6px;font-size:var(--text-lg);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
    `<span class="sift-src-dot sift-src-dot-${hue}" aria-hidden="true"></span>${esc(baseName(s.path))}</span>` +
    `<span style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);color:${sm.color}"><span style="width:5px;height:5px;border-radius:999px;background:${sm.color};flex:none"></span>${esc(sm.label)}</span>` +
    `</div>`
  );
}
```

Update its one call site in `listColumnHtml` (currently line 64):
```typescript
    ? sources.map((s) => rowHtml(s, s.id === selectedSourceId, sources)).join("")
```

- [ ] **Step 3: Pass `sources` through to `inspectorHtml`**

`inspectorHtml` (currently `frontend/home-sources.ts:73-117`) doesn't
receive the full sources list, only the selected one — but the color
picker's "active" swatch needs `resolveSourceColorKey`, which needs the
full list to compute the auto-cycle position. Add a parameter. Change the
signature (currently `frontend/home-sources.ts:73`):
```typescript
function inspectorHtml(selected: Source | null, root: string | null): string {
```
to:
```typescript
function inspectorHtml(selected: Source | null, root: string | null, allSources: Source[]): string {
```
Then find `inspectorHtml`'s call site inside `renderHomeSources` (search
for `inspectorHtml(` in the file) and pass the sources array through:
`inspectorHtml(selected, root, sources)`.

- [ ] **Step 4: Add the color picker to the detail panel**

Add a color-swatch picker right before the existing "Surveiller ce
dossier" / "Retirer" row. Replace the block starting at
`` `<div style="display:flex;align-items:center;gap:10px">` `` (line 109)
through its closing `` `</div>` `` (line 114) with:
```typescript
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">` +
    `<span style="font-size:var(--text-sm);color:var(--color-text-tertiary)">Couleur</span>` +
    SOURCE_HUE_CYCLE.map(
      (hue) =>
        `<button data-sift="setsrccolor" data-id="${selected.id}" data-hue="${hue}" title="${hue}" aria-label="Couleur ${hue}" class="sift-src-swatch sift-src-swatch-${hue}${resolveSourceColorKey(allSources, selected) === hue ? " on" : ""}"></button>`,
    ).join("") +
    `</div>` +
    `<div style="display:flex;align-items:center;gap:10px">` +
    `<div data-sift="togglewatch" data-id="${selected.id}" data-watched="${watchOn ? "1" : "0"}" style="display:flex;align-items:center;gap:8px;font-size:var(--text-md);padding:8px 13px;border-radius:var(--border-radius-md);background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);cursor:pointer;color:var(--color-text-secondary)">` +
    `<span style="width:15px;height:15px;border-radius:4px;border:1px solid var(--color-border-secondary);background:${watchOn ? "var(--color-text-success)" : "transparent"};flex:none"></span>` +
    `Surveiller ce dossier</div>` +
    `<button data-sift="rmsrc" data-id="${selected.id}" style="color:var(--color-text-danger)"><i class="ti ti-trash" style="font-size:var(--text-md);vertical-align:-2px"></i> Retirer</button>` +
    `</div>` +
    `</div>`
```

- [ ] **Step 5: Wire the click handler**

In `frontend/sift-live.ts`, right after the existing `togglewatch` branch
(currently ends around line 2047, see the block containing
`} else if (act === "togglewatch") { ... }`), add:
```typescript
    } else if (act === "setsrccolor") {
      e.stopPropagation();
      const hue = el.dataset.hue ?? null;
      void setSourceColor(Number(el.dataset.id), hue).then(refresh);
```
Add `setSourceColor` to the existing import from `./ipc` at the top of
`frontend/sift-live.ts` (find the line importing `setSourceWatched` and add
`setSourceColor` alongside it).

- [ ] **Step 6: Add the CSS**

In `frontend/styles.css`, add near `.sift-genre-chip-*` (from Task 3) or
any convenient spot with the other small-indicator rules:
```css
.sift-src-dot{width:7px;height:7px;border-radius:999px;flex:none}
.sift-src-dot-indigo{background:var(--color-hue-indigo-text)}
.sift-src-dot-purple{background:var(--color-hue-purple-text)}
.sift-src-dot-pink{background:var(--color-hue-pink-text)}
.sift-src-dot-teal{background:var(--color-hue-teal-text)}
.sift-src-dot-yellow{background:var(--color-hue-yellow-text)}
.sift-src-swatch{width:20px;height:20px;border-radius:999px;border:2px solid transparent;padding:0;cursor:pointer}
.sift-src-swatch.on{border-color:var(--color-text-primary)}
.sift-src-swatch-indigo{background:var(--color-hue-indigo-text)}
.sift-src-swatch-purple{background:var(--color-hue-purple-text)}
.sift-src-swatch-pink{background:var(--color-hue-pink-text)}
.sift-src-swatch-teal{background:var(--color-hue-teal-text)}
.sift-src-swatch-yellow{background:var(--color-hue-yellow-text)}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 8: Manual verification in `tauri dev`**

Ask the user to open Accueil with 2+ watched sources and confirm: (1) each
row shows a distinct identity dot next to its name, (2) opening a source's
detail shows 5 color swatches, (3) clicking a swatch updates that source's
dot immediately (via `refresh()`) and persists across an app restart.

- [ ] **Step 9: Commit**

```bash
git add frontend/home-sources.ts frontend/sift-live.ts frontend/styles.css
git commit -m "feat(colors): render source identity color + manual override picker"
```

---

### Task 7: Intégrations nav colors (Rekordbox, Clé USB)

Fixed, non-recycled hues for the two nav items under "Intégrations".

**Files:**
- Modify: `frontend/styles.css:134` (`.nv-export-dot`)
- Modify: `frontend/styles.css` (new rule for the Rekordbox nav icon)

**Interfaces:**
- Consumes (Task 2): `--color-hue-yellow-text`, `--color-hue-teal-text`.

- [ ] **Step 1: Retarget the Clé USB dot**

`frontend/styles.css:134` currently reads:
```css
.nv-export-dot{width:5px;height:5px;border-radius:var(--border-radius-pill);background:var(--color-text-warning);flex:none}
```
It borrowed the warning/amber role generically; give it its own reserved
teal:
```css
.nv-export-dot{width:5px;height:5px;border-radius:var(--border-radius-pill);background:var(--color-hue-teal-text);flex:none}
```

- [ ] **Step 2: Tint the Rekordbox nav icon**

The Rekordbox nav item is `index.html:21`:
`<div class="nv" data-view="rkb" title="Rekordbox"><i class="ti ti-disc" aria-hidden="true"></i><span>Rekordbox</span></div>`
— it's a plain `.nv`, so its icon currently just inherits `.nv`'s neutral
color. Add a targeted rule in `frontend/styles.css`, near `.nv-export-dot`:
```css
.nv[data-view="rkb"] i{color:var(--color-hue-yellow-text)}
```

- [ ] **Step 3: Manual verification in `tauri dev`**

Ask the user to check the nav rail: the Rekordbox disc icon should read
yellow/gold, the Clé USB dot should read teal (not amber).

- [ ] **Step 4: Commit**

```bash
git add frontend/styles.css
git commit -m "feat(colors): give Rekordbox/Clé USB nav items their reserved hues"
```

---

### Task 8: Identifier button — drop the gold, adopt info blue

Removes the bespoke `--color-accent-identify*` tokens and retargets
`.sift-id-btn` onto the same `info` tokens used elsewhere for interactive
elements.

**Files:**
- Modify: `frontend/styles.css` (find `.sift-id-btn` and
  `--color-accent-identify*` — both via grep, exact line numbers shift as
  earlier tasks add lines)

**Interfaces:**
- Consumes (Task 1): `--color-background-info`, `--color-border-info`,
  `--color-text-info`, plus their `:hover` variants already used by
  `.sift-ranger-btn`/`.chip.on` elsewhere.

- [ ] **Step 1: Locate the current rule**

Run: `grep -n "sift-id-btn\|color-accent-identify" frontend/styles.css`
This should surface the `.sift-id-btn` rule and its `:hover` variant, plus
the `--color-accent-identify*` token declarations in `:root` and both dark
blocks (added when this exception was first introduced — see
`docs/design-system-states.md`'s "Bouton Identifier" section for the
history).

- [ ] **Step 2: Retarget `.sift-id-btn`**

Replace the `background`/`border-color`/`color` (and its `:hover`
counterpart) so they reference the `info` triplet instead of the
`accent-identify` one — e.g. if the current rule reads something like
```css
.sift-id-btn{background:var(--color-accent-identify);border-color:var(--color-accent-identify-border);color:var(--color-accent-identify-text);...}
.sift-id-btn:hover{background:var(--color-accent-identify-hover)}
```
change it to:
```css
.sift-id-btn{background:var(--color-background-info);border-color:var(--color-border-info);color:var(--color-text-info);...}
.sift-id-btn:hover{background:var(--color-background-info);filter:brightness(0.95)}
```
(Keep every OTHER property on `.sift-id-btn` — padding, border-radius,
font-weight, etc. — exactly as it is today; only the 4 color-related
declarations change. The `:hover` treatment mirrors the `filter:brightness`
pattern already used elsewhere in this file for secondary interactive
buttons — grep `filter:brightness` for a reference if unsure which existing
rule to copy.)

- [ ] **Step 3: Remove the now-unused tokens**

Delete the `--color-accent-identify` / `-hover` / `-text` / `-border`
declarations from `:root` and BOTH dark blocks (3 deletions total — same 3
locations as every other token in this plan).

- [ ] **Step 4: Confirm nothing else references the removed tokens**

Run: `grep -rn "color-accent-identify" frontend/`
Expected: no matches (if any remain, they're a consumer this step missed —
retarget them too before continuing).

- [ ] **Step 5: Manual verification in `tauri dev`**

Ask the user to open a track without an identified match and confirm the
"Identifier" button now reads in the same blue as the "Ranger" button and
active chips, not gold.

- [ ] **Step 6: Commit**

```bash
git add frontend/styles.css
git commit -m "feat(colors): fold Identifier button into the info/blue role"
```

---

### Task 9: Waveform elapsed color — green to blue

**Files:**
- Modify: `frontend/styles.css` (`--color-waveform-elapsed`)

**Interfaces:**
- Consumes (Task 1): `--color-text-info`.

- [ ] **Step 1: Retarget the token**

Run: `grep -n "color-waveform-elapsed" frontend/styles.css` to find the
exact current line (was `frontend/styles.css:46` as of this plan's
writing: `--color-waveform-elapsed:var(--color-text-success);`). Change
it to:
```css
--color-waveform-elapsed:var(--color-text-info);
```
This token is only declared once (not duplicated per dark block — it
already resolves through `--color-text-info`, which IS theme-aware), so
this is a single-line change.

- [ ] **Step 2: Manual verification in `tauri dev`**

Ask the user to open a track and press play — the played portion of the
waveform should read blue, not green.

- [ ] **Step 3: Commit**

```bash
git add frontend/styles.css
git commit -m "feat(colors): move waveform-elapsed from success green to info blue"
```

---

### Task 10: Backdrop blur on the 2 ephemeral popovers

**Files:**
- Modify: `frontend/styles.css` (`.sift-dest-popover`, new
  `.sift-report-overlay-card-blur` modifier)
- Modify: `frontend/confirm-modal.ts:19` (apply the new modifier class)

**Interfaces:**
- None — pure CSS + one class-name change, no new tokens.

- [ ] **Step 1: Destination popover**

`frontend/styles.css:276` currently reads:
```css
.sift-dest-popover{position:fixed;width:288px;max-height:340px;display:flex;flex-direction:column;padding:10px;background:var(--color-background-secondary);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);overflow-y:auto;z-index:20}
```
Change `background` to a translucent variant and add the blur:
```css
.sift-dest-popover{position:fixed;width:288px;max-height:340px;display:flex;flex-direction:column;padding:10px;background:color-mix(in srgb,var(--color-background-secondary) 70%,transparent);backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);overflow-y:auto;z-index:20}
```
(`color-mix()` is used elsewhere in this file already — grep
`color-mix(in srgb` for existing examples — so it's a safe, already-proven
pattern in this codebase, not a new dependency.)

- [ ] **Step 2: Confirmation overlay card**

`frontend/styles.css:713` currently reads:
```css
.sift-report-overlay-card{background:var(--color-background-primary);color:var(--color-text-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-lg,12px);box-shadow:var(--shadow-overlay)}
```
This class is shared by 3 consumers (`report-view.ts`, `confirm-modal.ts`,
`usb-format-modal.ts`), not just the confirm modal — verified via
`grep -n "sift-report-overlay-card" frontend/*.ts`. Only the confirm modal
is the ephemeral popover this design targets (`report-view.ts`'s overlay
covers a loading/error state that can stay up a while;
`usb-format-modal.ts`'s is a multi-step flow, not a quick confirm) — do
NOT blur the shared base class. Instead, add a modifier class applied only
from `confirm-modal.ts`.

In `frontend/styles.css`, add a new rule right after the existing
`.sift-report-overlay-card` rule (leave that rule untouched):
```css
.sift-report-overlay-card-blur{background:color-mix(in srgb,var(--color-background-primary) 75%,transparent)!important;backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%)}
```
In `frontend/confirm-modal.ts:19`, currently:
```typescript
card.className = "sift-report-overlay-card sift-confirm-card";
```
change to:
```typescript
card.className = "sift-report-overlay-card sift-confirm-card sift-report-overlay-card-blur";
```

- [ ] **Step 3: Manual verification in `tauri dev`**

Ask the user to (1) open the Destination popover and confirm the content
behind it shows through with a blur, (2) trigger a confirmation dialog
(e.g. a destructive action) and confirm the same effect, with text still
legible.

- [ ] **Step 4: Commit**

```bash
git add frontend/styles.css frontend/confirm-modal.ts
git commit -m "feat(materials): blur the Destination popover and confirm overlay"
```

---

### Task 11: Final sweep — types, lints, docs

**Files:**
- Read-only checks across `frontend/`, `src-tauri/`
- Modify: `docs/design-system-states.md` (append entries for the touched
  components, per this project's existing convention of documenting real
  component states there)

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 2: Full Rust test + lint**

(Confirm `tauri dev` is stopped first — see Global Constraints.)
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 3: Grep sweep for leftover stale references**

Run: `grep -rn "color-accent-identify" frontend/ src-tauri/`
Expected: no matches (confirms Task 8's cleanup was complete).

Run: `grep -c "danger.*#8f6318\|danger.*#f2c274" frontend/styles.css`
Expected: `0` (confirms no old shared amber/danger hex survived Task 1 —
these were the exact old shared values).

- [ ] **Step 4: Update `docs/design-system-states.md`**

Append a new dated entry (following the file's existing "Historique des
corrections" convention at the bottom) summarizing: danger/info split into
real red/blue, 5 categorical hues added, genre chips/source dots/nav items
now colored, Identifier button folded into info, waveform elapsed moved to
info, 2 popovers gained blur. Point to
`docs/superpowers/specs/2026-07-06-apple-system-colors-palette-design.md`
for the full rationale rather than repeating it.

- [ ] **Step 5: Commit**

```bash
git add docs/design-system-states.md
git commit -m "docs(design-system): log the Apple system-colors palette rollout"
```

---

## Explicitly out of scope (per the design spec)

- Retroactive sync of `Sift.dc.html`/`app.js` mockups — separate concern,
  not part of this plan.
- Icon-only button styling anywhere — the design spec explicitly rejects
  this for Sift's rail buttons; no task above touches icon-only patterns.
