# Phase 1 (tranche 1b) — Extraire le contrôleur de file/sélection Revue de `sift-live.ts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire encore `frontend/sift-live.ts` en déplaçant tout l'état et
toutes les fonctions propriétaires de la file/sélection Revue (virtualisation,
navigation clavier, recherche, rendu de ligne, bascule Détail/Lot) vers un
nouveau module `frontend/queue-panel.ts`, sans changement de comportement.

**Architecture (révisée après un premier essai d'implémentation qui a
détecté un couplage réel non anticipé — voir `.superpowers/sdd/task-1-report.md`
de cette tranche) :** `setReviewMode` n'est PAS un simple mutateur — sa
branche `"batch"` appelle `renderBatch()` et touche `batchGroupCap`/
`batchBin`/`batchInPlace`, tous propriété du code batch (tranche 1c). La
déplacer telle quelle vers `queue-panel.ts` créerait un cycle d'import
statique (`queue-panel.ts → sift-live.ts` alors que `sift-live.ts →
queue-panel.ts` existe déjà). Sa branche `"detail"`, en revanche, ne touche
QUE du code propriété de la file (`ensureReviewSeg`, `clearBinPick`,
`homeProgressZone`, `renderQueue`) — aucune dépendance batch.

**Deuxième occurrence du même couplage, trouvée par l'implémenteur au 2ᵉ
essai** : `renderQueue` (qui déménage) appelle aussi `renderBatch()`
directement (`if (reviewMode === "batch") { renderBatch(); }`, ligne ~501).
Fixée par le même principe d'inversion de dépendance qu'un simple mutateur
brut ne suffit pas à couvrir ici (`renderBatch` n'est pas un état, c'est un
appel de fonction batch depuis du code file) : `queue-panel.ts` exporte un
point d'enregistrement `registerBatchRenderer(fn)`, appelé UNE FOIS par
`sift-live.ts` (dans `installLiveWiring`, avant toute interaction
possible) avec `renderBatch`. `renderQueue` appelle le callback enregistré
au lieu d'importer `renderBatch` statiquement — aucun cycle d'import, la
référence est câblée dynamiquement au démarrage.

Vérifié (grep exhaustif de tous les symboles `batch*` dans le fichier
entier) : aucune AUTRE fonction de la liste "à déplacer" ne référence de
code batch — ce sont les deux seules occurrences (`setReviewMode`, déjà
traitée en ne déplaçant pas la fonction ; `renderQueue`, traitée ci-dessus).

Décision : `setReviewMode` (la fonction complète, orchestrant les deux
branches) **reste dans `sift-live.ts`** — c'est un rôle d'orchestration
cross-panel, cohérent avec la cible d'architecture de la spec ("un
installeur d'application mince pour la navigation et le câblage global").
Sa branche `"detail"` est extraite telle quelle (comportement identique,
juste nommée) en une fonction `enterDetailMode()` qui, elle, déménage dans
`queue-panel.ts` puisqu'elle ne touche que du code file. `queue-panel.ts`
exporte aussi un mutateur brut `setReviewModeRaw(m)` (aucune logique, juste
`reviewMode = m`) pour que la branche `"batch"`, restée dans `sift-live.ts`,
puisse muter l'état sans jamais réassigner une variable importée
directement (les bindings d'import ES sont en lecture seule côté
importeur). `currentItems`/`currentOpenId` restent réassignés uniquement
dans `queue-panel.ts`, comme prévu initialement — seul `reviewMode` a une
mutation scindée entre les deux fichiers, chacune dans le module qui la
justifie.

**Tech Stack:** Vite vanilla TypeScript, aucun framework. Pas de runner de
tests frontend — vérification par `tsc --noEmit` + checklist manuelle
`tauri dev`.

## Global Constraints

- Vite vanilla TS conservé — pas de framework.
- Zéro changement de comportement observable (mêmes IDs DOM, mêmes
  événements, même debounce de 150ms sur le clic de ligne, même
  virtualisation de fenêtre).
