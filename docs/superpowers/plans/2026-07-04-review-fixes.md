# Review Fixes (Queue Virtualization, Playback Error Banner, Confirm Overlay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 3 code-level defects from the 2026-07-04 Steve Jobs design review: the `#ql` queue freeze at 7000+ tracks, the silent playback-failure state, and the 3 remaining `window.confirm()` sites.

**Architecture:** Windowed virtualization for `#ql` (measure row height once, render only the visible slice + spacers, move ↑/↓ keyboard nav from DOM-walking to index-stepping); a small `.sift-player-error` banner wired into the existing `mountPlayer` error handler; a single reusable `confirmAction()` overlay replacing all 3 `window.confirm()` call sites.

**Tech Stack:** TypeScript (Vite, vanilla, no framework), Tauri v2 IPC, no frontend test runner (verification = `npx tsc --noEmit` + manual check in `tauri dev`, per project convention).

## Global Constraints

- Design source: `docs/superpowers/specs/2026-07-04-review-fixes-design.md` — every task below implements one bullet of that spec; do not deviate from it without updating the spec first.
- No frontend unit-test framework exists (`package.json` scripts: `dev`/`build`/`preview`/`tauri` only) — every task's verification is `npx tsc --noEmit` clean + a described manual check, never a fabricated test file.
- Never use `window.confirm()`/`alert()`/`prompt()` for anything destructive (CLAUDE.md) — Task 6-8 exist specifically to remove the last 3 offenders.
- Measure real values, never assume them (CLAUDE.md convention already used for the spectrogram canvas width and the destination-popover position) — row height for virtualization must be measured via `getBoundingClientRect()`, not hardcoded.
- Click delegation for queue rows is already on `#pa` (`sift-live.ts:1406-1425`) — do not add per-row listeners.
- Commit after every task with a message describing the fix, no bundling across tasks.

---

### Task 1: Extract `queueRowHtml` and hoist `verdictWord` (pure refactor, no behavior change)

**Files:**
- Modify: `frontend/sift-live.ts:196-233`

**Interfaces:**
- Produces: `function verdictWord(v: string | null): [string, string]` (module scope), `function queueRowHtml(it: QueueItem, active: boolean): string` (module scope) — both consumed by Task 2's `renderQueueWindow`.

- [ ] **Step 1: Hoist `verdictWord` out of `renderQueue` to module scope**

Currently defined as a local `const` inside `renderQueue` (`sift-live.ts:196-203`). Move it above `renderQueue` (right after the existing `verdictDot` function, which ends around line 160) as a plain top-level function:

```ts
function verdictWord(v: string | null): [string, string] {
  return v === "fake"
    ? ["faux", "var(--color-text-warning)"]
    : v === "grey"
      ? ["à vérifier", "var(--color-text-warning)"]
      : v === "ok"
        ? ["", "var(--color-text-success)"]
        : ["analyse…", "var(--color-text-tertiary)"];
}
```

Delete the local `const verdictWord = (v: string | null): [string, string] => (...)` block from inside `renderQueue`.

- [ ] **Step 2: Extract `queueRowHtml` from the inline `.map()` in `renderQueue`**

Replace the `items.map((it) => { ... }).join("")` body (`sift-live.ts:206-231`) with a call to a new top-level function. Add this function right after the hoisted `verdictWord`:

```ts
/** One queue row's markup. `active` stamps the `.cur` highlight at creation time — required so
 * the highlight survives virtualization (Task 2): once #ql only mounts the visible window, a
 * row for the open track may not exist in the DOM to be found and classed after the fact. */
function queueRowHtml(it: QueueItem, active: boolean): string {
  const [word, wordColor] = verdictWord(it.verdict);
  const title = esc(it.filename || it.path);
  const artist = it.artist ? esc(it.artist) : "";
  return (
    `<div class="qi${active ? " cur" : ""}" data-id="${it.id}" data-path="${esc(it.path)}" title="Écouter et ranger" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px 7px">` +
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
    `<div style="display:flex;align-items:center;gap:6px;min-width:0">` +
    verdictDot(it.verdict) +
    `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500">${title}</span>` +
    (it.dup
      ? '<span title="Doublon possible (même nom)" style="flex:none;display:inline-flex;align-items:center;font-size:var(--text-base);line-height:1;color:var(--color-text-warning)">⧉</span>'
      : "") +
    `</div>` +
    `<div style="padding-left:15px;font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${artist || "&nbsp;"}</div>` +
    `</div>` +
    (word
      ? `<span style="flex:none;font-size:var(--text-xs);color:${wordColor}">${word}</span>`
      : "") +
    `</div>`
  );
}
```

For now, keep `renderQueue`'s existing behavior unchanged — replace only the `.map()` line to call the new function, still rendering ALL items (virtualization comes in Task 2):

```ts
  ql.innerHTML =
    items.map((it) => queueRowHtml(it, false)).join("") ||
    '<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">File vide.</div>';
