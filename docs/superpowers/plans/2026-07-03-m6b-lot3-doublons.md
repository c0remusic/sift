# M6b Lot 3 — Doublons internes (Bibliothèque) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user scan the `filed` library for acoustically-identical duplicates (different rips of the same recording) and resolve each group with one click, keeping the best copy.

**Architecture:** A new `scan_library_duplicates(conn)` function in `src-tauri/src/dedup.rs` groups all `filed` tracks into connected components by Chromaprint similarity (reusing the existing fingerprint cache/threshold), computes a `recommend_keep` heuristic per group, and is exposed as the `scan_library_duplicates` Tauri command in `ipc_library.rs`. The frontend adds a "Doublons" chip to the Bibliothèque screen (`frontend/sift-live.ts`) that renders the groups and a "Résoudre" button that reuses the existing `trash_track` command on every non-kept member.

**Tech Stack:** Rust (rusqlite, existing `fingerprint.rs`/`dedup.rs`), TypeScript (vanilla, no framework), Tauri IPC.

## Global Constraints

- MSRV Rust 1.77.2. Tests via `cargo test --manifest-path src-tauri/Cargo.toml`.
- Frontend type-check: `npx tsc --noEmit`. No inline literals for colors/spacing/radius — use the existing `--color-*`/`--text-*`/`--border-radius-*` tokens in `frontend/styles.css`.
- Fail-fast, no silent fallback (project convention, see CLAUDE.md "Méthode").
- Reuse existing patterns: this spec is `docs/superpowers/specs/2026-06-24-m6b-library-design.md`, section "Lot 3".
- **Do not** touch `library_stats`/dashboard — that is a separate plan (Lot 4) that depends on this one landing first (it counts `scan_library_duplicates(conn).len()`).

---

### Task 1: Backend — `scan_library_duplicates` in `dedup.rs`

