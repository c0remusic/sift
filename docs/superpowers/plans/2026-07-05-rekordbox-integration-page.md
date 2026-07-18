# Rekordbox — page d'intégration dédiée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Rekordbox" from a one-click nav action (click → toast) into a real status/management
screen, moving the existing link-status card out of Bibliothèque and surfacing the previously-invisible
`drift_detected` warning.

**Architecture:** Follows the existing mock/live-hook pattern already used by Bibliothèque/Journal/
Accueil: `app.js`'s `renderRkb()` gets the same `if(!('__TAURI_INTERNALS__' in window)){...}` guard +
`window.__siftRkb()` hook, and a new `renderRekordboxLive()` in `sift-live.ts` renders the real page from
`rekordbox_status()`. No backend/Rust changes — `RekordboxLinkStatus.drift_detected` already exists
server-side, only the TS mirror was missing it.

**Tech Stack:** Vanilla TypeScript (`frontend/*.ts`), vanilla JS mock shell (`frontend/app.js`), static
nav markup (`index.html`), no frontend test framework.

## Global Constraints

- No frontend unit-test framework exists (`package.json` has no test script, no `*.test.ts` files) —
  verification per task is `npx tsc --noEmit` plus a manual check in `tauri dev`. Files gated on
  `__TAURI_INTERNALS__`/imported by `sift-live.ts` are **not exercised by a browser preview** — never
  claim a task verified from a Vite dev-server screenshot alone (CLAUDE.md, "Vérification UI").
  Default: report what to check, let Antoine confirm in his own `tauri dev` window; a CDP screenshot
  (see CLAUDE.md, "Vérification CDP WebView2") is acceptable for one or two targeted checks.
- Spec: `docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md` — every decision
  below traces back to it. Re-read it if a task here seems to contradict it.
- No side-stripe borders (`border-left`/`border-right` as accent) — CLAUDE.md ban, applies to the new
  drift banner.
- Clé USB nav item (`data-view="cle"`) is explicitly **out of scope** — do not touch its markup,
  class, or click behavior in any task below.

---

### Task 1: Add `drift_detected` to the `RekordboxLinkStatus` TS contract

**Files:**
- Modify: `shared/contracts.ts:293-299`

**Interfaces:**
- Produces: `RekordboxLinkStatus.drift_detected: boolean` — consumed by Task 3's
  `renderRekordboxLive()`.

The Rust struct (`src-tauri/src/ipc_library.rs:83-98`) already serializes `drift_detected: bool` (plain
`#[derive(serde::Serialize)]`, no rename — JSON key is `drift_detected`). Only the TS mirror is
missing the field.

- [ ] **Step 1: Add the field**

Current (`shared/contracts.ts:293-299`):
```ts
export interface RekordboxLinkStatus {
  path: string | null;
  linked: boolean;
  playlist_count: number;
  track_count: number;
  error: string | null;
}
```

New:
```ts
export interface RekordboxLinkStatus {
  path: string | null;
  linked: boolean;
  playlist_count: number;
  track_count: number;
  error: string | null;
  /** True when a prior filing/move's Rekordbox repair hit an ambiguous match and could not
   *  safely patch the linked XML — surfaced as a warning banner (see Task 3). */
  drift_detected: boolean;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (additive field — nothing currently reads or constructs a `RekordboxLinkStatus`
object literal in TS, only consumes what the backend sends).

- [ ] **Step 3: Commit**

```bash
git add shared/contracts.ts
git commit -m "feat(rekordbox): mirror drift_detected in the TS contract"
```

---

### Task 2: Add a generic `actionHtml` slot to the shared empty-state component

**Files:**
- Modify: `frontend/empty-state.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EmptyStateOpts.actionHtml?: string` — consumed by Task 3's not-linked state.

`empty-state.ts` currently only supports one fixed CTA ("Aller à Revue →", via `backToRevue`). The
Rekordbox not-linked state needs a different action ("Lier un fichier XML Rekordbox") that already has
a working click handler (`data-bib="rkblink"`, global `#pa` delegate) — so this only needs a markup
slot, no new wiring in `wireEmptyState()`.

- [ ] **Step 1: Extend the interface and markup**

