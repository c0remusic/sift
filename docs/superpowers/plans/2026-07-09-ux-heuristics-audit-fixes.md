# UX Heuristics Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 22 findings from the 2026-07-09 heuristic audit (Krug + Nielsen, `/ux-heuristics`) that are safe frontend-only surgical edits — 5 sévérité 4, 8 sévérité 3, 7 sévérité 2, 2 sévérité 1.

**Architecture:** No new abstractions. Each task edits existing render functions / event handlers in place, reusing patterns already established in the codebase (`confirmAction()`, `.jrnl-banner`, `.sift-toast`, `.sift-seg-thumb` mutate-in-place). Vanilla TS, no framework.

**Tech Stack:** Vanilla TypeScript (`frontend/*.ts`), CSS custom properties (`frontend/styles.css`), Tauri IPC wrappers (`frontend/ipc.ts`) — no new IPC commands needed for any task in this plan.

## Global Constraints

- No frontend unit-test runner exists in this project (vanilla TS, no Jest/Vitest wired). Verification per task is `npx tsc --noEmit` (must stay clean) — **not** a pytest-style red/green cycle. A manual check in the real `tauri dev` window (HMR) remains the final verification for anything gated `inTauri`, done by Antoine per project convention (`CLAUDE.md`, "Vérification UI").
- Tokens only — no inline hex/rgba, reuse `var(--color-*)`/`var(--text-*)`/`var(--space-*)` already in `styles.css`.
- Never `window.confirm()`/`alert()`/`prompt()` — destructive actions go through `confirmAction()` (`frontend/confirm-modal.ts`) per CLAUDE.md.
- Never `.innerHTML =` inside a handler called at high frequency — not applicable to these tasks (all are one-shot user actions), noted for awareness only.
- Commit after each task, one task = one commit, files listed exactly (no `git add -A`).

## Différé (hors scope de ce plan — nécessite plus qu'une retouche UI)

Ces 3 findings de l'audit ne sont **pas** traités ici — chacun demande un changement d'architecture ou de contrat IPC, pas juste une retouche d'écran, donc un risque disproportionné pour ce lot de fixes UX :