```

(`active` is hardcoded `false` here — Task 2 replaces this whole block with the windowed renderer, which computes `active` correctly. This intermediate state is a pure extraction step, verified before the bigger behavioral change.)

- [ ] **Step 3: Verify no regression**

Run: `npx tsc --noEmit` from the project root.
Expected: no errors.

Then in `tauri dev` (already running or start via the existing dev workflow): open Revue with any pending tracks, confirm the queue list renders identically to before (rows, verdict dots, artist line, dup badge) — the only expected visual change is the `.cur` highlight temporarily not appearing on any row (since `active` is hardcoded `false` here); that's expected and fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "$(cat <<'EOF'
refactor: extract queueRowHtml + hoist verdictWord in sift-live.ts

Pure extraction, no behavior change yet — prepares for windowed queue
virtualization (Task 2 of docs/superpowers/plans/2026-07-04-review-fixes.md).
EOF
)"
```

---

### Task 2: Windowed virtualization of `#ql`

**Files:**
- Modify: `frontend/sift-live.ts` (the `renderQueue` function and its surrounding module scope, and the `.qi[data-id]` click handler inside `installLiveWiring`)

**Interfaces:**
- Consumes: `queueRowHtml(it, active)`, `verdictWord` from Task 1.
- Produces: `let currentOpenId: number | null` (module variable), `function measureQueueRowHeight(ql: HTMLElement): number`, `function renderQueueWindow(ql: HTMLElement): void` — both consumed by Task 3 (scroll listener) and Task 4 (`stepQueueSelection`).

- [ ] **Step 1: Add the row-height measurement helper and the `currentOpenId` tracking variable**

Add near the top of `sift-live.ts`, close to the existing `let currentItems: QueueItem[] = [];` (line 89):

```ts
// Single source of truth for which queue row shows `.cur` — NOT read from filing.ts's internal
// state (would risk a race: filing.ts may set its own state before this module's DOM catches up).
// Updated in 3 places: the row click handler, renderQueue's touchDetail branch (via syncDetail's
// return value), and stepQueueSelection (Task 4).
let currentOpenId: number | null = null;

const QUEUE_ROW_BUFFER = 15; // rows rendered above/below the visible window
let queueRowHeightCache: number | null = null;

/** Real rendered height of a queue row, measured once via an offscreen probe (never assumed —
 * same discipline as the spectrogram canvas width / destination-popover positioning elsewhere in
 * this codebase). Cached: the row markup/CSS don't change at runtime. */
function measureQueueRowHeight(ql: HTMLElement): number {
  if (queueRowHeightCache != null) return queueRowHeightCache;
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.cssText += ";display:flex;align-items:center;gap:8px;padding:5px 7px;width:100%";
  probe.innerHTML =
    `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
    `<div style="display:flex;align-items:center;gap:6px;min-width:0"><span style="flex:1">probe</span></div>` +
    `<div style="padding-left:15px;font-size:var(--text-xs)">&nbsp;</div></div>`;
  ql.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  queueRowHeightCache = h > 0 ? h : 34; // 34px fallback: never divide by zero if measured off-DOM
  return queueRowHeightCache;
}
```

- [ ] **Step 2: Add `renderQueueWindow`**

Add right after `measureQueueRowHeight`:

```ts
/** Renders only the rows within the visible scroll window (+ QUEUE_ROW_BUFFER above/below) into
 * `ql`, framed by two spacer divs so the scrollbar stays proportional to the full list. Fixes the
 * 7000+-track freeze (memory: sift-large-queue-black-screen) — rebuilding thousands of DOM nodes
 * on every 300ms analysis-progress redraw (see the onAnalysisChanged listener further down) was
 * the actual cost, not just paint. */