Current (`frontend/empty-state.ts:13-35`):
```ts
export interface EmptyStateOpts {
  /** Short heading, e.g. "Rien dans Écartés". */
  title: string;
  /** One line of explanatory copy. */
  note: string;
  /** Show the "Aller à Revue →" link. Omit for Revue itself — already the entry point. */
  backToRevue?: boolean;
}

/** Markup for the empty state. Insert into the view's content container; call `wireEmptyState`
 *  afterwards (once, on the same container) to hook up the optional back-to-Revue link. */
export function emptyStateHtml(opts: EmptyStateOpts): string {
  const link = opts.backToRevue
    ? `<button type="button" data-empty="revue" class="sift-empty-link">Aller à Revue →</button>`
    : "";
  return (
    `<div class="sift-empty-state">` +
    `<div class="sift-empty-title">${esc(opts.title)}</div>` +
    `<div class="sift-empty-note">${esc(opts.note)}</div>` +
    link +
    `</div>`
  );
}
```

New:
```ts
export interface EmptyStateOpts {
  /** Short heading, e.g. "Rien dans Écartés". */
  title: string;
  /** One line of explanatory copy. */
  note: string;
  /** Show the "Aller à Revue →" link. Omit for Revue itself — already the entry point. */
  backToRevue?: boolean;
  /** Pre-built button/link markup for a screen-specific action (e.g. Rekordbox's "Lier un
   *  fichier XML Rekordbox"). Rendered after the back-to-Revue link, if both are present. The
   *  caller is responsible for its own click wiring (e.g. a `data-bib`/`data-sift` attribute
   *  already handled by an existing delegate) — wireEmptyState() does not touch it. */
  actionHtml?: string;
}

/** Markup for the empty state. Insert into the view's content container; call `wireEmptyState`
 *  afterwards (once, on the same container) to hook up the optional back-to-Revue link.
 *  `actionHtml` (if provided) needs no extra wiring call — the caller already owns its click
 *  handler. */
export function emptyStateHtml(opts: EmptyStateOpts): string {
  const link = opts.backToRevue
    ? `<button type="button" data-empty="revue" class="sift-empty-link">Aller à Revue →</button>`
    : "";
  return (
    `<div class="sift-empty-state">` +
    `<div class="sift-empty-title">${esc(opts.title)}</div>` +
    `<div class="sift-empty-note">${esc(opts.note)}</div>` +
    link +
    (opts.actionHtml ?? "") +
    `</div>`
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. The three existing callers (`filing.ts`, `ecartes-view.ts`, `sift-live.ts`'s
Bibliothèque empty state) don't pass `actionHtml` — optional field, no behavior change for them.

- [ ] **Step 3: Commit**

```bash
git add frontend/empty-state.ts
git commit -m "feat(empty-state): add optional actionHtml slot for a screen-specific CTA"
```

---

### Task 3: Build the live Rekordbox page and retire the Bibliothèque card

**Files:**
- Modify: `frontend/sift-live.ts` (new function, hook, card changes, click handlers, docstring,
  Bibliothèque cleanup)
- Modify: `frontend/app.js` (mock guard + hook call on `renderRkb()`)

**Interfaces:**
- Consumes: `RekordboxLinkStatus.drift_detected` (Task 1), `EmptyStateOpts.actionHtml` (Task 2),
  existing `rekordboxStatus()`/`runNavExport()`/`linkRekordboxXml()` (all already in this file).
- Produces: `renderRekordboxLive(): Promise<void>` (exported nowhere — only assigned to
  `window.__siftRkb`), `window.__siftRkb?: () => void` (global type).

This is one task because the pieces only make sense landing together: removing the nav interception
without the render function existing yet would leave the nav click doing nothing useful, and moving
`data-bib="rkblink"`'s click target away from Bibliothèque only works once Bibliothèque no longer
renders that button.

- [ ] **Step 1: Add the `window.__siftRkb` global type**

Current (`frontend/sift-live.ts:2051-2060`):
```ts
declare global {
  interface Window {
    __siftHome?: () => void;
    __siftQueue?: () => void;
    __siftEcarts?: () => void;
    __siftReglages?: () => void;
    __siftBiblio?: () => void;
    __siftJournal?: () => void;
  }
}
```

New:
```ts
declare global {
  interface Window {
    __siftHome?: () => void;
    __siftQueue?: () => void;
    __siftEcarts?: () => void;
    __siftReglages?: () => void;
    __siftBiblio?: () => void;
    __siftJournal?: () => void;
    __siftRkb?: () => void;
  }
}
```

- [ ] **Step 2: Rewrite `rekordboxCardHtml()` — drop the not-linked branch, add "Réexporter maintenant"**

The not-linked case moves to `emptyStateHtml()` in Step 3 below, so this function now only needs to
handle the two "linked" cases (sain / erreur). Current (`frontend/sift-live.ts:1484-1501`):
```ts
/** The M7 Rekordbox link-status card — same visual family as the M6b stat cards
 * (border+radius token, no accent stripe per the CSS ban on border-left/-right accents). Shows
 * the linked XML path, playlist/track counts, and a "changer de XML lié" action; an explicit
 * error state (unreadable/corrupt file) blocks nothing else on the page, it's just a card state. */