- Pas d'état global dupliqué — `currentItems`/`currentOpenId`/`reviewMode`
  vivent SEULEMENT dans `queue-panel.ts` après cette tranche (`sift-live.ts`
  ne garde qu'un appel à `setReviewModeRaw()`, jamais sa propre copie de
  `reviewMode`).
- Chaque extraction validée avant la suivante (Task unique ici, voir note
  ci-dessous sur la fusion).
- Jamais deux commandes Cargo/Tauri concurrentes ; ne jamais toucher un vrai
  `master.db` Rekordbox.
- Commit uniquement après autorisation explicite de l'utilisateur.
- Spec source : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
  section 4 (Phase 1). Précédent : tranche 1a (commits `6d0f3f9`, `cb42772`),
  `docs/superpowers/plans/2026-07-13-phase1-sift-live-split-tranche1a-rekordbox-routing.md`.

---

### Task 1: Créer `frontend/queue-panel.ts` et retirer le code déplacé de `sift-live.ts`

> Tâche unique (pas de découpe en "créer" puis "retirer" séparés) — même
> raison qu'en tranche 1a : découpée, elle laisserait une fenêtre où la même
> logique existe deux fois, ce qu'un reviewer relirait à raison comme un
> défaut sur un diff intermédiaire.

**Files:**
- Create: `frontend/queue-panel.ts`
- Modify: `frontend/sift-live.ts` (retrait du code déplacé, imports, appel
  délégué)
- Read only (source exacte à déplacer) : `frontend/sift-live.ts` état actuel
  (commit `c083dea`)

**Interfaces:**
- Produces (exports de `queue-panel.ts`, consommés par `sift-live.ts` dans
  cette même tâche, et par la tranche 1c ensuite) :
  - `currentItems: QueueItem[]` (variable exportée, réassignée uniquement
    dans ce module)
  - `currentOpenId: number | null` (idem)
  - `reviewMode: "detail" | "batch"` (idem, mutée via `enterDetailMode()`
    en interne ou via `setReviewModeRaw()` depuis `sift-live.ts`)
  - `export function setReviewModeRaw(m: "detail" | "batch"): void` —
    mutateur brut, sans effet de bord, pour la branche `"batch"` de
    `setReviewMode` restée dans `sift-live.ts`.
  - `export function enterDetailMode(): void` — la branche `"detail"` de
    l'ancien `setReviewMode`, extraite telle quelle (ne touche que du code
    file : `reviewMode`, `ensureReviewSeg`, `clearBinPick`,
    `homeProgressZone`, `renderQueue`).
  - `export function stepQueueSelection(delta: 1 | -1): void`
  - `export function prefetchNextAfter(id: number): void`
  - `export function renderQueueWindow(ql: HTMLElement): void`
  - `export async function renderQueue(touchDetail?: boolean): Promise<void>`
  - `export function verdictDot(v: string | null): string` (utilisée aussi
    par le mode lot, tranche 1c)
  - `export function updateRevueBadge(count: number): void`
  - `export function handleQueueItemClick(qi: HTMLElement, e: MouseEvent):
    void` — nouvelle fonction, extraite du bloc `.qi[data-id]` actuellement
    dans `installLiveWiring`.
  - `export function registerBatchRenderer(fn: () => void): void` —
    point d'enregistrement dynamique pour que `renderQueue` déclenche le
    rendu batch sans import statique vers `sift-live.ts`.
- Consumes (déjà existants, imports à reporter dans `queue-panel.ts`) :
  `requireEl`, `esc` depuis `./dom` ; `openFilingInto`, `clearBinPick`
  depuis `./filing` ; `homeProgressZone` depuis `./progress-zone` ; types
  `QueueItem`, `Target` depuis `../shared/contracts` ; toute autre
  dépendance rencontrée en lisant le code source (lister précisément à la
  Step 1, ne pas deviner).

