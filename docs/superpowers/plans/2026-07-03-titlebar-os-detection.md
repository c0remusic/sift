# Titlebar — détection OS + gaps résiduels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 remaining gaps on Sift's custom titlebar (`frontend/chrome.ts`): OS-aware control placement (macOS traffic lights left / Windows controls right), ellipsis+tooltip on the window title, and a dynamic maximize↔restore icon.

**Architecture:** `tauri-plugin-os` is registered backend-side and its synchronous `platform()` JS export drives a CSS-class toggle (`sift-tb-mac`) on the existing titlebar markup — no separate markup function, same buttons/click-wiring, just reordered + restyled under that class. The title span gets `overflow`/`text-overflow` CSS plus a mirrored `title` attribute. The maximize button's icon/label is synced from `getCurrentWindow().isMaximized()` at mount and on every `onResized` event (covers clicks on our own button, double-click on the bar, OS shortcuts, and edge-drag).

**Tech Stack:** Rust (`tauri-plugin-os` 2.3.2), TypeScript (`@tauri-apps/plugin-os` 2.3.2, `@tauri-apps/api/window` already in use), vanilla CSS.

## Global Constraints

- MSRV Rust 1.77.2. `cargo build --manifest-path src-tauri/Cargo.toml` must stay clean.
- Frontend type-check: `npx tsc --noEmit`. No inline color/spacing literals — use the existing `--color-*`/`--text-*` tokens in `frontend/styles.css` (the lean stylesheet injected by `chrome.ts` already follows this).
- Fail-fast, no silent fallback — except the two documented exceptions in the spec: `platform()` failing falls back to the current Windows layout (today's behavior for 100% of users), and `isMaximized()`/`onResized` failing leaves the "Agrandir" state (today's default).
- **Zero regression on Windows**: the existing markup/behavior for non-macOS platforms must render pixel-identical to today after this change (verifiable now, via `npm run tauri dev` on this machine).
- **macOS rendering is not verifiable in this environment** (no Mac available) — ship it correctly per the Tauri docs, but do not claim it's been visually confirmed.
- Spec: `docs/superpowers/specs/2026-07-03-titlebar-os-detection-design.md`.

---

### Task 1: Backend — register `tauri-plugin-os`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:41-42`
- Modify: `package.json`

**Interfaces:**
- Produces: the `platform()` / `type()` / etc. JS API becomes available to the frontend (via the plugin being registered in the Tauri builder). Task 2 consumes `platform()` from `@tauri-apps/plugin-os`.

- [ ] **Step 1: Add the Rust dependency**

In `src-tauri/Cargo.toml`, add this line right after `tauri-plugin-window-state = "2"` (currently line 31):

```toml
tauri-plugin-os = "2.3.2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, the builder chain currently reads (lines 41-42):

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
```

Add the new plugin right after:

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_os::init())
```

- [ ] **Step 3: Add the JS dependency**

In `package.json`, the `dependencies` block currently reads:

```json
  "dependencies": {
    "@fontsource/jetbrains-mono": "^5.2.8",
    "@fontsource/outfit": "^5.2.8",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "wavesurfer.js": "^7.12.8"
  }
```

Add `@tauri-apps/plugin-os` alphabetically after `@tauri-apps/plugin-dialog`:

```json
  "dependencies": {
    "@fontsource/jetbrains-mono": "^5.2.8",
    "@fontsource/outfit": "^5.2.8",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "@tauri-apps/plugin-os": "^2.3.2",
    "wavesurfer.js": "^7.12.8"
  }
```

Then run `npm install` to update `package-lock.json` (or `node_modules` if there's no lockfile committed — check with `git status package-lock.json` first; if it's tracked, `npm install` must regenerate it and it must be included in the commit).

- [ ] **Step 4: Build to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds with no new errors/warnings.

Run: `npx tsc --noEmit`
Expected: no errors (the new package isn't imported yet, this just confirms `npm install` didn't break anything).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs package.json package-lock.json
git commit -m "feat(titlebar): register tauri-plugin-os"
```

---

### Task 2: OS-aware control placement in `chrome.ts`

**Files:**
- Modify: `frontend/chrome.ts:1-6` (imports)
- Modify: `frontend/chrome.ts:98-137` (style block + `injectTitlebar`)

**Interfaces:**
- Consumes: `platform()` from `@tauri-apps/plugin-os` (Task 1), `getCurrentWindow()` (already imported).
- Produces: `injectTitlebar()` becomes `async function injectTitlebar(): Promise<void>` (was sync `function injectTitlebar(): void`) — its one caller, `installLiveWiring()` in `frontend/sift-live.ts`, already does `injectTitlebar();` as a fire-and-forget statement (not awaited) at line ~1218; confirm this still type-checks as a floating promise (it will — TS doesn't require awaiting void-returning-turned-Promise-returning calls unless `no-floating-promises` lint is on, which this project doesn't use per its existing fire-and-forget calls like `void initTheme()` — but since `injectTitlebar()` isn't already wrapped in `void`, add one: `void injectTitlebar();` in that call site to match the codebase's convention of marking intentionally-unawaited promises).