function renderQueueWindow(ql: HTMLElement): void {
  const items = currentItems;
  if (!items.length) {
    ql.innerHTML =
      '<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">File vide.</div>';
    return;
  }
  const rowH = measureQueueRowHeight(ql);
  const viewportH = ql.clientHeight || 400;
  const start = Math.max(0, Math.floor(ql.scrollTop / rowH) - QUEUE_ROW_BUFFER);
  const visibleCount = Math.ceil(viewportH / rowH) + QUEUE_ROW_BUFFER * 2;
  const end = Math.min(items.length, start + visibleCount);
  // Batch mode never shows a "current" row in the queue rail — matches pre-virtualization
  // behavior exactly (a row click always drops back to detail mode first, so a highlighted row
  // while actually IN batch mode never happened before either).
  const highlightId = reviewMode === "batch" ? null : currentOpenId;
  const topSpacer = start * rowH;
  const bottomSpacer = (items.length - end) * rowH;
  let html = topSpacer > 0 ? `<div style="height:${topSpacer}px"></div>` : "";
  for (let i = start; i < end; i++) html += queueRowHtml(items[i], items[i].id === highlightId);
  if (bottomSpacer > 0) html += `<div style="height:${bottomSpacer}px"></div>`;
  ql.innerHTML = html;
}
```

- [ ] **Step 3: Rewire `renderQueue` to use the windowed renderer and update `currentOpenId`**

Replace the body of `renderQueue` (`sift-live.ts:168-256`, as modified by Task 1) so the `.cur` bookkeeping moves into `currentOpenId` and the render call becomes windowed. Full replacement:

```ts
async function renderQueue(touchDetail = true) {
  const ql = document.getElementById("ql");
  if (!ql) return;
  if (!ql.childElementCount) {
    ql.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 7px;color:var(--color-text-tertiary);font-size:var(--text-md)">' +
      '<i class="ti ti-loader sift-spin" style="font-size:var(--text-md)"></i> Chargement…</div>';
  }
  let items: QueueItem[] = [];
  try {
    items = await listQueue();
  } catch (e) {
    console.error("listQueue failed", e);
    return;
  }
  currentItems = items;
  ensureReviewSeg();

  const fldz = requireEl("#fldz", "renderQueue");
  void refreshBins(fldz);

  if (touchDetail) {
    if (reviewMode === "batch") {
      renderBatch();
    } else {
      const mid = requireEl("#mid", "renderQueue");
      if (mid) {
        currentOpenId = syncDetail(mid, items);
      }
    }
  }
  renderQueueWindow(ql);
}
```

(The scroll listener wiring — `ensureQueueScroll(ql)` — is added in Task 3, not here, to keep this step's diff focused on the windowing logic itself.)

- [ ] **Step 4: Update the `.qi[data-id]` click handler to use `currentOpenId` instead of manual `classList` manipulation**

In `installLiveWiring` (`sift-live.ts:1406-1425`), replace:

```ts
      const item = currentItems.find((it) => it.id === id);
      const mid = requireEl("#mid", "qi-click");
      // highlight the active row
      document.querySelectorAll(".qi.cur").forEach((n) => n.classList.remove("cur"));
      qi.classList.add("cur");
      clearTimeout(queueSelectTimer);
```

with:

```ts
      const item = currentItems.find((it) => it.id === id);
      const mid = requireEl("#mid", "qi-click");
      currentOpenId = id;
      const ql = document.getElementById("ql");
      if (ql) renderQueueWindow(ql);
      clearTimeout(queueSelectTimer);
```

(This removes the direct `classList` manipulation on `qi` — with virtualization, the clicked node itself is fine to reuse, but going through `renderQueueWindow` keeps a single code path for `.cur` bookkeeping, consistent with every other update site.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

In `tauri dev`, with a real (even small) pending queue: confirm clicking a row highlights it (`.cur`), confirm the detail pane opens correctly, confirm switching to Batch mode and back to Detail doesn't leave a stray highlighted row while in Batch. If a large test library is available, confirm the queue no longer freezes (scroll may not yet be smooth — the scroll listener is Task 3 — but the initial render and re-renders during a scan should no longer hang).

- [ ] **Step 6: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "$(cat <<'EOF'
fix: virtualize #ql queue rendering to stop the 7000+-track freeze

renderQueue() rebuilt the full track list's innerHTML on every poll/event
(~300ms during an active scan) — the actual freeze cost (memory:
sift-large-queue-black-screen), not just paint. Now only the visible window
(+ buffer) is rendered, framed by spacer divs to keep scrollbar proportions
correct. .cur highlighting moves to a single currentOpenId variable so it
survives virtualization (a row for the open track may not exist in the DOM
when scrolled away).
EOF
)"
```

---

### Task 3: Scroll listener for the virtualized window

**Files:**
- Modify: `frontend/sift-live.ts`

**Interfaces:**
- Consumes: `renderQueueWindow(ql)` from Task 2.
- Produces: `function ensureQueueScroll(ql: HTMLElement): void`, called from `renderQueue`.

- [ ] **Step 1: Add `ensureQueueScroll`**

Add right after `renderQueueWindow`:

```ts
let queueScrollWired = false;
/** One-time (guarded) scroll listener on #ql, rAF-throttled: re-renders the visible window on
 * scroll without doing so on every fired scroll event (which can be dozens per second). */
function ensureQueueScroll(ql: HTMLElement): void {
  if (queueScrollWired) return;
  queueScrollWired = true;
  let ticking = false;
  ql.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      renderQueueWindow(ql);
    });
  });
}
```

- [ ] **Step 2: Call it from `renderQueue`**

In `renderQueue` (as left by Task 2 Step 3), add the call right after `renderQueueWindow(ql);`:

```ts
  renderQueueWindow(ql);
  ensureQueueScroll(ql);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

In `tauri dev` with a queue long enough to scroll (if no large test library is available, temporarily shrink `QUEUE_ROW_BUFFER` to 1 and the visible-count math will still exercise the same code path with a small list — revert before committing): scroll the queue up and down, confirm rows appear/disappear correctly at the edges of the window, confirm no visible gap or overlap between rendered rows and spacers, confirm the scrollbar thumb size/position looks proportional to the real list length (not just the rendered slice).

- [ ] **Step 4: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "$(cat <<'EOF'
feat: wire scroll listener for virtualized #ql window

rAF-throttled so the re-render fires at most once per frame during a
scroll, not once per scroll event.
EOF
)"
```

---

### Task 4: Fix ↑/↓ keyboard navigation for a virtualized queue

**Files:**
- Modify: `frontend/filing.ts:1610-1644` (`installFilingKeys`)
- Modify: `frontend/sift-live.ts` (new `stepQueueSelection` export, `installQueueNavKeys`, called from `installLiveWiring`)

**Interfaces:**
- Consumes: `currentItems`, `currentOpenId`, `renderQueueWindow`, `measureQueueRowHeight`, `reviewMode`, `setReviewMode`, `openFilingInto` (already imported in `sift-live.ts` from `./filing`).
- Produces: `export function stepQueueSelection(delta: 1 | -1): void` in `sift-live.ts`.

- [ ] **Step 1: Remove ArrowUp/ArrowDown handling from `filing.ts`'s `installFilingKeys`**

Replace `filing.ts:1614-1644`:

```ts
export function installFilingKeys(): void {
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!state.track) return; // only with a track open (i.e. on Revue)
    if (e.key === " ") {
      e.preventDefault(); // also stops Space from activating a focused button
      togglePlay();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // ↑/↓ moves focus through the live queue: click the prev/next row, which opens it in
      // the detail pane via the #pa delegated handler (reuses the existing open path).
      e.preventDefault();
      const rows = Array.from(document.querySelectorAll<HTMLElement>("#ql .qi"));
      if (!rows.length) return;
      const cur = document.querySelector<HTMLElement>("#ql .qi.cur");
      const i = cur ? rows.indexOf(cur) : -1;
      const next = e.key === "ArrowDown" ? rows[i + 1] : rows[i - 1];
      next?.click();
    } else if (e.key === "Enter") {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-fil="ranger"]')?.click();
    } else if (e.key === "Backspace" || e.key === "x" || e.key === "X") {
      // ⌫ is the model's Discard key; X kept as an alias (matches the visible button hint).
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-fil="resource"],[data-fil="trash"]')?.click();
    } else if (e.key === "i" || e.key === "I") {
      // [m9] I = trigger Identifier (same as clicking the button)
      document.querySelector<HTMLButtonElement>('[data-fil="identifier"]')?.click();
    }
  });
}
```

with:

```ts
export function installFilingKeys(): void {
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!state.track) return; // only with a track open (i.e. on Revue)
    // ArrowUp/ArrowDown: handled by sift-live.ts's installQueueNavKeys, not here. The queue is
    // virtualized (renderQueue only mounts the visible window) — walking `#ql .qi` DOM nodes (the
    // old approach) silently stopped at the edge of whatever happened to be rendered.
    // sift-live.ts already owns currentItems and can step by index instead.
    if (e.key === " ") {
      e.preventDefault(); // also stops Space from activating a focused button
      togglePlay();
    } else if (e.key === "Enter") {
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-fil="ranger"]')?.click();
    } else if (e.key === "Backspace" || e.key === "x" || e.key === "X") {
      // ⌫ is the model's Discard key; X kept as an alias (matches the visible button hint).
      e.preventDefault();
      document.querySelector<HTMLElement>('[data-fil="resource"],[data-fil="trash"]')?.click();
    } else if (e.key === "i" || e.key === "I") {
      // [m9] I = trigger Identifier (same as clicking the button)
      document.querySelector<HTMLButtonElement>('[data-fil="identifier"]')?.click();
    }
  });
}
```

- [ ] **Step 2: Add `stepQueueSelection` and `installQueueNavKeys` in `sift-live.ts`**

Add near the end of the file's function definitions (or right after `renderQueue`/`ensureQueueScroll`):

```ts
let queueStepTimer: ReturnType<typeof setTimeout> | undefined;

/** ArrowUp/ArrowDown queue navigation. Kept separate from filing.ts's installFilingKeys (Space/
 * Enter/Backspace/I) because stepping through a virtualized queue needs currentItems + the
 * ability to scroll a not-yet-rendered row into view — both owned here, not in filing.ts (which
 * would need a circular import to reach them; sift-live.ts already imports from filing.ts, not
 * the reverse). */