- [ ] **Step 1: Lire l'état actuel exact de `frontend/sift-live.ts` et lister les dépendances**

Relire le fichier en entier (ou au moins les sections concernées) pour
confirmer les numéros de ligne ci-dessous, qui datent du commit `c083dea` —
s'ils ont dérivé, se fier au nom des fonctions, pas aux numéros.

Bloc d'état module-niveau à déplacer (juste avant `visibleQueueItems`) :
- `currentItems` (`let currentItems: QueueItem[] = [];`)
- `currentOpenId` (`let currentOpenId: number | null = null;`)
- `QUEUE_ROW_BUFFER` (constante utilisée par la virtualisation)
- `queueRowHeightCache`
- `queueSearchTerm`
- `queueShowAll`
- `queueScrollWired`
- `queueStepTimer`
- `queueNavKeysWired`
- `reviewMode`

Fonctions nommées à déplacer verbatim (frontières non-ambiguës — début
`function`/`async function`/`export function`, fin à l'accolade fermante de
même colonne) :
`visibleQueueItems`, `measureQueueRowHeight`, `renderQueueWindow`,
`ensureQueueScroll`, `prefetchNextAfter`, `stepQueueSelection`,
`installQueueNavKeys`, `verdictDot`, `verdictWord`, `queueRowHtml`,
`renderQueue`, `ensureReviewSeg`, `ensureQueueDoneToggle`,
`ensureQueueSearch`, `updateRevueBadge`.

**Exception à "verbatim" pour `renderQueue`** : son corps contient
`if (reviewMode === "batch") { renderBatch(); }` (voir section Architecture)
— remplacer `renderBatch()` par `batchRenderer?.()` (le callback enregistré,
Step 3). Aucune autre ligne de `renderQueue` ne change.

**Exception à "verbatim" pour `stepQueueSelection`** : son corps contient un
appel `setReviewMode("detail")` (dans la branche `if (reviewMode ===
"batch")`) — remplacer cet unique appel par `enterDetailMode()` en
déplaçant la fonction, pour la même raison que dans `handleQueueItemClick`
(Step 2). Aucune autre ligne de `stepQueueSelection` ne change.

**`setReviewMode` ne fait PAS partie de cette liste** — voir la section
Architecture ci-dessus : sa branche `"detail"` est extraite en
`enterDetailMode()` (nouvelle fonction, Step 3) qui, elle, déménage ; sa
branche `"batch"` reste dans `sift-live.ts` sous le même nom
`setReviewMode`, réécrite pour appeler `setReviewModeRaw()` +
`ensureReviewSeg()` (importés) au lieu de réassigner `reviewMode`
directement.

Ne PAS déplacer (restent dans `sift-live.ts`, propriété batch ou
orchestration) : `groupBoxHtml`, `mutateBatchTick`, `updateBatchRailSelection`,
tout `batch*`, `pushAnalyzeProgress`, `pushFileProgress`, `onFileStop`,
`runNavExport`, `refresh`, `installLiveWiring`, `setReviewMode` (réécrite,
pas déplacée — voir ci-dessus).

- [ ] **Step 2: Extraire le bloc de clic `.qi[data-id]` en une fonction dédiée**

Dans `installLiveWiring`, le premier bloc du listener `click` sur `#pa`
gère le clic sur une ligne de la file (`const qi = ...closest(".qi[data-id]")`
puis tout le corps jusqu'au `return;` qui suit, juste avant le bloc `[data-ec]`
Écartés). Ce bloc utilise une variable locale `queueSelectTimer` déclarée
juste avant l'`addEventListener` — **cette variable DOIT devenir un `let`
module-niveau dans `queue-panel.ts`** (pas locale à la nouvelle fonction),
sinon le debounce de 150ms casse silencieusement : un `let` local à une
fonction rappelée à chaque clic recrée une variable fraîche à chaque appel,
`clearTimeout` sur une variable jamais réutilisée ne fait plus rien, et
plusieurs sélections rapides déclenchent plusieurs chargements au lieu d'un
seul (exactement le problème que ce debounce existe pour éviter).