- [ ] **Step 1: Import `platform`**

In `frontend/chrome.ts`, the imports currently read (lines 4-6):

```typescript
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { importPaths } from "./ipc";
```

Add:

```typescript
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { importPaths } from "./ipc";
```

- [ ] **Step 2: Add the macOS CSS**

In `frontend/chrome.ts`, the injected style block currently ends with (lines 98-108):

```typescript
    // custom frameless titlebar (decorations are off in tauri.conf — Tauri only)
    "#sift-titlebar{height:30px;flex:none;display:flex;align-items:center;justify-content:space-between;" +
    "background:var(--color-background-tertiary);-webkit-user-select:none;user-select:none}" +
    "#sift-tb-title{padding-left:13px;font-size:var(--text-sm);letter-spacing:.04em;color:var(--color-text-tertiary)}" +
    "#sift-tb-controls{display:flex;height:100%}" +
    ".sift-win{width:44px;height:100%;display:flex;align-items:center;justify-content:center;border:none;" +
    "background:transparent;color:var(--color-text-tertiary);cursor:pointer;border-radius:0;padding:0}" +
    ".sift-win:hover{background:var(--color-background-secondary);color:var(--color-text-primary)}" +
    ".sift-win-close:hover{background:#e81123;color:#fff}.sift-win i{font-size:15px}" +
    // make room for the 30px bar: shrink the app shell so nothing is clipped
    "#pa{height:calc(100vh - 30px)!important}";
```