function rekordboxCardHtml(s: RekordboxLinkStatus): string {
  const body = !s.linked
    ? `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun XML Rekordbox lié.</div>`
    : s.error
      ? `<div style="font-size:var(--text-md);color:var(--color-text-danger)">XML Rekordbox illisible — relie un fichier.</div>`
      : `<div style="font-size:var(--text-md)">${esc(s.path || "")}</div>` +
        `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${s.playlist_count} playlists · ${s.track_count} pistes</div>`;
  return (
    `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">` +
    `<div style="min-width:0">${body}</div>` +
    `<button class="lk" data-bib="rkblink" style="flex:none">${s.linked ? "Changer de XML lié" : "Lier un XML Rekordbox"}</button>` +
    `</div>`
  );
}
```

New — **only called with `s.linked === true`** from here on (Step 3 handles `linked === false`):
```ts
/** Rekordbox link-status card, now the Rekordbox page's centerpiece (moved out of Bibliothèque,
 * audit 2026-07-05 — see docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md).
 * Same visual family as the M6b stat cards (border+radius token, no accent stripe per the CSS ban
 * on border-left/-right accents). Only called for `s.linked === true` — the not-linked case is a
 * full empty-state (see renderRekordboxLive). */
function rekordboxCardHtml(s: RekordboxLinkStatus): string {
  const body = s.error
    ? `<div style="font-size:var(--text-md);color:var(--color-text-danger)">XML Rekordbox illisible — relie un fichier.</div>`
    : `<div style="font-size:var(--text-md)">${esc(s.path || "")}</div>` +
      `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${s.playlist_count} playlists · ${s.track_count} pistes</div>`;
  // No "Réexporter" while the linked file is unreadable — the backend already refuses the export
  // in that case (export_rekordbox_xml_inner reads the same path before merging).
  const reexport = s.error
    ? ""
    : `<button class="lk" data-sift="rkbreexport" style="flex:none">Réexporter maintenant</button>`;
  return (
    `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">` +
    `<div style="min-width:0">${body}</div>` +
    `<div style="display:flex;gap:8px;flex:none">${reexport}<button class="lk" data-bib="rkblink" style="flex:none">Changer de XML lié</button></div>` +
    `</div>`
  );
}
```

- [ ] **Step 3: Add `renderRekordboxLive()`**

Add this new function directly after `rekordboxCardHtml()` (same file, `sift-live.ts`):
```ts
/** Rekordbox integration page (data-view="rkb") — real screen replacing the old one-click nav
 * export (audit 2026-07-05, docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md).
 * Renders the whole page fresh each call, same pattern as renderBiblioLive/renderJournal — no mock
 * DOM survives. `drift_detected` is independent of linked/error, so the banner can appear on top
 * of either linked state (never modeled as a 4-way exclusive if/else). */