Extraire ce corps dans :

```ts
let queueSelectTimer: ReturnType<typeof setTimeout> | undefined;

/** Queue row click (Revue): opens the filing pane after a 150ms debounce (flicking through rows
 *  fast must not fire a decode+fetch per row). Extracted from installLiveWiring's #pa click
 *  listener (Phase 1, tranche 1b) — same split as handleRekordboxAction (tranche 1a): the state
 *  this reads/writes (currentItems, currentOpenId, reviewMode) already lives in this module. */
export function handleQueueItemClick(qi: HTMLElement, e: MouseEvent): void {
  e.stopPropagation();
  // In batch mode a row-click means "inspect this one" → drop back to the detail pane.
  if (reviewMode === "batch") enterDetailMode();
  const id = Number(qi.dataset.id);
  const item = currentItems.find((it) => it.id === id);
  const mid = requireEl("#mid", "qi-click");
  currentOpenId = id;
  const ql = document.getElementById("ql");
  if (ql) renderQueueWindow(ql);
  clearTimeout(queueSelectTimer);
  queueSelectTimer = setTimeout(() => {
    if (item && mid) {
      void openFilingInto(mid, item);
      prefetchNextAfter(item.id);
    } else if (qi.dataset.path)
      void import("./report-view").then((m) => m.openReportModal(qi.dataset.path!));
  }, 150);
}
```

Ce corps est une copie verbatim des lignes 1308-1326 de `sift-live.ts` au
moment du diagnostic (commit `c083dea`), y compris `e.stopPropagation()`.
Seul le test `if (qi?.dataset.id)` reste dans `sift-live.ts` (Step 4
ci-dessous) comme garde d'entrée avant l'appel délégué — cette fonction
reçoit `qi` déjà résolu et non-null. Si le fichier a changé depuis ce
commit, relire `frontend/sift-live.ts` autour du bloc `.qi[data-id]` avant
de coller pour confirmer qu'aucune ligne n'a été ajoutée/modifiée
entre-temps.

- [ ] **Step 3: Créer `frontend/queue-panel.ts` avec l'état + les fonctions + `handleQueueItemClick`**

Coller verbatim l'état et les fonctions listées à la Step 1, plus la
fonction de la Step 2, dans ce nouveau fichier. En-tête de fichier à
ajouter (même esprit que `rekordbox-view.ts`) :

```ts
// Revue queue panel — virtualization, keyboard nav, search, row rendering, and Détail/Lot mode
// state. Extracted from sift-live.ts (Phase 1, tranche 1b). currentItems/currentOpenId/reviewMode
// are owned here — all their reassignments already lived in this code before the move. The batch
// controller (tranche 1c) imports these as read values and calls setReviewMode() to mutate mode,
// never reassigns directly (ES module import bindings are read-only from outside this file).
```

Import ce dont ce nouveau code a besoin (à confirmer en lisant chaque appel,
liste de départ) : `requireEl`, `esc` depuis `./dom` ; `openFilingInto`,
`clearBinPick` depuis `./filing` ; `homeProgressZone` depuis
`./progress-zone` ; les types utilisés (`QueueItem`, `Target`, etc.) depuis
`../shared/contracts`.

Ajouter aussi ces deux fonctions (extraites de l'ancien `setReviewMode`,
lignes 1070-1094 du commit `c083dea` — reconfirmer par lecture si le
fichier a changé) :