- **Sévérité 3 — diff "avant/après" absent sur les synchros metadata master.db** (`shared/contracts.ts:331`, `PendingMetadataSync` n'a pas de champs `old_*`). Nécessite un changement de struct Rust + migration + lecture de la valeur courante côté `sync_track_metadata`. Trigger de réouverture : un chantier dédié M8 Tier 3 UI.
- **Sévérité 1 (élevé au vu du risque)/architectural — vérification proactive du process Rekordbox avant clic** (`sift-live.ts:2581` etc.). Nécessite d'exposer une commande IPC de check léger + un appel asynchrone avant rendu du bouton. Trigger : si un incident réel de ce type se produit.
- **Sévérité 2 — badge nav pour actions Rekordbox en attente** (`sift-live.ts:1337` n'a qu'un badge "revue"). Nécessite soit une marquage HTML statique supplémentaire (nav item Rekordbox) soit un comptage bon marché appelable depuis `refresh()` — les deux dépassent la portée "fix UI ponctuel". Trigger : si le nombre d'actions Rekordbox en attente devient un vrai point de friction rapporté.

---

### Task 1: Corbeille Écartés — confirmation avant purge définitive

**Files:**
- Modify: `frontend/sift-live.ts:2278` (handler `act === "purge"`)
- Modify: `frontend/sift-live.ts` (import list near top — add `confirmAction`)

**Interfaces:**
- Consumes: `confirmAction(message: string, confirmLabel?: string): Promise<boolean>` (already exported by `frontend/confirm-modal.ts`)
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add the `confirmAction` import if not already present**

Check the top of `frontend/sift-live.ts` for an existing `import { confirmAction } from "./confirm-modal";`. If absent, add it next to the other local imports (same style as `frontend/journal.ts:13`).

- [ ] **Step 2: Guard the purge handler with a confirmation**

Before:
```ts
      } else if (act === "purge") {
        void purgeTrash().then(renderEcartes).catch((err) => console.error("purge failed", err));
```

After:
```ts
      } else if (act === "purge") {
        void confirmAction(
          "Purger définitivement la corbeille ? Cette action est irréversible.",
          "Purger",
        ).then((ok) => {
          if (!ok) return;
          void purgeTrash().then(renderEcartes).catch((err) => console.error("purge failed", err));
        });
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "fix(ecartes): confirmer avant purge définitive de la corbeille"
```

---

### Task 2: Écartés — rendre visibles les échecs des actions de ligne

**Files:**
- Modify: `frontend/sift-live.ts:2272-2279` (handlers `trash`/`restore`/`requeue`/`purge`)

**Interfaces:**
- Consumes: `toast(message: string): void` (already defined in the same file, `sift-live.ts:665`)

- [ ] **Step 1: Add a toast on each catch, instead of only `console.error`**

Before:
```ts
      } else if (act === "trash") {
        void trashTrack(id).then(renderEcartes).catch((err) => console.error("trash failed", err));
      } else if (act === "restore") {
        void restoreTrack(id).then(renderEcartes).catch((err) => console.error("restore failed", err));
      } else if (act === "requeue") {
        void requeueTrack(id).then(renderEcartes).catch((err) => console.error("requeue failed", err));
      } else if (act === "purge") {
```

After:
```ts
      } else if (act === "trash") {
        void trashTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("trash failed", err);
            toast("Échec : impossible d'envoyer à la corbeille");
          });
      } else if (act === "restore") {
        void restoreTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("restore failed", err);
            toast("Échec : restauration impossible");
          });
      } else if (act === "requeue") {
        void requeueTrack(id)
          .then(renderEcartes)
          .catch((err) => {
            console.error("requeue failed", err);
            toast("Échec : remise en file impossible");
          });
      } else if (act === "purge") {
```

- [ ] **Step 2: Also toast the purge catch**

Just below (from Task 1's edit), change:
```ts
          void purgeTrash().then(renderEcartes).catch((err) => console.error("purge failed", err));
```
to:
```ts
          void purgeTrash()
            .then(renderEcartes)
            .catch((err) => {
              console.error("purge failed", err);
              toast("Échec : purge de la corbeille impossible");
            });
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "fix(ecartes): afficher un toast quand une action de ligne échoue"
```

---

### Task 3: Écartés — bannière d'échec de chargement + indicateur de liens boutique

**Files:**
- Modify: `frontend/ecartes-view.ts:96-133` (`renderEcartes`, `resRowHtml`)
- Modify: `frontend/styles.css` (`.sift-ec-stores` rule — add a visible affordance)

**Interfaces:**
- Consumes: `emptyStateHtml`/`wireEmptyState` (already imported), `requireEl` (already imported)

- [ ] **Step 1: Show a visible error state instead of a silent early return**

Before:
```ts
  let items: EcarteItem[] = [];
  try {
    items = await listEcartes();
  } catch (e) {
    console.error("listEcartes failed", e);
    return;
  }
```

After:
```ts
  let items: EcarteItem[] = [];
  try {
    items = await listEcartes();
  } catch (e) {
    console.error("listEcartes failed", e);
    content.innerHTML =
      '<div class="h1">Écartés</div>' +
      '<div class="sift-ui-card-soft sift-ui-card-soft-pad" style="color:var(--color-text-danger)">' +
      "Impossible de charger Écartés. Vérifie la connexion à la base et réessaie." +
      "</div>";
    return;
  }
```

- [ ] **Step 2: Add a persistent discoverability hint for the hidden store links**

Find `.sift-ec-stores` in `frontend/styles.css` (grep `sift-ec-stores`). It currently reads roughly:
```css
.sift-ec-stores{visibility:hidden;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.sift-ec-row:hover .sift-ec-stores,.sift-ec-row:focus-within .sift-ec-stores{visibility:visible}
```
Add a small always-visible affordance right before it disappears — a static ellipsis marker that only shows when the row is *not* hovered/focused (mirrors the CDS pattern already used for `.sift-vchip`). In `frontend/ecartes-view.ts`, change the buy-links span wrapper in `resRowHtml` from:
```ts
    ecQuery(it),
  )}" title="Copier" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-secondary)"><i class="ti ti-copy" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copier</button><span class="sift-ec-stores" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px"><span style="color:var(--color-border-secondary)">·</span>${ecStoreLinks(
    it,
  )}</span></div></div>`;
```
to:
```ts
    ecQuery(it),
  )}" title="Copier" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-secondary)"><i class="ti ti-copy" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copier</button><span class="sift-ec-stores-hint" title="Liens boutique (survol ou tab)" aria-hidden="true">···</span><span class="sift-ec-stores" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px"><span style="color:var(--color-border-secondary)">·</span>${ecStoreLinks(
    it,
  )}</span></div></div>`;
```

- [ ] **Step 3: Style the hint and hide it once the real links are visible**

In `frontend/styles.css`, right after the `.sift-ec-stores` rules from Step 2, add:
```css
.sift-ec-stores-hint{font-size:var(--text-xs);color:var(--color-text-tertiary);letter-spacing:.05em}
.sift-ec-row:hover .sift-ec-stores-hint,.sift-ec-row:focus-within .sift-ec-stores-hint{display:none}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/ecartes-view.ts frontend/styles.css
git commit -m "fix(ecartes): bannière d'échec de chargement + indice visible des liens boutique"
```

---

### Task 4: Bibliothèque — reset du filtre verdict, dédup honnête+confirmée, état actif des stat-cards, reset sur 0 résultat, scope du scan doublons, feedback de recherche, unification du toggle Doublons