export function stepQueueSelection(delta: 1 | -1): void {
  if (!currentItems.length) return;
  const curIndex = currentOpenId != null ? currentItems.findIndex((it) => it.id === currentOpenId) : -1;
  const nextIndex = curIndex + delta;
  if (nextIndex < 0 || nextIndex >= currentItems.length) return;
  const next = currentItems[nextIndex];
  currentOpenId = next.id;
  const ql = document.getElementById("ql");
  if (ql) {
    const rowH = measureQueueRowHeight(ql);
    // Keep the target row inside the rendered window: scroll just enough that nextIndex sits
    // within view, never a full jump-to-top/bottom for a one-row step.
    const rowTop = nextIndex * rowH;
    const rowBottom = rowTop + rowH;
    if (rowTop < ql.scrollTop) ql.scrollTop = rowTop;
    else if (rowBottom > ql.scrollTop + ql.clientHeight) ql.scrollTop = rowBottom - ql.clientHeight;
    renderQueueWindow(ql);
  }
  if (reviewMode === "batch") setReviewMode("detail");
  // Debounced like the row-click handler in installLiveWiring — arrow-key repeat shouldn't fire a
  // full decode load per row flicked through.
  clearTimeout(queueStepTimer);
  queueStepTimer = setTimeout(() => {
    const mid = document.getElementById("mid");
    if (mid) void openFilingInto(mid, next);
  }, 150);
}

/** Guarded so installLiveWiring can call this once even if it ever re-runs. */
let queueNavKeysWired = false;
function installQueueNavKeys(): void {
  if (queueNavKeysWired) return;
  queueNavKeysWired = true;
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (currentOpenId == null) return; // only with a track open, same guard as installFilingKeys
    e.preventDefault();
    stepQueueSelection(e.key === "ArrowDown" ? 1 : -1);
  });
}
```

- [ ] **Step 3: Call `installQueueNavKeys()` from `installLiveWiring`**

In `installLiveWiring` (`sift-live.ts:1368-1379`), add the call right after `installFilingKeys();`:

```ts
  installUndoShortcut();
  installFilingKeys();
  installQueueNavKeys();
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

In `tauri dev` with at least 3-4 pending tracks: press ↓ repeatedly from the first row, confirm it steps through every track in order (not just visible ones — scroll manually to the bottom first, then press ↓ once more and confirm it correctly does nothing at the last track rather than throwing). Press ↑ from the last row back to the first the same way. Confirm the detail pane opens the newly-selected track (after the 150ms debounce) and the `.cur` highlight matches.

- [ ] **Step 5: Commit**

```bash
git add frontend/filing.ts frontend/sift-live.ts
git commit -m "$(cat <<'EOF'
fix: rework ↑/↓ queue navigation for virtualized #ql

installFilingKeys walked #ql .qi DOM nodes to find the next/prev row —
broke once virtualization (Task 2) stopped mounting off-screen rows.
stepQueueSelection (sift-live.ts) now steps by index into currentItems and
scrolls the target row into the rendered window before opening it, instead
of relying on a DOM node existing to .click().
EOF
)"
```

---

### Task 5: Playback error banner

**Files:**
- Modify: `frontend/report-view.ts` (`playerRowHtml`, `mountPlayer`)
- Modify: `frontend/styles.css`

**Interfaces:**
- No new exports — purely internal to `report-view.ts`.

- [ ] **Step 1: Add the hidden error element to `playerRowHtml`**

In `report-view.ts:203-238`, insert a new `.sift-player-error` div right after the `.sift-player-audition` block closes and before `.sift-player-controls` opens:

```ts
function playerRowHtml(name: string, path: string, closeBtn = false): string {
  return (
    `<div class="sift-player-row">` +
    playerHeaderHtml(name, path, closeBtn) +
    `<div class="sift-player-audition">` +
    `<button class="sift-play sift-play-btn" title="Lecture / pause (espace)" aria-label="Lecture / pause (espace)"><i class="ti ti-player-play"></i></button>` +
    `<div class="sift-wave-wrap is-paused">` +
    `<div class="sift-wave sift-player-wave"></div>` +
    `<div class="sift-wave-hover"></div>` +
    `<span class="sift-time-elapsed">0:00</span>` +
    `<span class="sift-time-total">0:00</span>` +
    `</div>` +
    `</div>` +
    `<div class="sift-player-error" hidden></div>` +
    `<div class="sift-player-controls">` +
    `<div class="sift-slider-block">` +
    `<span class="sift-slider-label">Volume</span>` +
    `<div class="sift-slider-track sift-volume-track">` +
    `<div class="sift-slider-rail"></div>` +
    `<div class="sift-slider-fill sift-volume-fill"></div>` +
    `<div class="sift-slider-thumb sift-volume-thumb"></div>` +
    `</div></div>` +
    `<div class="sift-player-spacer"></div>` +
    `<div class="sift-key-block" title="Key-lock : le tempo ne change pas la tonalité (off = varispeed)">` +
    `<span class="sift-slider-label">Key-lock</span>` +
    `<button class="sift-key sift-key-btn">ON</button>` +
    `</div>` +
    `<div class="sift-slider-block">` +
    `<span class="sift-slider-label">Tempo<span class="sift-tempo-out">0%</span></span>` +
    `<div class="sift-slider-track sift-tempo-track" title="Tempo — double-clic = réinitialiser">` +
    `<div class="sift-slider-rail"></div>` +
    `<div class="sift-slider-fill sift-tempo-fill"></div>` +
    `<div class="sift-slider-thumb sift-tempo-thumb"></div>` +
    `</div></div>` +
    `</div></div>`
  );
}
```