**Files:**
- Modify: `src-tauri/src/dedup.rs` (add types + function + tests at the end of the file, inside the existing `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `crate::fingerprint::{similarity, MATCH_THRESHOLD}` (existing), private `get_or_compute_fp(conn, track_id, path) -> Option<Vec<u32>>` (existing, same file).
- Produces: `pub struct DupGroupMember { id: i64, path: String, filename: Option<String>, folder: Option<String>, format: Option<String>, bitrate: Option<i64>, duration: Option<f64>, truncated: bool, recommend_keep: bool, reason: Option<String> }`, `pub struct DupGroup { members: Vec<DupGroupMember>, similarity: f32 }`, `pub fn scan_library_duplicates(conn: &Connection) -> rusqlite::Result<Vec<DupGroup>>`. Task 2 (IPC) calls this by fully-qualified path `crate::dedup::scan_library_duplicates`. Task 2 of the Lot 4 plan (future, separate branch) will also call it.

- [ ] **Step 1: Write the failing tests**

Add at the end of `src-tauri/src/dedup.rs`, inside the existing `mod tests` block (after `find_duplicate_none_when_unique`):

```rust
    #[test]
    fn scan_library_duplicates_groups_filed_tracks_by_sound() {
        let (Some(mp3), Some(flac)) = (fixture("real_320.mp3"), fixture("real_lossless.flac"))
        else {
            eprintln!("skip: no fixtures");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.mp3");
        let b = dir.path().join("b.flac");
        std::fs::copy(&mp3, &a).unwrap();
        std::fs::copy(&flac, &b).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format, bitrate, duration) \
             VALUES(?1, 'a.mp3', 'filed', 'mp3', 320, 30.0)",
            params![a.to_str().unwrap()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format, bitrate, duration) \
             VALUES(?1, 'b.flac', 'filed', 'flac', 1411, 30.0)",
            params![b.to_str().unwrap()],
        )
        .unwrap();
        // a lone unrelated filed track must not be grouped
        conn.execute(
            "INSERT INTO tracks(path, filename, status, format) \
             VALUES('/lib/lone.wav', 'lone.wav', 'filed', 'wav')",
            [],
        )
        .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();

        assert_eq!(groups.len(), 1, "only the a/b pair forms a group");
        let g = &groups[0];
        assert_eq!(g.members.len(), 2);
        assert!(g.similarity >= fingerprint::MATCH_THRESHOLD);
        let keep = g.members.iter().find(|m| m.recommend_keep).unwrap();
        assert_eq!(keep.format.as_deref(), Some("flac"), "lossless wins over lossy");
        assert!(keep.reason.is_some());
        assert_eq!(g.members.iter().filter(|m| m.recommend_keep).count(), 1);
    }

    #[test]
    fn scan_library_duplicates_recommend_keep_prefers_higher_bitrate_when_same_lossiness() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(1, '/lib/low.mp3', 'low.mp3', 'filed', 'mp3', 128, 30.0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks(id, path, filename, status, format, bitrate, duration, truncated) \
             VALUES(2, '/lib/high.mp3', 'high.mp3', 'filed', 'mp3', 320, 30.0, 0)",
            [],
        )
        .unwrap();
        // Fake-match the pair directly via a shared cached fingerprint (bypasses real decode).
        let fp = fingerprint::encode(&[1, 2, 3, 4, 5, 6, 7, 8]);
        conn.execute("UPDATE tracks SET fingerprint=?1 WHERE id IN (1,2)", params![fp])
            .unwrap();

        let groups = scan_library_duplicates(&conn).unwrap();

        assert_eq!(groups.len(), 1);
        let keep = groups[0].members.iter().find(|m| m.recommend_keep).unwrap();
        assert_eq!(keep.id, 2, "same lossiness → higher bitrate wins");
    }

    #[test]
    fn scan_library_duplicates_ignores_pending_and_lone_tracks() {
        let conn = db();
        add(&conn, "/dl/pending.mp3", "pending");
        add(&conn, "/lib/lone.flac", "filed");
        let groups = scan_library_duplicates(&conn).unwrap();
        assert!(groups.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dedup::tests::scan_library_duplicates -- --nocapture`
Expected: FAIL with "cannot find function `scan_library_duplicates`" (compile error).

- [ ] **Step 3: Implement the types and function**

Add near the top of `src-tauri/src/dedup.rs`, after the existing `DupMatch` struct:

```rust
/// One member of a duplicate group (a `filed` track acoustically identical to the others).
#[derive(Debug, Clone, Serialize)]
pub struct DupGroupMember {
    pub id: i64,
    pub path: String,
    pub filename: Option<String>,
    pub folder: Option<String>,
    pub format: Option<String>,
    pub bitrate: Option<i64>,
    pub duration: Option<f64>,
    pub truncated: bool,
    pub recommend_keep: bool,
    /// Human-readable reason, set only on the recommended member (e.g. "lossless, 1411 kbps").
    pub reason: Option<String>,
}

/// A group of 2+ `filed` tracks that are acoustically the same recording.
#[derive(Debug, Clone, Serialize)]
pub struct DupGroup {
    pub members: Vec<DupGroupMember>,
    /// Weakest pairwise similarity that linked the group together.
    pub similarity: f32,
}

fn is_lossless_fmt(fmt: &Option<String>) -> bool {
    fmt.as_deref()
        .map(|f| matches!(f.to_lowercase().as_str(), "aiff" | "aif" | "wav" | "flac"))
        .unwrap_or(false)
}

/// Index of the member to recommend keeping: lossless > lossy, then higher bitrate, then
/// longer duration, then non-truncated; ties keep the first occurrence.
fn pick_keep(members: &[DupGroupMember]) -> usize {
    let key = |m: &DupGroupMember| {
        (
            is_lossless_fmt(&m.format),
            m.bitrate.unwrap_or(-1),
            m.duration.map(|d| (d * 1000.0) as i64).unwrap_or(-1),
            !m.truncated,
        )
    };
    let mut best = 0usize;
    for i in 1..members.len() {
        if key(&members[i]) > key(&members[best]) {
            best = i;
        }
    }
    best
}

fn find_root(parent: &mut [usize], x: usize) -> usize {
    if parent[x] != x {
        parent[x] = find_root(parent, parent[x]);
    }
    parent[x]
}

fn union(parent: &mut [usize], a: usize, b: usize) {
    let (ra, rb) = (find_root(parent, a), find_root(parent, b));
    if ra != rb {
        parent[ra] = rb;
    }
}

/// Group every `filed` track into duplicate clusters by acoustic fingerprint similarity
/// (reuses the same cache + threshold as `find_duplicate`). O(n²) fingerprint comparisons —
/// fine at library-browsing scale; revisit only if profiling shows it matters.
pub fn scan_library_duplicates(conn: &Connection) -> rusqlite::Result<Vec<DupGroup>> {
    struct Row {
        id: i64,
        path: String,
        filename: Option<String>,
        folder: Option<String>,
        format: Option<String>,
        bitrate: Option<i64>,
        duration: Option<f64>,
        truncated: bool,
    }
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, folder, format, bitrate, duration, truncated \
         FROM tracks WHERE status='filed'",
    )?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                path: r.get(1)?,
                filename: r.get(2)?,
                folder: r.get(3)?,
                format: r.get(4)?,
                bitrate: r.get(5)?,
                duration: r.get(6)?,
                truncated: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let fps: Vec<Option<Vec<u32>>> = rows
        .iter()
        .map(|r| get_or_compute_fp(conn, r.id, &r.path))
        .collect();

    let n = rows.len();
    let mut parent: Vec<usize> = (0..n).collect();
    let mut min_sim: HashMap<usize, f32> = HashMap::new();
    for i in 0..n {
        let Some(fi) = &fps[i] else { continue };
        for j in (i + 1)..n {
            let Some(fj) = &fps[j] else { continue };
            let s = fingerprint::similarity(fi, fj);
            if s >= fingerprint::MATCH_THRESHOLD {
                union(&mut parent, i, j);
                let root = find_root(&mut parent, i);
                let e = min_sim.entry(root).or_insert(s);
                if s < *e {
                    *e = s;
                }
            }
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find_root(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }

    let mut out = Vec::new();
    for (root, idxs) in groups {
        if idxs.len() < 2 {
            continue;
        }
        let mut members: Vec<DupGroupMember> = idxs
            .iter()
            .map(|&i| {
                let r = &rows[i];
                DupGroupMember {
                    id: r.id,
                    path: r.path.clone(),
                    filename: r.filename.clone(),
                    folder: r.folder.clone(),
                    format: r.format.clone(),
                    bitrate: r.bitrate,
                    duration: r.duration,
                    truncated: r.truncated,
                    recommend_keep: false,
                    reason: None,
                }
            })
            .collect();
        let keep = pick_keep(&members);
        members[keep].recommend_keep = true;
        let lossless = is_lossless_fmt(&members[keep].format);
        members[keep].reason = Some(match members[keep].bitrate {
            Some(b) => format!("{}, {b} kbps", if lossless { "lossless" } else { "lossy" }),
            None => (if lossless { "lossless" } else { "lossy" }).to_string(),
        });
        out.push(DupGroup {
            similarity: *min_sim.get(&root).unwrap_or(&1.0),
            members,
        });
    }
    out.sort_by(|a, b| a.members[0].id.cmp(&b.members[0].id));
    Ok(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dedup:: -- --nocapture`
Expected: PASS (all `dedup` tests, including the 3 new ones; the sound-fixture test may print "skip: no fixtures" and return early if `fixtures/real_320.mp3`/`real_lossless.flac` aren't present locally — that's an existing pattern in this file, not a failure).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dedup.rs
git commit -m "feat(library): add scan_library_duplicates grouping by acoustic fingerprint"
```

---

### Task 2: IPC command + registration

**Files:**
- Modify: `src-tauri/src/ipc_library.rs`
- Modify: `src-tauri/src/lib.rs` (command registration list, near `ipc_library::update_metadata`)

**Interfaces:**
- Consumes: `crate::dedup::{scan_library_duplicates, DupGroup}` (Task 1).
- Produces: Tauri command `scan_library_duplicates` returning `Vec<DupGroup>` (serde JSON to the frontend). Task 3 (frontend) calls this by name via `invoke("scan_library_duplicates")`.

- [ ] **Step 1: Add the command**

In `src-tauri/src/ipc_library.rs`, append after `update_metadata`:

```rust
/// Group `filed` tracks by acoustic fingerprint into duplicate clusters, each with a
/// recommended keeper. Read-only — resolving a group is a plain `trash_track` per loser.
#[tauri::command]
pub fn scan_library_duplicates(
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<crate::dedup::DupGroup>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    crate::dedup::scan_library_duplicates(&conn).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` list containing `ipc_library::update_metadata` and add the new command right after it:

```rust
            ipc_library::update_metadata,
            ipc_library::scan_library_duplicates,
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds with no errors (warnings about unused `path`/`folder`/`filename` fields on `DupGroupMember` are fine if the frontend already needs them — it does, per Task 3).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc_library.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): expose scan_library_duplicates command"
```

---

### Task 3: Frontend — contracts, IPC wrapper, "Doublons" panel

**Files:**
- Modify: `shared/contracts.ts` (add `DupGroupMember`/`DupGroup` mirror types)
- Modify: `frontend/ipc.ts` (add `scanLibraryDuplicates` wrapper)
- Modify: `frontend/sift-live.ts` (add "Doublons" chip + panel + resolve action)

**Interfaces:**
- Consumes: `LibraryTrack`, `esc`, `fmtDur`, `bibState`, `trashTrack` (all already in `sift-live.ts`/`ipc.ts`).
- Produces: nothing consumed by later tasks in this plan (this is the last task).

- [ ] **Step 1: Add mirror types to `shared/contracts.ts`**

Append after `export interface MetadataEdit { ... }`:

```typescript
// ---- M6b Lot 3: internal duplicates (mirror of src-tauri/src/dedup.rs) ----

export interface DupGroupMember {
  id: number;
  path: string;
  filename: string | null;
  folder: string | null;
  format: string | null;
  bitrate: number | null;
  duration: number | null;
  truncated: boolean;
  recommend_keep: boolean;
  reason: string | null;
}

export interface DupGroup {
  members: DupGroupMember[];
  similarity: number;
}
```

- [ ] **Step 2: Add the IPC wrapper to `frontend/ipc.ts`**

Append after `updateMetadata`:

```typescript
/** Scan `filed` tracks for acoustic duplicates, grouped with a recommended keeper. */
export const scanLibraryDuplicates = (): Promise<DupGroup[]> =>
  invoke("scan_library_duplicates");
```

Also add `DupGroup` to the existing `import type { ... } from "../shared/contracts"` (or the type-only import block) at the top of `frontend/ipc.ts` if types are imported there for return-type annotations — check the file's existing import style for `LibraryTrack`/`LibraryFacets` and mirror it exactly.

- [ ] **Step 3: Wire the "Doublons" chip and panel in `frontend/sift-live.ts`**

Import at the top (alongside the existing `listLibrary, libraryFolders` import block):

```typescript
  scanLibraryDuplicates,
```

and alongside the existing `LibraryTrack, LibraryFacets, LibraryFilter` type import:

```typescript
  DupGroup,
```

Add module-level state near `bibState` (same section, ~line 122):

```typescript
// Doublons internes panel state (Bibliothèque). `null` = not run yet this session.
let dupGroups: DupGroup[] | null = null;
let dupLoading = false;
let dupShown = false; // toggled by the "Doublons" chip
```

Add a `dupGroupHtml` renderer function near `qualPill`/`verdictBadge` (~line 1097):

```typescript
function dupMemberHtml(m: import("../shared/contracts").DupGroupMember): string {
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
  return (
    `<div class="sift-dup-group" style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:8px">` +
    g.members.map((m) => dupMemberHtml(m)).join("") +
    `<div style="margin-top:6px"><button class="lk" data-bib="dupresolve" data-idx="${idx}">Résoudre</button></div>` +
    `</div>`
  );
}
```

Modify the chips row in `renderBiblioLive` (~line 1113-1119) to add a 4th chip after `mp3`:

```typescript
  const chips = (["all", "lossless", "mp3"] as const)
    .map((q) => {
      const on = (bibState.filter.quality ?? "all") === q;
      const label = q === "all" ? "Tous" : q === "lossless" ? "Lossless" : "MP3";
      return `<span class="chip${on ? " on" : ""}" data-bib="qual" data-q="${q}">${label}</span>`;
    })
    .join("") +
    `<span class="chip${dupShown ? " on" : ""}" data-bib="dupscan">Doublons</span>`;
```

Insert the duplicates panel into the rendered content, right before the closing `</div></div>` of the two-column layout (~line 1170), only when `dupShown`:

```typescript
  const dupSection = !dupShown
    ? ""
    : dupLoading
      ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Scan en cours…</div>`
      : dupGroups === null
        ? ""
        : dupGroups.length === 0
          ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun doublon.</div>`
          : `<div style="margin-top:10px">${dupGroups.map((g, i) => dupGroupHtml(g, i)).join("")}</div>`;
```

and append `dupSection` right before `<div id="bibplayer"></div></div></div>` in the template string.

- [ ] **Step 4: Wire the click handlers**

In the delegated `[data-bib]` handler (~line 1298 onward, inside `installLiveWiring`), add two new branches alongside the existing `if (act === "qual")` / `else if (act === "facet")` chain:

```typescript
      } else if (act === "dupscan") {
        dupShown = !dupShown;
        if (dupShown && dupGroups === null) {
          dupLoading = true;
          void renderBiblioLive();
          void scanLibraryDuplicates()
            .then((groups) => {
              dupGroups = groups;
            })
            .catch((e) => {
              console.error("scan_library_duplicates failed", e);
              dupGroups = [];
            })
            .finally(() => {
              dupLoading = false;
              void renderBiblioLive();
            });
        } else {
          void renderBiblioLive();
        }
      } else if (act === "dupresolve") {
        const idx = Number(bibEl.dataset.idx);
        const group = dupGroups?.[idx];
        if (!group) return;
        const losers = group.members.filter((m) => !m.recommend_keep).map((m) => m.id);
        void Promise.all(losers.map((id) => trashTrack(id)))
          .then(() => {
            dupGroups = (dupGroups || []).filter((_, i) => i !== idx);
            return renderBiblioLive();
          })
          .catch((e) => console.error("dupresolve failed", e));
      }
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual run verification**

This UI is Tauri-gated (`sift-live.ts` only runs inside the real app, per CLAUDE.md — the Vite browser preview only exercises `app.js`). Per project convention, ask the user to verify in `npm run tauri dev`: open Bibliothèque with at least two on-disk duplicate files filed, click "Doublons", confirm the group + recommended badge appear, click "Résoudre", confirm the non-recommended file(s) move to Écartés/trash and the group disappears.

- [ ] **Step 7: Commit**

```bash
git add shared/contracts.ts frontend/ipc.ts frontend/sift-live.ts
git commit -m "feat(library): Doublons internes panel (scan + résoudre)"
```