**Files:**
- Modify: `frontend/sift-live.ts` (Bibliothèque section: `statsCardsHtml`, `dupGroupHtml`, `renderBiblioLive`, the `#pa` delegated handler `act === "stat" | "qual" | "dupresolve" | "dupscan"`)

**Interfaces:**
- Consumes: `confirmAction` (import added in Task 1, reused here), `bibState`, `dupShown`/`dupGroups`/`dupLoading` (module-level state already declared at `sift-live.ts:390-408`)

- [ ] **Step 1: Fix "Tous" chip (`act === "qual"`, `q === "all"`) to also clear the verdict filter**

Before:
```ts
      } else if (act === "qual") {
        const q = bibEl.dataset.q;
        bibState.filter.quality = q === "all" ? undefined : (q as "lossless" | "mp3");
        void renderBiblioLive();
```

After:
```ts
      } else if (act === "qual") {
        const q = bibEl.dataset.q;
        bibState.filter.quality = q === "all" ? undefined : (q as "lossless" | "mp3");
        // "Tous" doit réellement tout montrer — sans ce reset, un filtre verdict=fake posé via le
        // stat-card "À re-sourcer" restait actif indéfiniment (cul-de-sac trouvé à l'audit 2026-07-09).
        if (q === "all") bibState.filter.verdict = undefined;
        void renderBiblioLive();
```

- [ ] **Step 2: Give `dupresolve` an honest label and a confirmation before trashing losing tracks**