(Only the one new line — `<div class="sift-player-error" hidden></div>` — changes; everything else in this function stays byte-identical.)

- [ ] **Step 2: Wire it in `mountPlayer`**

In `mountPlayer` (`report-view.ts:462-471`), add the element lookup alongside the other `root.querySelector` calls at the top of the function:

```ts
  const container = requireEl<HTMLElement>(".sift-wave", "mountPlayer", root);
  const playBtn = root.querySelector<HTMLButtonElement>(".sift-play");
  const tempoOut = root.querySelector<HTMLElement>(".sift-tempo-out");
  const volumeTrack = root.querySelector<HTMLElement>(".sift-volume-track");
  const volumeFill = root.querySelector<HTMLElement>(".sift-volume-fill");
  const volumeThumb = root.querySelector<HTMLElement>(".sift-volume-thumb");
  const tempoTrack = root.querySelector<HTMLElement>(".sift-tempo-track");
  const tempoFill = root.querySelector<HTMLElement>(".sift-tempo-fill");
  const tempoThumb = root.querySelector<HTMLElement>(".sift-tempo-thumb");
  const errorEl = root.querySelector<HTMLElement>(".sift-player-error");
```

Update the `ws.on("ready", ...)` handler (`report-view.ts:578-581`) to clear the banner on a real success:

```ts
  ws.on("ready", () => {
    applyRate();
    updateTime();
    if (errorEl) errorEl.hidden = true;
  });
```

Update the `ws.on("error", ...)` handler (`report-view.ts:660-666`) to show it:

```ts
  ws.on("error", (e) => {
    console.error("wavesurfer error", e);
    // route to the Rust log so it shows in the dev console (webview console isn't readable here)
    void invoke("report_smoke", { ok: false, detail: `wavesurfer ${path}: ${String(e)}` });
    // Audio always loads via loadDecoded, which already cascades Web Audio → backend transcode,
    // so there's nothing further to retry here — just surface the error.
    if (errorEl) {
      errorEl.textContent = "Lecture impossible — fichier illisible.";
      errorEl.hidden = false;
    }
  });
```

- [ ] **Step 3: Add the CSS**

In `frontend/styles.css`, right after the existing `.sift-analysis-fail` rule (`styles.css:424`), add:

```css
.sift-player-error{margin:6px 0 0;font-size:var(--text-sm);color:var(--color-text-warning)}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

Manual check in `tauri dev`: open any playable track, confirm no banner shows and playback works as before. Triggering the actual error path requires a file that fails both the Web Audio decode AND the backend transcode fallback — if no such fixture is readily available, verify by temporarily forcing the branch (e.g. add a throwaway `ws.emit` or point `loadDecoded` at a nonexistent path in a scratch test), confirm the banner appears with the expected text, then revert the temporary forcing code before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/report-view.ts frontend/styles.css
git commit -m "$(cat <<'EOF'
fix: surface a visible message on wavesurfer playback failure

ws.on("error") only logged to console + a Rust-side debug channel — the DJ
saw a silently unmoving waveform with no explanation. Adds a
.sift-player-error banner, cleared on the next successful "ready".
EOF
)"
```

---

### Task 6: Shared `confirmAction()` overlay

**Files:**
- Create: `frontend/confirm-modal.ts`
- Modify: `frontend/styles.css`

**Interfaces:**
- Produces: `export function confirmAction(message: string, confirmLabel?: string): Promise<boolean>` — consumed by Task 7 (`filing.ts`) and Task 8 (`journal.ts`).

- [ ] **Step 1: Create `confirm-modal.ts`**