async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
  } catch (e) {
    console.error("rekordbox_status failed", e);
    content.innerHTML =
      `<div class="h1">Rekordbox</div>` +
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Statut Rekordbox indisponible.</div>`;
    return;
  }

  const intro =
    `<div class="h1">Rekordbox</div>` +
    `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);margin-bottom:12px">` +
    `Sift range tes morceaux → l'export fusionne les nouveaux dans le XML lié → réimporte-le dans Rekordbox pour les voir apparaître.` +
    `</div>`;

  if (!status.linked) {
    content.innerHTML =
      intro +
      emptyStateHtml({
        title: "Aucun XML Rekordbox lié",
        note: "Relie le fichier XML exporté depuis Rekordbox pour commencer à synchroniser tes rangements.",
        actionHtml: `<button class="lk" data-bib="rkblink">Lier un fichier XML Rekordbox</button>`,
      });
    wireEmptyState(content);
    return;
  }

  const driftBanner = status.drift_detected
    ? `<div class="sift-dup-banner" style="background:var(--color-background-warning)">` +
      `<i class="ti ti-alert-triangle" style="color:var(--color-text-warning)"></i>` +
      `<div class="sift-dup-banner-body">` +
      `<div class="sift-dup-banner-head" style="color:var(--color-text-warning)">Une correction de chemin a échoué lors d'un rangement récent</div>` +
      `<div class="sift-dup-banner-where">Vérifie les pistes déplacées dans Rekordbox.</div>` +
      `</div></div>`
    : "";

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status);
}
```

- [ ] **Step 4: Assign the hook in `installLiveWiring()`**

Current (`frontend/sift-live.ts:1668-1674`):
```ts
export function installLiveWiring() {
  window.__siftHome = renderHomeSources;
  window.__siftQueue = renderQueue;
  window.__siftEcarts = renderEcartes;
  window.__siftReglages = () => void renderReglagesLive();
  window.__siftBiblio = () => void renderBiblioLive();
  window.__siftJournal = () => void renderJournal();
```

New:
```ts
export function installLiveWiring() {
  window.__siftHome = renderHomeSources;
  window.__siftQueue = renderQueue;
  window.__siftEcarts = renderEcartes;
  window.__siftReglages = () => void renderReglagesLive();
  window.__siftBiblio = () => void renderBiblioLive();
  window.__siftJournal = () => void renderJournal();
  window.__siftRkb = () => void renderRekordboxLive();
```

- [ ] **Step 5: Stop intercepting "rkb" clicks — only "cle" still fires the one-click toast**

Current (`frontend/sift-live.ts:1684-1699`):
```ts
  // Nav Export (Rekordbox/Clé USB) is a one-click action, not a real screen (renderRkb/renderCle
  // in app.js are unbuilt mock content) — capture phase so this runs BEFORE app.js's own bubble-
  // phase `#pa` listener (registered first, at import time) can switch `view` to the mock screen.
  // stopPropagation() during capture halts the whole path, including that bubble-phase listener.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-view="rkb"],[data-view="cle"]',
      );
      if (!exp) return;
      e.stopPropagation();
      void runNavExport(exp.dataset.view === "cle" ? "usb" : "rekordbox");
    },
    { capture: true },
  );
```

New — only "cle" is still intercepted; "rkb" now navigates to the real page via app.js's own
bubble-phase router (Step 7 gives that router something real to show):
```ts
  // Nav "Clé USB" is still a one-click action, not a real screen (Clé USB's own brainstorm is
  // pending — see docs/ressources-externes.md) — capture phase so this runs BEFORE app.js's own
  // bubble-phase `#pa` listener (registered first, at import time) can switch `view` to the mock
  // screen. stopPropagation() during capture halts the whole path, including that bubble-phase
  // listener. "Rekordbox" is a real page now (renderRekordboxLive, window.__siftRkb above) — its
  // click is left alone so it reaches app.js's router and navigates normally.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>('[data-view="cle"]');
      if (!exp) return;
      e.stopPropagation();
      void runNavExport("usb");
    },
    { capture: true },
  );
```

- [ ] **Step 6: Add the "Réexporter maintenant" click handler**

In the big `[data-sift]` delegate, find the tail of the `if/else if` chain
(`frontend/sift-live.ts`, ends around line 1986-1989):
```ts
    } else if (act === "batchstop") {
      e.stopPropagation();
      onFileStop();
    }
  });
```

New:
```ts
    } else if (act === "batchstop") {
      e.stopPropagation();
      onFileStop();
    } else if (act === "rkbreexport") {
      e.stopPropagation();
      void runNavExport("rekordbox");
    }
  });