```ts
/** Raw reviewMode mutator, no side effects — used by sift-live.ts's setReviewMode for the
 *  "batch" branch, which needs batch-owned code (renderBatch, batchGroupCap) this module must
 *  never import (Phase 1, tranche 1b: see the coupling analysis in the plan's Architecture
 *  section). Only enterDetailMode() below calls this internally for the "detail" case. */
export function setReviewModeRaw(m: "detail" | "batch"): void {
  reviewMode = m;
}

/** The "detail" branch of the old setReviewMode, extracted verbatim — it never touched batch
 *  state, so unlike the "batch" branch it can live here. Called directly by queue code
 *  (handleQueueItemClick, stepQueueSelection) and by sift-live.ts's setReviewMode when switching
 *  away from batch mode. */
export function enterDetailMode(): void {
  setReviewModeRaw("detail");
  ensureReviewSeg();
  // Leave batch pick mode: tree reverts to detail's state.binRel. No manual opacity/checkbox
  // cleanup needed — renderBins (filing.ts) always re-derives .sift-fldz-tree's opacity from
  // the current binPick (null in detail) and renders the one shared in-place checkbox itself.
  clearBinPick();
  // Return the progress zone to its left-sidebar home (it was relocated into the batch rail).
  homeProgressZone();
  void renderQueue(true);
}

let batchRenderer: (() => void) | null = null;

/** Registers the batch panel's render function so renderQueue's "reviewMode === batch" branch can
 *  trigger it without a static import — queue-panel.ts must never import from sift-live.ts (see
 *  the plan's Architecture section, 2nd occurrence of the same coupling). Call once from
 *  installLiveWiring, before any queue interaction is possible. */
export function registerBatchRenderer(fn: () => void): void {
  batchRenderer = fn;
}
```

- [ ] **Step 4: Retirer le code déplacé de `sift-live.ts` et câbler les imports**

- Supprimer le bloc d'état module-niveau et les 16 fonctions nommées listées
  à la Step 1 de `sift-live.ts`.
- Remplacer le bloc `.qi[data-id]` (Step 2) par un appel délégué :

```ts
    const qi = (e.target as HTMLElement).closest<HTMLElement>(".qi[data-id]");
    if (qi?.dataset.id) {
      handleQueueItemClick(qi, e);
      return;
    }
```