Replace the `#sift-tb-title` line (add `overflow`/`text-overflow` for the tooltip task, done together since it's the same selector) and append the mac-specific rules before the final `#pa` line:

```typescript
    // custom frameless titlebar (decorations are off in tauri.conf — Tauri only)
    "#sift-titlebar{height:30px;flex:none;display:flex;align-items:center;justify-content:space-between;" +
    "background:var(--color-background-tertiary);-webkit-user-select:none;user-select:none}" +
    "#sift-tb-title{padding-left:13px;font-size:var(--text-sm);letter-spacing:.04em;color:var(--color-text-tertiary);" +
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}" +
    "#sift-tb-controls{display:flex;height:100%}" +
    ".sift-win{width:44px;height:100%;display:flex;align-items:center;justify-content:center;border:none;" +
    "background:transparent;color:var(--color-text-tertiary);cursor:pointer;border-radius:0;padding:0}" +
    ".sift-win:hover{background:var(--color-background-secondary);color:var(--color-text-primary)}" +
    ".sift-win-close:hover{background:#e81123;color:#fff}.sift-win i{font-size:15px}" +
    // macOS: 3 small round traffic lights on the left instead of square right-aligned buttons.
    // Reuses the same buttons/click-wiring; only placement (markup order) and this styling differ.
    ".sift-tb-mac#sift-titlebar{justify-content:flex-start;gap:8px;padding-left:12px}" +
    ".sift-tb-mac #sift-tb-title{padding-left:12px}" +
    ".sift-tb-mac .sift-win{width:12px;height:12px;border-radius:50%;color:transparent;font-size:0}" +
    ".sift-tb-mac .sift-win:hover{color:inherit;font-size:8px}" +
    ".sift-tb-mac .sift-win[data-win=\"close\"]{background:var(--color-text-danger)}" +
    ".sift-tb-mac .sift-win[data-win=\"min\"]{background:var(--color-text-warning)}" +
    ".sift-tb-mac .sift-win[data-win=\"max\"]{background:var(--color-text-success)}" +
    ".sift-tb-mac .sift-win-close:hover{background:var(--color-text-danger)}" +
    // make room for the 30px bar: shrink the app shell so nothing is clipped
    "#pa{height:calc(100vh - 30px)!important}";
```

(The hover rule reveals the glyph at 8px inside the 12px dot, matching macOS's own hover-reveal convention, using the existing `ti` icons already in the markup rather than inventing new glyphs.)

- [ ] **Step 3: Make `injectTitlebar` OS-aware**

`injectTitlebar` currently reads (lines 114-137):

```typescript
export function injectTitlebar() {
  if (document.getElementById("sift-titlebar")) return;
  const bar = document.createElement("div");
  bar.id = "sift-titlebar";
  bar.setAttribute("data-tauri-drag-region", "");
  bar.innerHTML =
    '<span id="sift-tb-title" data-tauri-drag-region>Sift</span>' +
    '<div id="sift-tb-controls">' +
    '<button class="sift-win" data-win="min" title="Réduire" aria-label="Réduire"><i class="ti ti-minus"></i></button>' +
    '<button class="sift-win" data-win="max" title="Agrandir" aria-label="Agrandir"><i class="ti ti-square"></i></button>' +
    '<button class="sift-win sift-win-close" data-win="close" title="Fermer" aria-label="Fermer"><i class="ti ti-x"></i></button>' +
    "</div>";
  document.body.insertBefore(bar, document.body.firstChild);

  const w = getCurrentWindow();
  bar.querySelectorAll<HTMLElement>(".sift-win").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.win;
      if (act === "min") void w.minimize();
      else if (act === "max") void w.toggleMaximize();
      else if (act === "close") void w.close();
    }),
  );
}
```

Replace it with (adds: async OS detection driving a `sift-tb-mac` class + reordered markup on mac, `title` attribute mirroring the title text, and the maximize/restore icon sync wired to click + `onResized`):

```typescript
/** Bascule l'icône/label du bouton "Agrandir" selon l'état maximisé courant. */
function syncMaxButton(btn: HTMLElement, maximized: boolean): void {
  const label = maximized ? "Restaurer" : "Agrandir";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<i class="ti ${maximized ? "ti-restore" : "ti-square"}"></i>`;
}

export async function injectTitlebar(): Promise<void> {
  if (document.getElementById("sift-titlebar")) return;

  let isMac = false;
  try {
    isMac = platform() === "macos";
  } catch (e) {
    console.error("platform() failed, defaulting to the Windows titlebar layout", e);
  }

  const bar = document.createElement("div");
  bar.id = "sift-titlebar";
  if (isMac) bar.classList.add("sift-tb-mac");
  bar.setAttribute("data-tauri-drag-region", "");
  const title = '<span id="sift-tb-title" data-tauri-drag-region title="Sift">Sift</span>';
  const controls =
    '<div id="sift-tb-controls">' +
    '<button class="sift-win" data-win="min" title="Réduire" aria-label="Réduire"><i class="ti ti-minus"></i></button>' +
    '<button class="sift-win" data-win="max" title="Agrandir" aria-label="Agrandir"><i class="ti ti-square"></i></button>' +
    '<button class="sift-win sift-win-close" data-win="close" title="Fermer" aria-label="Fermer"><i class="ti ti-x"></i></button>' +
    "</div>";
  // macOS: traffic lights first (left); everyone else: title first (left), controls right —
  // matches today's markup order exactly, so non-mac output is byte-identical to before.
  bar.innerHTML = isMac ? controls + title : title + controls;
  document.body.insertBefore(bar, document.body.firstChild);

  const w = getCurrentWindow();
  const maxBtn = bar.querySelector<HTMLElement>('[data-win="max"]');

  bar.querySelectorAll<HTMLElement>(".sift-win").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.win;
      if (act === "min") void w.minimize();
      else if (act === "max") void w.toggleMaximize();
      else if (act === "close") void w.close();
    }),
  );

  if (maxBtn) {
    try {
      syncMaxButton(maxBtn, await w.isMaximized());
      await w.onResized(() => {
        void w.isMaximized().then((m) => syncMaxButton(maxBtn, m));
      });
    } catch (e) {
      console.error("maximize-state sync failed, keeping the default Agrandir icon", e);
    }
  }
}
```

- [ ] **Step 4: Update the call site**

In `frontend/sift-live.ts`, `installLiveWiring()` currently calls `injectTitlebar();` as a plain statement (search with `grep -n "injectTitlebar()" frontend/sift-live.ts`). Since it's now `async`, mark it as an intentionally-unawaited promise to match this codebase's convention (e.g. `void initTheme()` a few lines above it in the same function):

```typescript
  void injectTitlebar();
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual run verification (Windows — verifiable now)**

Ask the user to run `npm run tauri dev` and confirm: the titlebar looks pixel-identical to before (title left, min/max/close right, same icons/hover), minimize/maximize/close still work, and the maximize button's icon/tooltip switches to "Restaurer"/`ti-restore` when the window is maximized (via the button itself, via double-clicking the titlebar, and via dragging the window to the top edge of the screen) and back to "Agrandir"/`ti-square` when restored. Also confirm hovering the (currently static, 4-character) window title still shows the "Sift" native tooltip and nothing looks visually broken.

**Not verifiable here:** the macOS traffic-light layout (`sift-tb-mac` branch) — no Mac available. Note this explicitly when reporting.

- [ ] **Step 7: Commit**

```bash
git add frontend/chrome.ts frontend/sift-live.ts
git commit -m "feat(titlebar): OS-aware control placement, title tooltip, maximize/restore icon"
```