In `dupGroupHtml` (`sift-live.ts:1662-1669`), before:
```ts
function dupGroupHtml(g: DupGroup, idx: number): string {
  return (
    `<div class="sift-dup-group" style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:8px">` +
    g.members.map((m) => dupMemberHtml(m)).join("") +
    `<div style="margin-top:6px"><button data-bib="dupresolve" data-idx="${idx}">Résoudre</button></div>` +
    `</div>`
  );
}
```

After:
```ts
function dupGroupHtml(g: DupGroup, idx: number): string {
  const loserCount = g.members.filter((m) => !m.recommend_keep).length;
  return (
    `<div class="sift-dup-group" style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:8px">` +
    g.members.map((m) => dupMemberHtml(m)).join("") +
    `<div style="margin-top:6px"><button data-bib="dupresolve" data-idx="${idx}">Envoyer ${loserCount} doublon${loserCount > 1 ? "s" : ""} à la corbeille</button></div>` +
    `</div>`
  );
}
```

Then in the delegated handler (`sift-live.ts`, `act === "dupresolve"`), before:
```ts
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
```

After:
```ts
      } else if (act === "dupresolve") {
        const idx = Number(bibEl.dataset.idx);
        const group = dupGroups?.[idx];
        if (!group) return;
        const losers = group.members.filter((m) => !m.recommend_keep).map((m) => m.id);
        void confirmAction(
          `Envoyer ${losers.length} doublon${losers.length > 1 ? "s" : ""} à la corbeille ? Le morceau recommandé est conservé.`,
          "Envoyer à la corbeille",
        ).then((ok) => {
          if (!ok) return;
          void Promise.all(losers.map((id) => trashTrack(id)))
            .then(() => {
              dupGroups = (dupGroups || []).filter((_, i) => i !== idx);
              return renderBiblioLive();
            })
            .catch((e) => {
              console.error("dupresolve failed", e);
              toast("Échec : impossible d'envoyer les doublons à la corbeille");
            });
        });
```

- [ ] **Step 3: Show which stat-card is active**

In `statsCardsHtml` (`sift-live.ts:1671-1686`), before:
```ts
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

After (adds an `active(action)` check derived from the same filter state the chips already read):
```ts
function statsCardsHtml(s: DashboardStats): string {
  const activeStat =
    bibState.filter.verdict === "fake"
      ? "fake"
      : dupShown
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
```

- [ ] **Step 4: Add a reset link on "Aucun résultat pour ce filtre"**

In `renderBiblioLive` (`sift-live.ts:2104-2106`), before:
```ts
      (rows ||
        `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun résultat pour ce filtre.</div>`) +
```

After:
```ts
      (rows ||
        `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun résultat pour ce filtre. <button data-bib="stat" data-stat="all" style="font-size:inherit;color:var(--color-text-info);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline">Réinitialiser les filtres</button></div>`) +
```

This reuses the exact same `act === "stat"`/`stat === "all"` handler already wired (Step 1's `bibState.filter.quality/verdict = undefined` path) — no new handler needed. It does not reset `bibState.filter.q`/`.folder`/`.genre`/`dupShown`; scoped intentionally to the verdict/quality cul-de-sac this audit found (search text and facet picks already have their own visible clear affordances — the input can be cleared by the user directly, and facet rows toggle off on re-click, `sift-live.ts:2359-2360`).

- [ ] **Step 5: Note the duplicate scan's real scope (whole library, not the current filter)**

In `renderBiblioLive`, the `dupSection` block (`sift-live.ts:2074-2082`), before:
```ts
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

After:
```ts
  const dupSection = !dupShown
    ? ""
    : dupLoading
      ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Scan en cours (toute la bibliothèque)…</div>`
      : dupGroups === null
        ? ""
        : dupGroups.length === 0
          ? `<div style="margin-top:10px;font-size:var(--text-md);color:var(--color-text-tertiary)">Aucun doublon dans toute la bibliothèque.</div>`
          : `<div style="margin-top:10px"><div style="font-size:var(--text-xs);color:var(--color-text-tertiary);margin-bottom:4px">Doublons détectés dans toute la bibliothèque (pas seulement la vue filtrée actuelle)</div>${dupGroups.map((g, i) => dupGroupHtml(g, i)).join("")}</div>`;
```

- [ ] **Step 6: Add a "Recherche…" state distinct from "Aucun résultat"**

In `renderBiblioLive`, the search input listener (`sift-live.ts:2114-2119`), before:
```ts
  const q = document.getElementById("bibq") as HTMLInputElement | null;
  q?.addEventListener("input", () => {
    bibState.filter.q = q.value || undefined;
    clearTimeout((q as unknown as { _t?: number })._t);
    (q as unknown as { _t?: number })._t = window.setTimeout(() => void renderBiblioLive(), 250);
  });
```

After (shows a lightweight inline spinner text next to the search box during the debounce window, cleared by the next full render):
```ts
  const q = document.getElementById("bibq") as HTMLInputElement | null;
  q?.addEventListener("input", () => {
    bibState.filter.q = q.value || undefined;
    clearTimeout((q as unknown as { _t?: number })._t);
    const toolbar = q.closest<HTMLElement>(".sift-library-toolbar");
    toolbar?.querySelector(".sift-bib-search-pending")?.remove();
    const pending = document.createElement("span");
    pending.className = "sift-bib-search-pending";
    pending.style.cssText = "font-size:var(--text-xs);color:var(--color-text-tertiary)";
    pending.textContent = "Recherche…";
    toolbar?.appendChild(pending);
    (q as unknown as { _t?: number })._t = window.setTimeout(() => void renderBiblioLive(), 250);
  });
```

- [ ] **Step 7: Unify the "Doublons" stat-card and chip to the same toggle semantics**

In the `act === "stat"` handler (`sift-live.ts:2299-2313`), before:
```ts
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
```

After (matches the chip's real toggle at `act === "dupscan"`, `sift-live.ts:2370-2389`):
```ts
        } else if (stat === "duplicates") {
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
            return;
          }
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "fix(bibliotheque): filtre verdict/qualite, dedup confirmee+honnete, statut actif, scope scan doublons"
```

---

### Task 5: Clé USB — annuler pendant le formatage, progression visible, mot de confirmation univoque

**Files:**
- Modify: `frontend/usb-format-modal.ts`

**Interfaces:**
- Consumes: `formatDrive` (already imported from `./ipc`)

- [ ] **Step 1: Disable Cancel while a format is running (it cannot actually stop the operation)**

Before:
```ts
    card.querySelector("#sift-usbfmt-cancel")?.addEventListener("click", () => close());
```

After:
```ts
    const cancelBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-cancel");
    if (cancelBtn) cancelBtn.disabled = busy;
    cancelBtn?.addEventListener("click", () => {
      if (busy) return; // formatDrive() has no cancel path — a disabled button says so honestly
      close();
    });
```

- [ ] **Step 2: Show real progress text while `formatDrive()` runs**

Before (the button label already distinguishes armed vs not, but nothing distinguishes "running"):
```ts
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn" disabled>' +
      (armedAt ? "Confirmer — tout sera effacé" : "Formater") +
      "</button>" +
      "</div>";
```

After:
```ts
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn" disabled>' +
      (busy
        ? '<span class="sift-bt-spin" style="margin-right:6px;vertical-align:-2px"></span>Formatage en cours…'
        : armedAt
          ? "Confirmer — tout sera effacé"
          : "Formater") +
      "</button>" +
      (busy
        ? '<div class="sift-usbfmt-progress-note" style="margin-top:8px;font-size:var(--text-sm);color:var(--color-text-tertiary)">Ne débranche pas le disque — cela peut prendre plusieurs minutes.</div>'
        : "") +
      "</div>";
```

- [ ] **Step 3: Humanize the format-failure message**

Before:
```ts
        .catch((e: unknown) => {
          busy = false;
          armedAt = null;
          console.error("formatDrive failed", e);
          const desc = card.querySelector(".sift-usbfmt-desc");
          if (desc) {
            desc.insertAdjacentHTML(
              "afterend",
              '<div class="sift-usbfmt-error">Échec du formatage : ' +
                escapeHtml(String(e)) +
                "</div>",
            );
          }
        });
```

After:
```ts
        .catch((e: unknown) => {
          busy = false;
          armedAt = null;
          console.error("formatDrive failed", e);
          const raw = String(e);
          const humanized = /access|denied|permission/i.test(raw)
            ? "Accès refusé — ferme tout programme utilisant ce disque et réessaie."
            : /not found|no such|introuvable/i.test(raw)
              ? "Disque introuvable — a-t-il été débranché pendant le formatage ?"
              : "Échec du formatage. Vérifie que le disque est bien branché et réessaie.";
          const desc = card.querySelector(".sift-usbfmt-desc");
          if (desc) {
            desc.insertAdjacentHTML(
              "afterend",
              '<div class="sift-usbfmt-error">' + escapeHtml(humanized) + "</div>",
            );
          }
          render();
        });
```

Note: `render()` at the end re-enables the (now non-busy) Cancel/Confirm buttons — without it, the `disabled`/busy state from Step 1/2 would stick after a failed format since nothing else calls `render()` in the catch path.

- [ ] **Step 4: Disambiguate the confirm word when two drives share a model label**

Before:
```ts
  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  const confirmWord = drive.label || drive.id;
```

After:
```ts
  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  // drive.label is a model name (e.g. "Kingston DataTraveler USB Device") — two identical drives
  // plugged in together would share the same confirm word otherwise (audit 2026-07-09). drive.id
  // (the drive letter/path) is what actually distinguishes them.
  const confirmWord = drive.label ? `${drive.label} (${drive.id})` : drive.id;
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/usb-format-modal.ts
git commit -m "fix(usb): annulation desactivee pendant le formatage, progression visible, mot de confirmation univoque"
```

---

### Task 6: `confirmAction()` — focus par défaut sur Annuler

**Files:**
- Modify: `frontend/confirm-modal.ts:46`

**Interfaces:**
- None (self-contained change to an already-exported function's internal behavior).

- [ ] **Step 1: Move default focus to the Cancel button**

Before:
```ts
    card.append(msg, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    confirmBtn.focus(); // R5 : focus déplacé dans la modale à l'ouverture, pas laissé sur l'appelant
```

After:
```ts
    card.append(msg, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    // Audit 2026-07-09 : focaliser confirmBtn par défaut expose à valider une action destructrice
    // (dedup, réparations master.db) sur un Entrée/Espace résiduel juste après ouverture — même
    // logique que shadcn Alert Dialog (focus par défaut sur Cancel), déjà notre référence pour
    // Escape/role ci-dessus.
    cancelBtn.focus();
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/confirm-modal.ts
git commit -m "fix(confirm-modal): focus par defaut sur Annuler, pas sur l'action destructrice"
```

---

### Task 7: Toast global — `aria-live`

**Files:**
- Modify: `frontend/sift-live.ts:665-673` (`toast()`)

**Interfaces:**
- None — internal to an already-used function, no signature change.

- [ ] **Step 1: Add `role`/`aria-live` matching the Journal's toast pattern**

Before:
```ts
function toast(message: string): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
```

After:
```ts
function toast(message: string): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "fix(a11y): aria-live sur le toast global, coherent avec le toast du Journal"
```

---

### Task 8: Revue — parité d'annulation Écarter/Re-source avec Ranger + erreurs humanisées

**Files:**
- Modify: `frontend/filing.ts:1769-1784` (`doSecondary`)
- Modify: `frontend/filing.ts:1690-1695` (rangement error fallback)

**Interfaces:**
- Consumes: `toast(message: string, persistent?: boolean): void` (existing signature in `filing.ts`, already called with a second boolean arg elsewhere in this file, e.g. `filing.ts:1775`)
- Consumes: `revertBatch` (already imported/used by `doRevert` in the same file)

- [ ] **Step 1: Find `rejectTrack`'s return value**

Run: `grep -n "async function rejectTrack\|export async function rejectTrack" frontend/ipc.ts src-tauri/src/ipc*.rs` (or open `frontend/ipc.ts` and search `rejectTrack`). Confirm what it returns — this task assumes it resolves with enough information to revert (a `batch_id`-shaped value or the track's own id), matching the existing `revertBatch(batchId: string)` signature used by `doRevert`. If `rejectTrack` does **not** return a revertable id, adjust Step 2 below to call `revertBatch(String(state.track.id))` only if that is what the backend's revert path actually expects — verify against `src-tauri/src/ipc.rs`'s `reject_track`/`revert_batch` pairing before writing the click handler, do not guess.

- [ ] **Step 2: Give Écarter/Re-source the same one-click undo as Ranger**

Before:
```ts
async function doSecondary(mid: HTMLElement, kind: "resource" | "trash"): Promise<void> {
  if (!state.track || acting) return;
  acting = true;
  setActionsDisabled(true);
  try {
    await rejectTrack(state.track.id);
    toast(kind === "resource" ? "Marqué à re-sourcer" : "Écarté", true);
    clearPane(mid);
  } catch (e) {
    toast(`Échec : ${String(e)}`, false);
    console.error(`${kind} failed`, e);
    setActionsDisabled(false);
  } finally {
    acting = false;
  }
}
```

After (uses the same `toast()` + inline undo pattern as `doRevert`'s own error handling in this file, calling `revertBatch` with the track's own id — `reject_track`'s undo path is keyed on the track id, matching how Écartés' own `requeueTrack(id)` already reverses this exact action, `sift-live.ts:2276`):
```ts
async function doSecondary(mid: HTMLElement, kind: "resource" | "trash"): Promise<void> {
  if (!state.track || acting) return;
  const trackId = state.track.id;
  acting = true;
  setActionsDisabled(true);
  try {
    await rejectTrack(trackId);
    toast(
      kind === "resource" ? "Marqué à re-sourcer" : "Écarté",
      true,
      {
        label: "Annuler",
        onUndo: async () => {
          try {
            await requeueTrack(trackId);
          } catch (e) {
            console.error(`${kind} undo failed`, e);
            toast(`Échec de l'annulation : ${String(e)}`, false);
          }
        },
      },
    );
    clearPane(mid);
  } catch (e) {
    toast(`Échec : ${String(e)}`, false);
    console.error(`${kind} failed`, e);
    setActionsDisabled(false);
  } finally {
    acting = false;
  }
}
```

This assumes `toast()` in `filing.ts` accepts an optional 3rd argument for an inline undo action. **Before writing this step for real**, read `filing.ts`'s `toast()` definition (grep `function toast` in `filing.ts`) — if it does not already support an undo affordance, extend it first (add an optional `undo?: { label: string; onUndo: () => void | Promise<void> }` parameter that renders a small inline button inside the toast element, matching `showFiledConfirm`'s revert-button markup style, `filing.ts:1729`). Do not invent a signature without checking the real one first — this is exactly the kind of API-before-writing-the-line check flagged in memory (`verify-reused-component-api-during-design`).

- [ ] **Step 3: Humanize the generic rangement-error fallback a bit more, without inventing unseen error strings**

Before:
```ts
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else toast(`Échec du rangement : ${msg}`, false);
```

After:
```ts
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else if (/permission|access|denied/i.test(msg)) toast("Refusé : accès au fichier/dossier refusé.", false);
    else if (/no such file|not found|introuvable/i.test(msg)) toast("Fichier introuvable — a-t-il été déplacé ?", false);
    else toast(`Échec du rangement : ${msg}`, false);
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. If Step 2's `toast()` signature change was needed, confirm every other call site of `filing.ts`'s `toast()` still compiles (it's backward compatible — the new parameter is optional).

- [ ] **Step 5: Commit**

```bash
git add frontend/filing.ts
git commit -m "fix(revue): annulation en un clic pour Ecarter/Re-source, erreurs de rangement plus humanisees"
```

---

### Task 9: Journal — cohérence du compteur mass-revert

**Files:**
- Modify: `frontend/journal.ts:63` (`buildCategories`, `Cat.massLabel`)

**Interfaces:**
- Consumes: nothing new. `JournalEntry.track_count` already read at `journal.ts:199`.

- [ ] **Step 1: Make the button's own count match what the confirmation will show**

Before:
```ts
function buildCategories(entries: JournalEntry[]): Cat[] {
  const filed = filterByCat(entries, "filed");
  const trash = filterByCat(entries, "trash");
  const reject = filterByCat(entries, "reject");
  const n = filed.length;
  return [
    {
      id: "filed",
      label: "FILÉS",
      massLabel: `↩ Défiler les ${n} affichés`,
      massColor: "var(--color-text-danger)",
      entries: filed,
    },
```

After:
```ts
function buildCategories(entries: JournalEntry[]): Cat[] {
  const filed = filterByCat(entries, "filed");
  const trash = filterByCat(entries, "trash");
  const reject = filterByCat(entries, "reject");
  // Compte de morceaux (track_count), pas de batches — même unité que la confirmation
  // (installDelegate, "${label} les ${totalTracks} morceaux affichés ?"), sinon le bouton et la
  // boîte qui s'ouvre juste après affichent deux nombres différents (audit 2026-07-09).
  const filedTrackCount = filed.reduce((s, e) => s + e.track_count, 0);
  return [
    {
      id: "filed",
      label: "FILÉS",
      massLabel: `↩ Défiler les ${filedTrackCount} morceaux affichés`,
      massColor: "var(--color-text-danger)",
      entries: filed,
    },
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/journal.ts
git commit -m "fix(journal): le bouton mass-revert affiche le meme compte que sa confirmation"
```

---

### Task 10: Revue — raccourci clavier pour remettre le tempo à 0%

**Files:**
- Modify: `frontend/report-view.ts:857-876` (tempo `keydown` listener)

**Interfaces:**
- Consumes: `renderTempo`, `applyRate`, `tempoValue` (already in scope in the enclosing function)

- [ ] **Step 1: Add a "0" key handler mirroring the mouse's dblclick-to-neutral shortcut**

Before:
```ts
    tempoTrack.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        tempoValue = Math.max(-8, tempoValue - 1);
        renderTempo();
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        tempoValue = Math.min(8, tempoValue + 1);
        renderTempo();
      } else if (e.key === "Home") {
        e.preventDefault();
        tempoValue = -8;
        renderTempo();
      } else if (e.key === "End") {
        e.preventDefault();
        tempoValue = 8;
        renderTempo();
      }
    });
```

After:
```ts
    tempoTrack.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        tempoValue = Math.max(-8, tempoValue - 1);
        renderTempo();
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        tempoValue = Math.min(8, tempoValue + 1);
        renderTempo();
      } else if (e.key === "Home") {
        e.preventDefault();
        tempoValue = -8;
        renderTempo();
      } else if (e.key === "End") {
        e.preventDefault();
        tempoValue = 8;
        renderTempo();
      } else if (e.key === "0") {
        // Parité clavier avec le double-clic souris (dblclick → 0%, ligne juste au-dessus) —
        // sans ça, un utilisateur clavier doit presser une flèche jusqu'à 8 fois (audit 2026-07-09).
        e.preventDefault();
        tempoValue = 0;
        renderTempo(false);
        applyRate();
      }
    });
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/report-view.ts
git commit -m "fix(revue): touche 0 pour remettre le tempo a 0%, parite avec le double-clic souris"
```

---

### Task 11: Accueil — bannière racine non définie affichable une fois, pas répétée à chaque source

**Files:**
- Modify: `frontend/home-sources.ts` (`inspectorHtml` + wiring around it)

**Interfaces:**
- Consumes: nothing external. Adds one module-level flag scoped to this file only.

- [ ] **Step 1: Read the file's render/wiring entry point to find where `inspectorHtml` is called from, and where a click handler could be attached**

Run: `grep -n "inspectorHtml(" frontend/home-sources.ts` to confirm the call site(s) (already seen one at `home-sources.ts:179`). Confirm there is a single delegated click handler in this file (same pattern as `installDelegate` in `journal.ts`) where a new `data-sift="dismiss-rootgate"` case can be added — if the delegated handler lives in `sift-live.ts`'s `#pa` listener instead (likely, since `data-sift` actions are handled there per the grep in Task 4), add the new case there instead of inventing a second listener in `home-sources.ts`.

- [ ] **Step 2: Add a session-scoped dismiss flag and a close button**

At the top of `frontend/home-sources.ts`, near the other module-level state, add:
```ts
// Dismissed for this session only (not persisted) — re-shown next app launch and immediately if
// the user clicks away then back with root still unset would be a nag; a session-scoped dismiss
// (not per-source) fixes the "same banner every source click" repetition found at the 2026-07-09
// audit without hiding a real blocker (rangement bloqué) permanently.
let rootGateDismissed = false;
```

Then change `rootGateHtml` in `inspectorHtml`, before:
```ts
  const rootGateHtml = root
    ? ""
    : '<div class="sift-ui-card-soft sift-ui-card-soft-pad sift-home-warning">' +
      '<i class="ti ti-alert-triangle" style="font-size:var(--text-lg);flex:none"></i>' +
      "<span><strong>Racine de bibliothèque non définie</strong> — les dossiers surveillés restent scannés, mais le rangement sera bloqué tant qu'aucune racine n'est choisie. " +
      '<button data-sift="gotoreglages" style="color:var(--color-text-warning);text-decoration:underline;padding:0;font:inherit">Ouvrir Réglages →</button></span></div>';
```

After:
```ts
  const rootGateHtml = root || rootGateDismissed
    ? ""
    : '<div class="sift-ui-card-soft sift-ui-card-soft-pad sift-home-warning">' +
      '<i class="ti ti-alert-triangle" style="font-size:var(--text-lg);flex:none"></i>' +
      "<span><strong>Racine de bibliothèque non définie</strong> — les dossiers surveillés restent scannés, mais le rangement sera bloqué tant qu'aucune racine n'est choisie. " +
      '<button data-sift="gotoreglages" style="color:var(--color-text-warning);text-decoration:underline;padding:0;font:inherit">Ouvrir Réglages →</button></span>' +
      '<button data-sift="dismiss-rootgate" title="Masquer pour cette session" aria-label="Masquer ce message pour cette session" style="flex:none;background:none;border:none;color:var(--color-text-warning);cursor:pointer;padding:0 0 0 8px"><i class="ti ti-x"></i></button></div>';
```

- [ ] **Step 3: Wire the dismiss button into the existing `data-sift` delegated handler**

In the delegated `[data-sift]` handler (found in Step 1 — per the earlier grep, this lives in `frontend/sift-live.ts` alongside `act === "addsrc"`/`"rmsrc"`/`"togglewatch"`, `sift-live.ts:2407-2419`), add a case:
```ts
    } else if (act === "dismiss-rootgate") {
      e.stopPropagation();
      rootGateDismissed = true;
      void refresh();
```
Add this as another `else if` branch in that same chain, and import `rootGateDismissed` — since it is declared in `home-sources.ts`, either export a setter function (`export function dismissRootGate(): void { rootGateDismissed = true; }`) and call that instead of touching the flag from outside the module, which keeps the module boundary clean. Use:
```ts
    } else if (act === "dismiss-rootgate") {
      e.stopPropagation();
      dismissRootGate();
      void refresh();
```
and export `dismissRootGate` from `frontend/home-sources.ts` next to `rootGateDismissed`:
```ts
export function dismissRootGate(): void {
  rootGateDismissed = true;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/home-sources.ts frontend/sift-live.ts
git commit -m "fix(accueil): bannière racine non définie masquable pour la session, plus repetee a chaque source"
```

---

### Task 12: Batch tracklist — texte à côté de l'icône d'état

**Files:**
- Modify: `frontend/batch-tracklist.ts:18-23` (`PILL`)

**Interfaces:**
- None — internal rendering constant, no signature change (the `html` string is inserted into `.sift-bt-pill` exactly as before, just with more content).

- [ ] **Step 1: Read how `PILL[...].html` is consumed downstream**

Run: `grep -n "PILL\[" frontend/batch-tracklist.ts` to confirm every read site still works with a longer inner HTML string (icon + text) instead of icon-only — the row layout (`rowInner`, `batch-tracklist.ts:30-36`) already has `.sift-bt-name` as a separate flex sibling, so widening `.sift-bt-pill`'s content should not need a layout change, but verify `.sift-bt-pill`'s CSS (`width`/`overflow`) in `styles.css` isn't fixed to an icon-only size before writing the fix — if it's a fixed small square, note that in the commit message rather than silently letting text clip.

- [ ] **Step 2: Add a short text label next to each icon**

Before:
```ts
const PILL: Record<BtState, { cls: string; html: string }> = {
  wait: { cls: "sift-bt-wait", html: '<i class="ti ti-clock"></i>' },
  run: { cls: "sift-bt-run", html: '<span class="sift-bt-spin"></span>' },
  done: { cls: "sift-bt-done", html: '<i class="ti ti-check"></i>' },
  fail: { cls: "sift-bt-fail", html: '<i class="ti ti-alert-triangle"></i>' },
};
```

After:
```ts
const PILL: Record<BtState, { cls: string; html: string }> = {
  wait: { cls: "sift-bt-wait", html: '<i class="ti ti-clock"></i> <span class="sift-bt-pill-label">attend</span>' },
  run: { cls: "sift-bt-run", html: '<span class="sift-bt-spin"></span> <span class="sift-bt-pill-label">en cours</span>' },
  done: { cls: "sift-bt-done", html: '<i class="ti ti-check"></i> <span class="sift-bt-pill-label">fait</span>' },
  fail: { cls: "sift-bt-fail", html: '<i class="ti ti-alert-triangle"></i> <span class="sift-bt-pill-label">échec</span>' },
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. If Step 1 found `.sift-bt-pill` has a fixed narrow width in `styles.css`, widen it there too (grep `.sift-bt-pill{` in `frontend/styles.css` and adjust `width`/`min-width` to fit the new text, keeping the existing token-based sizing scale rather than a new literal).

- [ ] **Step 4: Commit**

```bash
git add frontend/batch-tracklist.ts
git commit -m "fix(batch): texte a cote de l'icone d'etat, pas seulement une forme a reconnaitre"
```

---

## Self-Review Notes

- **Spec coverage**: all 22 in-scope findings from the 4 audit reports map to a task above (Task 4 alone folds 7 Bibliothèque findings — same file/screen, related state, one reviewable unit per "Task Right-Sizing" guidance). The 3 out-of-scope findings are listed under "Différé" with a named reopening trigger, not silently dropped.
- **Placeholder scan**: no TBD/"add error handling"/"similar to Task N" left — every step shows exact before/after code. Task 8 and Task 11 each have one step that says "read the real code before finalizing this edit" (`toast()`'s real signature in `filing.ts`; the real delegated-handler location for `data-sift`) — these are not placeholders, they are explicit verify-before-writing gates because this plan was written without opening every single call site, consistent with the project's `verify-reused-component-api-during-design` lesson.
- **Type consistency**: `confirmAction`, `toast`, `trashTrack`/`restoreTrack`/`requeueTrack`, `bibState`/`dupShown`/`dupGroups`/`dupLoading` are used with the exact names and shapes already present in the files read for this plan — no renamed function introduced.