```ts
// Generic in-app confirmation overlay — replaces window.confirm() everywhere in Sift. See
// CLAUDE.md: a real incident happened when a synthetic click ran straight through window.confirm()
// in this Tauri/WebView2 setup with no dialog ever appearing, filing 265 tracks by accident. A
// real DOM button, like every other control in this app, doesn't have that blocking-OS-dialog
// bypass — the returned promise only resolves on an actual click landing inside the webview.
// Lighter than usb-format-modal.ts's typed+armed cycle: that extra friction is reserved for the
// one truly irreversible action (disk format) — everything else stays at today's single-confirm
// friction level, just delivered reliably.
const OVERLAY_ID = "sift-confirm-overlay";

export function confirmAction(message: string, confirmLabel = "Confirmer"): Promise<boolean> {
  document.getElementById(OVERLAY_ID)?.remove();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "sift-report-overlay";

    const card = document.createElement("div");
    card.className = "sift-report-overlay-card sift-confirm-card";

    const msg = document.createElement("div");
    msg.className = "sift-confirm-msg";
    msg.textContent = message;

    const actions = document.createElement("div");
    actions.className = "sift-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sift-settings-btn";
    cancelBtn.textContent = "Annuler";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "sift-confirm-btn";
    confirmBtn.textContent = confirmLabel;
    actions.append(cancelBtn, confirmBtn);

    card.append(msg, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}
```

- [ ] **Step 2: Add the CSS**

In `frontend/styles.css`, right after the `.sift-usbfmt-confirm-btn:disabled` rule (`styles.css:439`), add:

```css
.sift-confirm-card{padding:20px;width:360px;display:flex;flex-direction:column;gap:14px}
.sift-confirm-msg{font-size:var(--text-sm);color:var(--color-text-secondary);white-space:pre-line}
.sift-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.sift-confirm-btn{padding:6px 14px;border-radius:var(--border-radius-md);border:none;background:var(--color-background-info);color:var(--color-text-info);cursor:pointer;font-family:inherit}
```

(`white-space:pre-line` preserves the `\n\n` line break already present in `filing.ts`'s rail-mismatch message, Task 7.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors (this file has no consumers yet — Tasks 7/8 wire it up).

- [ ] **Step 4: Commit**

```bash
git add frontend/confirm-modal.ts frontend/styles.css
git commit -m "$(cat <<'EOF'
feat: add confirmAction() in-app overlay to replace window.confirm()

Reuses the .sift-report-overlay/-card family already used by the report
modal and USB-format modal. A real DOM button doesn't have the OS-dialog
click-bypass that caused the 265-track accidental filing incident.
EOF
)"
```

---

### Task 7: Replace `filing.ts:1312`'s `window.confirm()`

**Files:**
- Modify: `frontend/filing.ts` (import list, and the `doRanger` catch block at line ~1308-1327)

**Interfaces:**
- Consumes: `confirmAction` from Task 6.

- [ ] **Step 1: Add the import**

In `filing.ts`'s import block near the top of the file (alongside the other local-module imports, e.g. next to `import { emptyStateHtml } from "./empty-state";`), add:

```ts
import { confirmAction } from "./confirm-modal";
```

- [ ] **Step 2: Replace the `window.confirm()` call**

In `doRanger`'s catch block (`filing.ts:1308-1327`), replace:

```ts
      } catch (e) {
        const msg = String(e);
        if (!allowRailMismatch && msg.includes("RAIL_MISMATCH")) {
          const ext = (track.path.split(".").pop() || "").toUpperCase();
          const proceed = window.confirm(
            `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
              `le convertir créerait un faux fichier lossless.\n\nRanger quand même ?`,
          );
          if (proceed) {
            allowRailMismatch = true;
            continue;
          }
          // Refus explicite : sortie propre, pas d'erreur, pas de toast — l'utilisateur a choisi
          // de ne rien faire.
          setActionsDisabled(false);
          if (ranger && orig != null) ranger.innerHTML = orig;
          return;
        }
        throw e;
      }