```

- [ ] **Step 7: Fix `rkblink`'s post-success refresh — it must no longer target Bibliothèque**

`data-bib="rkblink"` only ever appears on the Rekordbox page after this task (Step 8 removes it from
Bibliothèque) — its success callback must refresh that page, not the screen it used to live on.
Current (`frontend/sift-live.ts:1791-1812`):
```ts
      } else if (act === "rkblink") {
        void (async () => {
          try {
            const chosen = await openFolderDialog({
              multiple: false,
              directory: false,
              filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
            });
            if (!chosen || Array.isArray(chosen)) return;
            const status = await linkRekordboxXml(chosen);
            toast(
              status.error
                ? "XML Rekordbox illisible — relie un autre fichier"
                : `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderBiblioLive();
          } catch (e) {
            console.error("link_rekordbox_xml failed", e);
            toast("Liaison du XML Rekordbox échouée");
          }
        })();
        return;
```

New (only the `void renderBiblioLive();` line changes):
```ts
      } else if (act === "rkblink") {
        void (async () => {
          try {
            const chosen = await openFolderDialog({
              multiple: false,
              directory: false,
              filters: [{ name: "Rekordbox XML", extensions: ["xml"] }],
            });
            if (!chosen || Array.isArray(chosen)) return;
            const status = await linkRekordboxXml(chosen);
            toast(
              status.error
                ? "XML Rekordbox illisible — relie un autre fichier"
                : `XML Rekordbox lié : ${status.track_count} pistes, ${status.playlist_count} playlists`,
            );
            void renderRekordboxLive();
          } catch (e) {
            console.error("link_rekordbox_xml failed", e);
            toast("Liaison du XML Rekordbox échouée");
          }
        })();
        return;
```

- [ ] **Step 8: Remove the card from Bibliothèque**

Current (`frontend/sift-live.ts:1512-1521`, inside `renderBiblioLive`):
```ts
  let facets: LibraryFacets = { folders: [], genres: [] };
  let stats: DashboardStats | null = null;
  let rkbStatus: RekordboxLinkStatus | null = null;
  try {
    [bibState.tracks, facets, stats, rkbStatus] = await Promise.all([
      listLibrary(bibState.filter),
      libraryFolders(),
      libraryStats(),
      rekordboxStatus(),
    ]);
  } catch (e) {
    console.error("library load failed", e);
    return;
```

New:
```ts
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
```

Then remove the card's insertion. Current (`frontend/sift-live.ts:1587-1588`):
```ts
    : (stats ? statsCardsHtml(stats) : "") +
      (rkbStatus ? rekordboxCardHtml(rkbStatus) : "") +
      header +
```

New:
```ts
    : (stats ? statsCardsHtml(stats) : "") +
      header +
```

`RekordboxLinkStatus` stays imported in this file (still used by `rekordboxCardHtml`/
`renderRekordboxLive`'s type annotations) — do not remove that import.

- [ ] **Step 9: Fix the now-stale `runNavExport` docstring**

Current (`frontend/sift-live.ts:599-603`):
```ts
/** Nav "Export" click (Rekordbox/Clé USB, index.html's `.nv-export` items). Rekordbox now runs
 * the REAL merge+rewrite (`export_rekordbox_xml`); USB has no backend (unchanged, out of M7
 * scope — see docs/superpowers/specs/2026-07-03-m7-rekordbox-xml-export-design.md, "hors scope").
 * Doesn't switch screens (see the capture-phase click listener below, which pre-empts app.js's
 * mockup view switch for data-view="rkb"/"cle"). */
```

New:
```ts
/** Rekordbox export (real merge+rewrite via `export_rekordbox_xml`, called from the Rekordbox
 * page's "Réexporter maintenant" button — see renderRekordboxLive) and the "Clé USB" nav click
 * (still a one-click toast, index.html's `.nv-export`/`data-view="cle"` — its own brainstorm is
 * pending). USB formatting DOES have a backend (`ipc_usb.rs`/`usb_format/`) and even a UI (the
 * "Formater une clé USB" card in Réglages, below) — this toast is unrelated to that, just an
 * explainer for why the nav item itself doesn't do anything yet. */
```

- [ ] **Step 10: `app.js` — wrap `renderRkb()`'s mock body, add the live hook call**

Current (`frontend/app.js:213-217`):
```js
  function renderRkb(){block();var filed=cnt("filed"),byF=byFolder();
    var pls=FOLDERS.map(function(f,i){var n=byF[i]||0;return '<div class="srow"><span class="v"><i class="ti ti-playlist"></i> '+f+'</span><span style="font-size:11px;color:'+(n?'var(--color-text-info)':'var(--color-text-tertiary)')+'">'+(n?'+ '+n:'à jour')+'</span></div>';}).join('');
    var action= rkbSynced?'<div style="display:flex;align-items:center;gap:8px;background:var(--color-background-success);border-radius:var(--border-radius-md);padding:12px 15px;margin-bottom:15px;color:var(--color-text-success)"><i class="ti ti-circle-check" style="font-size:18px"></i><span style="font-size:13px;font-weight:500">Rekordbox à jour — '+filed+' synchronisés</span></div>':'<div style="display:flex;align-items:center;justify-content:space-between;background:var(--color-background-info);border-radius:var(--border-radius-md);padding:12px 15px;margin-bottom:15px"><div><div style="font-size:14px;font-weight:500;color:var(--color-text-info)">'+filed+' rangés à pousser</div><div style="font-size:11px;color:var(--color-text-info);opacity:.8">dernière sync : il y a 2 j</div></div><button data-act="rksync">Mettre à jour <i class="ti ti-refresh" style="font-size:12px;vertical-align:-2px"></i></button></div>';
    content.innerHTML='<div class="h1">Rekordbox</div>'+action+'<div class="col-h">Playlists générées</div>'+pls+'<div class="col-h" style="margin-top:14px">Mode</div><div style="display:flex;gap:8px;margin-bottom:12px"><span class="chip on">XML — sûr</span><span class="chip">master.db — natif ⚠️</span></div><div style="display:flex;gap:8px;align-items:flex-start;font-size:11px;color:var(--color-text-warning);background:var(--color-background-warning);border-radius:var(--border-radius-md);padding:9px 12px"><i class="ti ti-alert-triangle" style="font-size:14px;flex:none"></i><span>Ferme Rekordbox avant de synchroniser. En master.db : backup auto.</span></div>';
  }
```

New — mock body unchanged, wrapped in the same guard as `renderBiblio`/`renderJournal`, plus the
hook call at the end:
```js
  function renderRkb(){block();var filed=cnt("filed"),byF=byFolder();
    // Live (Tauri): window.__siftRkb() below (renderRekordboxLive) sets #content.innerHTML fully
    // from real Rekordbox status — this whole block (fake sync state, fake XML/master.db chips)
    // is a wasted mock render immediately clobbered. Same guard as renderRevue/renderBiblio.
    if(!('__TAURI_INTERNALS__' in window)){
    var pls=FOLDERS.map(function(f,i){var n=byF[i]||0;return '<div class="srow"><span class="v"><i class="ti ti-playlist"></i> '+f+'</span><span style="font-size:11px;color:'+(n?'var(--color-text-info)':'var(--color-text-tertiary)')+'">'+(n?'+ '+n:'à jour')+'</span></div>';}).join('');
    var action= rkbSynced?'<div style="display:flex;align-items:center;gap:8px;background:var(--color-background-success);border-radius:var(--border-radius-md);padding:12px 15px;margin-bottom:15px;color:var(--color-text-success)"><i class="ti ti-circle-check" style="font-size:18px"></i><span style="font-size:13px;font-weight:500">Rekordbox à jour — '+filed+' synchronisés</span></div>':'<div style="display:flex;align-items:center;justify-content:space-between;background:var(--color-background-info);border-radius:var(--border-radius-md);padding:12px 15px;margin-bottom:15px"><div><div style="font-size:14px;font-weight:500;color:var(--color-text-info)">'+filed+' rangés à pousser</div><div style="font-size:11px;color:var(--color-text-info);opacity:.8">dernière sync : il y a 2 j</div></div><button data-act="rksync">Mettre à jour <i class="ti ti-refresh" style="font-size:12px;vertical-align:-2px"></i></button></div>';
    content.innerHTML='<div class="h1">Rekordbox</div>'+action+'<div class="col-h">Playlists générées</div>'+pls+'<div class="col-h" style="margin-top:14px">Mode</div><div style="display:flex;gap:8px;margin-bottom:12px"><span class="chip on">XML — sûr</span><span class="chip">master.db — natif ⚠️</span></div><div style="display:flex;gap:8px;align-items:flex-start;font-size:11px;color:var(--color-text-warning);background:var(--color-background-warning);border-radius:var(--border-radius-md);padding:9px 12px"><i class="ti ti-alert-triangle" style="font-size:14px;flex:none"></i><span>Ferme Rekordbox avant de synchroniser. En master.db : backup auto.</span></div>';
    }
    if(window.__siftRkb)window.__siftRkb();
  }
```

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms `renderRekordboxLive`, the new `window.__siftRkb` hook, the edited
`rekordboxCardHtml` signature usage, and the `renderBiblioLive` destructure change all line up.

- [ ] **Step 12: Manual verification in `tauri dev`**

This whole task is gated `inTauri` — a Vite browser preview only shows `app.js`'s mock content, never
this code (CLAUDE.md, "Vérification UI"). Ask Antoine to check, in his own `tauri dev` window:
1. Click "Rekordbox" in the nav → the new page appears (not a toast).
2. With no XML linked: empty state shows "Aucun XML Rekordbox lié" + a working "Lier un fichier XML
   Rekordbox" button (opens the file picker).
3. After linking a valid XML: card shows path + counts, "Réexporter maintenant" and "Changer de XML
   lié" both work.
4. Bibliothèque no longer shows the Rekordbox card at all.
5. If a `REKORDBOX_XML_DRIFT` flag happens to be set (unlikely to hit organically — skip if none is
   set), the warning banner appears above the card.

- [ ] **Step 13: Commit**

```bash
git add frontend/sift-live.ts frontend/app.js
git commit -m "feat(rekordbox): real status page (drift banner, réexport, moved out of Bibliothèque)"
```

---

### Task 4: Nav polish — rename the group, give Rekordbox a real icon

**Files:**
- Modify: `index.html:20-21`

**Interfaces:**
- Consumes: nothing (pure markup).
- Produces: nothing consumed elsewhere.

Separate from Task 3 because it's purely cosmetic — the page works end-to-end after Task 3 even with
the old "Export" label and dimmed dot styling; a reviewer could reject the icon choice here without
touching Task 3's behavior.

- [ ] **Step 1: Rename the group label, give Rekordbox a full `.nv` treatment**

Current (`index.html:20-21`):
```html
      <div class="nv-grp" data-grp="export">Export</div>
      <div class="nv nv-export" data-view="rkb" title="Rekordbox"><span class="nv-export-dot" aria-hidden="true"></span><span>Rekordbox</span></div>
      <div class="nv nv-export" data-view="cle" title="Formater une clé USB"><span class="nv-export-dot" aria-hidden="true"></span><span>Clé USB</span></div>
```

New — group label renamed (the `data-grp="export"` attribute value is left as-is: it's never read by
any script, confirmed via repo-wide grep, so renaming it too would be pure churn); Rekordbox drops
`.nv-export`/the dot for a full-opacity `.nv` with an icon, matching Bibliothèque/Journal; "Clé USB"
is untouched (still `.nv-export`, still a dimmed dot — its own brainstorm is pending):
```html
      <div class="nv-grp" data-grp="export">Intégrations</div>
      <div class="nv" data-view="rkb" title="Rekordbox"><i class="ti ti-disc" aria-hidden="true"></i><span>Rekordbox</span></div>
      <div class="nv nv-export" data-view="cle" title="Formater une clé USB"><span class="nv-export-dot" aria-hidden="true"></span><span>Clé USB</span></div>
```

- [ ] **Step 2: Manual verification**

`index.html` is served raw by Vite (no TS compile step touches it) — a plain browser preview on the
Vite dev server IS sufficient here (this is static markup, not gated `inTauri` behavior): confirm the
nav shows "Intégrations" as the group label, and "Rekordbox" now renders with a disc icon at full
opacity, matching the visual weight of Bibliothèque/Journal above it.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(rekordbox): rename nav group to Intégrations, real icon for Rekordbox"
```