- Réécrire `setReviewMode` (reste dans `sift-live.ts`, ne change pas de
  nom ni de signature — tous ses appelants externes, dispatch `"reviewmode"`
  et `batchopen`, continuent de l'appeler sans changement) :

```ts
function setReviewMode(m: "detail" | "batch") {
  if (m === "batch") {
    setReviewModeRaw("batch");
    ensureReviewSeg();
    const fldz = requireEl("#fldz", "setReviewMode");
    batchGroupCap.file = BATCH_GROUP_PAGE;
    batchGroupCap.fake = BATCH_GROUP_PAGE;
    batchGroupCap.readonly = BATCH_GROUP_PAGE;
    renderBatch();
    void refreshBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  } else {
    enterDetailMode();
  }
}
```

  Comportement identique à l'original : `ensureReviewSeg()` était appelée
  inconditionnellement avant le `if` — elle l'est toujours dans les deux
  branches (une fois explicitement ici, une fois via `enterDetailMode()`).
- Ajouter l'import depuis `./queue-panel` : `currentItems`, `currentOpenId`,
  `reviewMode`, `setReviewModeRaw`, `enterDetailMode`, `ensureReviewSeg`,
  `registerBatchRenderer`, `stepQueueSelection`, `prefetchNextAfter`,
  `renderQueueWindow`, `renderQueue`, `verdictDot`, `updateRevueBadge`,
  `handleQueueItemClick` — UNIQUEMENT ceux réellement encore référencés
  ailleurs dans `sift-live.ts` après la Step 4 (vérifier chacun
  individuellement par grep, ne pas importer par précaution).
- Dans `installLiveWiring`, tout au début (avant les autres
  `install*`/`window.__sift*` déjà présents), ajouter :

```ts
  registerBatchRenderer(renderBatch);
```

  C'est le seul point de câblage du callback — appelé une fois au
  démarrage, avant qu'un clic ne puisse déclencher `renderQueue` en mode
  batch.
- Retirer les imports devenus inutiles dans `sift-live.ts` (ex.
  `openFilingInto`, `clearBinPick` si plus référencés qu'à l'intérieur du
  code déplacé — vérifier). **Exception : `homeProgressZone`** (`./progress-zone`)
  reste utilisée ailleurs dans `sift-live.ts` (hors du code déplacé, dans le
  code batch) — garder son import dans `sift-live.ts` MÊME SI `queue-panel.ts`
  l'importe aussi ; les deux fichiers sont des consommateurs légitimes du
  même export de `progress-zone.ts`, ce n'est pas une duplication d'état.
- `window.__siftQueue = renderQueue;` (dans `installLiveWiring`) doit
  continuer de fonctionner via le nouvel import.
- `installQueueNavKeys()` (appelée depuis `installLiveWiring`) doit
  continuer de fonctionner via le nouvel import — si elle n'est PAS dans la
  liste d'exports ci-dessus, l'ajouter (elle doit être appelable depuis
  `sift-live.ts`).

- [ ] **Step 5: Vérifier**

Run: `npx tsc --noEmit`
Expected: PASS, zéro erreur, zéro import inutilisé.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit (après autorisation explicite)**

```bash
git add frontend/queue-panel.ts frontend/sift-live.ts
git commit -m "refactor(frontend): extract Revue queue controller into queue-panel.ts

Moves currentItems/currentOpenId/reviewMode ownership and all queue-owned
functions (virtualization, keyboard nav, search, row rendering, Détail/Lot
mode switch) out of sift-live.ts into queue-panel.ts, plus a new
handleQueueItemClick extracted from installLiveWiring's delegated click
listener (same split as tranche 1a's handleRekordboxAction).

setReviewMode's two branches were coupled to different owners (detail:
queue-only: batch: renderBatch/batchGroupCap, not yet extracted) — split
into enterDetailMode() (moved to queue-panel.ts) and setReviewModeRaw()
(raw mutator, called by sift-live.ts's now-thinner setReviewMode for the
batch branch), avoiding a static import cycle between queue-panel.ts and
sift-live.ts. No behavior change (Phase 1, tranche 1b — see
docs/superpowers/plans/2026-07-13-phase1-tranche1b-queue-controller.md)."
```

---

### Task 2: Vérification manuelle et rapport de fin de tranche

**Files:** aucun changement de code — validation uniquement.

- [ ] **Step 1: Checklist comportementale manuelle dans `tauri dev` réel**

Pas de runner de tests frontend — vérifier manuellement (données de test,
jamais un vrai `master.db`) :
- Navigation clavier ↑/↓ dans la file (Revue), sélection stable, debounce
  150ms (plusieurs pressions rapides ne déclenchent qu'un seul chargement).
- Clic sur une ligne de la file → pane de filing s'ouvre après le délai.
- Recherche live dans la file (filtre titre/artiste).
- Toggle "+N traités" / "Masquer les traités".
- Bascule Détail/Lot (`ensureReviewSeg`) — thumb glissant, état visuel
  correct dans les deux sens.
- Badge Revue (`[18]` etc.) à jour après filing/rejet.
- Non-régression : Rekordbox (tranche 1a), Écartés, Bibliothèque toujours OK
  (le handler de clic est partagé).

- [ ] **Step 2: Suite Rust (régression croisée, aucun fichier Rust touché)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, même nombre de tests qu'avant la tranche.

- [ ] **Step 3: Rapport de fin de tranche**

Fichiers modifiés, comportement préservé, taille de `sift-live.ts` après
(comparer à 1751 lignes, l'état après tranche 1a), tests exécutés +
résultat, risques restants (mode lot encore dans `sift-live.ts`, tranche 1c
à suivre), diff synthétique.