```

with:

```ts
      } catch (e) {
        const msg = String(e);
        if (!allowRailMismatch && msg.includes("RAIL_MISMATCH")) {
          const ext = (track.path.split(".").pop() || "").toUpperCase();
          const proceed = await confirmAction(
            `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
              `le convertir créerait un faux fichier lossless.\n\nRanger quand même ?`,
          );
          if (proceed) {
            allowRailMismatch = true;
            continue;
          }
          // Refus explicite : sortie propre, pas d'erreur, pas de toast — l'utilisateur a choisi
          // de ne rien faire.
          setActionsDisabled(false);
          if (ranger && orig != null) ranger.innerHTML = orig;
          return;
        }
        throw e;
      }
```

(`doRanger` is already `async` and this `catch` sits inside its `for (;;)` loop — `await` inside a `catch` block of an async function is valid JS/TS, no other structural change needed.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

Manual check in `tauri dev`: open a track whose extension claims lossless but whose real content is lossy (or use an existing fixture known to trigger `RAIL_MISMATCH` — check `src-tauri/fixtures/` for one already used by `analysis::decode` tests), attempt to file it, confirm the new overlay appears with the same message text as before, confirm "Annuler" cancels cleanly (rail button restores) and "Confirmer" proceeds to file with the override.

- [ ] **Step 4: Commit**

```bash
git add frontend/filing.ts
git commit -m "$(cat <<'EOF'
fix: replace window.confirm() with confirmAction() for rail-mismatch override

Last remaining window.confirm() outside journal.ts (Task 8) — see
confirm-modal.ts for why this class of dialog is unreliable in this
Tauri/WebView2 setup.
EOF
)"
```

---

### Task 8: Replace `journal.ts`'s 2 remaining `window.confirm()` sites

**Files:**
- Modify: `frontend/journal.ts` (import list, `.jrnl-mass` handler at line ~178-186, `[data-jact='last-batch']` handler at line ~249-268)

**Interfaces:**
- Consumes: `confirmAction` from Task 6.

- [ ] **Step 1: Add the import**

Near the top of `journal.ts`, alongside its existing imports, add:

```ts
import { confirmAction } from "./confirm-modal";
```

- [ ] **Step 2: Replace the mass-revert `window.confirm()`**

In `installDelegate` (`journal.ts:178-186`), replace:

```ts
  root.querySelectorAll<HTMLButtonElement>(".jrnl-mass").forEach(btn => {
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      const catId = btn.dataset.cat!;
      const catEntries = filterByCat(allEntries, catId);
      const totalTracks = catEntries.reduce((s, e) => s + e.track_count, 0);
      const label =
        catId === "filed" ? "Défiler" : catId === "trash" ? "Restaurer" : "Remettre en file";
      if (!window.confirm(`${label} les ${totalTracks} morceaux affichés ?`)) return;
      btn.disabled = true;
```

with:

```ts
  root.querySelectorAll<HTMLButtonElement>(".jrnl-mass").forEach(btn => {
    btn.addEventListener("click", async ev => {
      ev.stopPropagation();
      const catId = btn.dataset.cat!;
      const catEntries = filterByCat(allEntries, catId);
      const totalTracks = catEntries.reduce((s, e) => s + e.track_count, 0);
      const label =
        catId === "filed" ? "Défiler" : catId === "trash" ? "Restaurer" : "Remettre en file";
      if (!(await confirmAction(`${label} les ${totalTracks} morceaux affichés ?`))) return;
      btn.disabled = true;
```

(Only `ev =>` becomes `async ev =>` and the `if` condition awaits `confirmAction` — the rest of the handler, including the async IIFE that follows, is unchanged.)

- [ ] **Step 3: Replace the last-batch `window.confirm()`**

In the same file's delegated click listener (`journal.ts:249-268`), replace:

```ts
  root.addEventListener("click", (ev: MouseEvent) => {
    const t = ev.target as Element;

    // Last-batch revert (confirm only if > 10 tracks)
    const lbBtn = t.closest<HTMLButtonElement>("[data-jact='last-batch']");
    if (lbBtn) {
      const bid = lbBtn.dataset.batchId;
      if (!bid) { console.error("[journal] missing data-batch-id on last-batch"); return; }
      const n = Number(lbBtn.dataset.trackCount ?? 0);
      if (n > 10 && !window.confirm(`Annuler le batch de ${n} morceaux ?`)) return;
      lbBtn.disabled = true;
```

with:

```ts
  root.addEventListener("click", async (ev: MouseEvent) => {
    const t = ev.target as Element;

    // Last-batch revert (confirm only if > 10 tracks)
    const lbBtn = t.closest<HTMLButtonElement>("[data-jact='last-batch']");
    if (lbBtn) {
      const bid = lbBtn.dataset.batchId;
      if (!bid) { console.error("[journal] missing data-batch-id on last-batch"); return; }
      const n = Number(lbBtn.dataset.trackCount ?? 0);
      if (n > 10 && !(await confirmAction(`Annuler le batch de ${n} morceaux ?`))) return;
      lbBtn.disabled = true;
```

(Only the outer arrow function becomes `async` and the `n > 10` condition awaits `confirmAction`; the rest of the listener — the `mode-session`/`mode-all` branches after the `if (lbBtn) { ... return; }` block — is unchanged and still runs synchronously when `lbBtn` is falsy.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`.
Expected: no errors.

Manual check in `tauri dev`: open the Journal view with at least one filed/trashed/requeued batch of tracks. Click the mass-revert button for a category, confirm the overlay appears with the correct track count and label, confirm "Annuler" leaves everything untouched and "Confirmer" performs the revert exactly as before. Repeat for a last-batch revert with more than 10 tracks (confirm the overlay appears) and with 10 or fewer (confirm it still reverts immediately with no dialog, matching the existing `n > 10` threshold).

- [ ] **Step 5: Commit**

```bash
git add frontend/journal.ts
git commit -m "$(cat <<'EOF'
fix: replace journal.ts's 2 remaining window.confirm() with confirmAction()

Completes the removal started in Task 7 (filing.ts) — no window.confirm()/
alert()/prompt() left in the frontend for a destructive/costly action.
EOF
)"
```
