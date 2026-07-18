# Phase 1 (tranche 1c) — Extraire le contrôleur de mode lot (batch) de `sift-live.ts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire encore `frontend/sift-live.ts` en déplaçant tout l'état et
toutes les fonctions propriétaires du mode Lot (rendu, sélection,
confirmation à deux clics, rail, filing par lot) vers un nouveau module
`frontend/batch-panel.ts`, sans changement de comportement.

**Architecture :** Symétrique à la tranche 1b. `batch-panel.ts` est un
consommateur en LECTURE de `queue-panel.ts` (`currentItems`, `reviewMode`,
`verdictDot`, `prefetchNextAfter`, `enterDetailMode`) — import leaf-to-leaf
légitime, `queue-panel.ts` n'importera jamais rien en retour de
`batch-panel.ts` (déjà garanti : son seul point d'entrée externe est
`registerBatchRenderer`, appelé PAR `sift-live.ts`, pas par `batch-panel.ts`
lui-même). `setReviewMode` (orchestrateur cross-panel, décidé en tranche 1b)
reste dans `sift-live.ts` et importera désormais `renderBatch`/
`batchGroupCap`/`batchBin`/`batchInPlace`/`onBatchBinPick` depuis
`batch-panel.ts` — c'est précisément l'appel que `registerBatchRenderer`
câble déjà pour `renderQueue`.

Le seul point interne à `batch-panel.ts` qui appelait `setReviewMode`
(`batchopen`, mode "detail" uniquement) appelle `enterDetailMode()` à la
place (comportement identique, voir tranche 1b) — évite d'avoir
`batch-panel.ts` → `sift-live.ts`.

**Deux couplages cachés supplémentaires, trouvés par l'implémenteur au 1er
essai (vérification exhaustive, cf. `.superpowers/sdd/task-1c-batch-controller-report.md`) :**

1. **`refresh()`** (orchestrateur cross-panel, reste dans `sift-live.ts`)
   est appelé directement par `onFileBatchDone` et `runBatchDiscard` (deux
   des fonctions à déplacer). Fixé par le même principe que
   `registerBatchRenderer` (tranche 1b), mais dans l'autre sens :
   `batch-panel.ts` exporte `registerRefreshHook(fn)`, `sift-live.ts`
   l'appelle une fois avec `refresh` dans `installLiveWiring`,
   `onFileBatchDone`/`runBatchDiscard` appellent le hook enregistré au lieu
   d'importer `refresh` statiquement.
2. **`pushFileProgress`/`onFileStop`** (classées "ne pas déplacer" dans la
   première version de ce plan) et les 3 variables d'état qu'elles
   manipulent (`fileStopping`, `lastFileProgress`, `fileClearTimer`,
   absentes de la liste d'état initiale) sont en réalité **100%
   batch-exclusives** — vérifié par lecture de `frontend/filing.ts` (le
   chemin de filing en mode Détail utilise `fileTrack`, jamais
   `onFileProgress`/`onFileDone`, jamais ces 3 variables) et par grep
   exhaustif du fichier entier (aucune référence hors des 4 fonctions
   batch qui les touchent). Elles rejoignent donc la liste "à déplacer" —
   voir Step 1 révisée ci-dessous. `installLiveWiring` continue de les
   câbler (`onFileDone`, `onFileProgress`, `setCancelHandler("file", ...)`)
   via des imports depuis `batch-panel.ts` au lieu de références locales.

**Tech Stack :** Vite vanilla TypeScript, aucun framework. Vérification par
`tsc --noEmit` + checklist manuelle `tauri dev`.

**Troisième couplage caché, trouvé par l'implémenteur au 2ᵉ essai** :
`installLiveWiring` câble aussi un listener `"change"` (pas un clic — non
couvert par le chaînon `batchpick`→`batchstop`) qui écrit directement
`batchInPlace = ip.checked;` (case "file in place" du mode Lot). Fixé par
le même principe que `handleBatchAction` (délégation, pas callback
d'orchestration puisque c'est un point de logique fixe, pas un appel vers
l'orchestrateur) : `batch-panel.ts` exporte
`onBatchInPlaceChange(checked: boolean): void` (les 3 mêmes instructions
que l'original), `sift-live.ts` garde le listener `"change"` mais délègue
son corps à cette fonction.

## Global Constraints

- Vite vanilla TS conservé — pas de framework.
- Zéro changement de comportement observable — en particulier la
  confirmation à deux clics `BATCH_CONFIRM_THRESHOLD`/`batchConfirmArmed`
  (garde-fou contre le filing de masse accidentel, incident réel documenté
  dans `AGENTS.md`) doit rester identique au bit près.
- Pas d'état global dupliqué.
- `batch-panel.ts` n'importe jamais depuis `sift-live.ts`.
- Jamais deux commandes Cargo/Tauri concurrentes ; jamais de test contre un
  vrai `master.db`.
- Commit uniquement après autorisation explicite.
- Spec source : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
  section 4. Précédents : tranche 1a (commits `6d0f3f9`/`cb42772`), tranche
  1b (commit `cd67dea`).

---

### Task 1: Créer `frontend/batch-panel.ts` et retirer le code déplacé de `sift-live.ts`

> Tâche unique, même raison qu'en tranches 1a/1b (pas de fenêtre de
> duplication entre "créer" et "retirer").

**Files:**
- Create: `frontend/batch-panel.ts`
- Modify: `frontend/sift-live.ts`
- Read only (source exacte, commit `9a3d64a`, base de cette tranche) :
  `frontend/sift-live.ts`

**Interfaces:**
- Produces (exports de `batch-panel.ts`) :
  - État : `batchSel: Set<number>`, `batchFakeSel: Set<number>`,
    `batchCollapsed: Set<"file"|"fake"|"readonly">`,
    `batchGroupCap: Record<"file"|"fake"|"readonly", number>`,
    `batchInPlace: boolean`, `batchFormat: Target`,
    `batchTrackIds: number[]`, `batchBin: string`, `batchRunning: boolean`,
    `fileStopping: boolean`, `lastFileProgress: FileProgress | null`,
    `fileClearTimer` (tous réassignés/mutés uniquement dans ce module
    désormais).
  - `export function renderBatch(): void` — consommée par `sift-live.ts`
    (câblée via `registerBatchRenderer(renderBatch)`, déjà en place depuis
    la tranche 1b, ET directement par le nouveau corps de `setReviewMode`).
  - `export function onBatchBinPick(rel: string): void`
  - `export function runBatchFile(): Promise<void>`
  - `export function pushFileProgress(p: FileProgress): void` — consommée
    par `sift-live.ts` via `onFileProgress(pushFileProgress)`.
  - `export function onFileStop(): void` — consommée par `sift-live.ts` via
    `setCancelHandler("file", onFileStop)`.
  - `export function onFileBatchDone(res: BatchResult): Promise<void>` —
    consommée par `sift-live.ts` via `onFileDone(onFileBatchDone)`.
  - `export function registerRefreshHook(fn: () => Promise<void>): void` —
    point d'enregistrement pour que `onFileBatchDone`/`runBatchDiscard`
    déclenchent `refresh()` (reste dans `sift-live.ts`) sans import
    statique — même mécanisme que `registerBatchRenderer` (tranche 1b),
    sens inverse.
  - `export function handleBatchAction(el: HTMLElement, act: string, e: MouseEvent): boolean` —
    nouvelle fonction, extraite du bloc `batchpick`→`batchstop` de
    `installLiveWiring` (même pattern que `handleRekordboxAction`,
    tranche 1a). Sa branche `batchstop` appelle `onFileStop()` en interne
    (même module désormais, plus de souci de câblage).
  - `export function onBatchInPlaceChange(checked: boolean): void` —
    extraite du listener `"change"` de `installLiveWiring` (case "file in
    place" du mode Lot) — voir couplage n°3 ci-dessus.
- Consumes (depuis `./queue-panel`, déjà exporté) : `currentItems`,
  `reviewMode`, `verdictDot`, `prefetchNextAfter`, `enterDetailMode`.
- Consumes (imports existants à reporter, à confirmer par lecture) :
  `requireEl`, `esc` depuis `./dom` ; `openFilingInto`, `refreshBinsForBatch`,
  `renderBinsForBatch`, `setBinPickInert`, `clearBinPick` (si utilisé ici),
  `targetExt`, `TARGET_LABEL`, `toggleDestPopover`,
  `repositionDestPopoverIfOpen`, `ensureDestPopoverAutoClose` depuis
  `./filing` (liste de départ — vérifier laquelle est réellement utilisée) ;
  `fileBatch`, `fileCancel`, `rejectBatch` depuis `./ipc` ; `confirmAction`
  depuis `./confirm-modal` ; `setTask`, `clearTask` depuis `./progress-zone`
  (utilisées par `pushFileProgress`/`onFileStop`, qui déménagent aussi —
  voir Architecture) ; `mountProgressZone` depuis `./progress-zone` (si
  utilisée par une fonction batch — vérifier) ; `startBatchTracklist` (ou
  équivalent) depuis `./batch-tracklist` ; `FILE_IN_PLACE`,
  `EXTERNAL_DEST_PREFIX` depuis `../shared/contracts` ; types `Target`,
  `BatchResult`, `FileProgress`. **`setCancelHandler` reste importée
  seulement par `sift-live.ts`** (l'appel `setCancelHandler("file",
  onFileStop)` reste dans `installLiveWiring`, pas dans `batch-panel.ts`).

- [ ] **Step 1: Lire l'état actuel exact de `frontend/sift-live.ts` et confirmer les frontières**

Relire le fichier (commit `9a3d64a`, ou plus récent si divergé — se fier
aux noms de fonctions, pas aux numéros de ligne datés).

État module-niveau à déplacer : `BATCH_CONFIRM_THRESHOLD`,
`batchConfirmArmed`, `batchConfirmTimer`, `batchSel`, `batchSelInit`,
`batchFakeSel`, `batchCollapsed`, `BATCH_GROUP_PAGE`, `batchGroupCap`,
`batchInPlace`, `batchFormat`, `batchTrackIds`, `batchBin`, `batchRunning`,
`fileStopping`, `lastFileProgress`, `fileClearTimer` (ces 3 derniers
prouvés batch-exclusifs malgré leur position actuelle près de
`pushFileProgress`/`onFileStop` — voir section Architecture).

Fonctions nommées à déplacer verbatim : `groupBoxHtml`, `mutateBatchTick`,
`updateBatchRailSelection`, `renderBatch`, `batchDest`, `batchDestLabel`,
`onBatchBinPick`, `ensureBatchDestUI`, `actionButtonHtml`,
`positionBatchFmtThumb`, `renderBatchRail`, `runBatchFile`,
`batchTrackName`, `batchTrackItem`, `refreshBatchTracksPreview`,
`ensureBatchTracklistHost`, `fileNote`, `onFileBatchDone`, `runBatchDiscard`,
`pushFileProgress`, `onFileStop` (ces 2 dernières déplacent aussi
`fileStopping`/`lastFileProgress`/`fileClearTimer` avec elles).

**Exception à "verbatim" pour `onFileBatchDone`/`runBatchDiscard`** : leurs
appels à `refresh()` (`await refresh();` dans les deux cas — vérifier la
forme exacte à la lecture, `await` pas `void`) deviennent des appels au hook
enregistré (voir `registerRefreshHook` ci-dessus et Step 3) : `await
refreshHook?.();`. Aucune autre ligne de ces deux fonctions ne change.

**Exception à "verbatim" pour `batchopen`** (dans le bloc de dispatch,
Step 2) : `setReviewMode("detail")` → `enterDetailMode()` — même raison
qu'en tranche 1b (comportement identique, évite `batch-panel.ts` →
`sift-live.ts`). Aucune autre exception attendue dans cette tranche — mais
si tu trouves une AUTRE fonction de cette liste qui référence quelque chose
d'exclusivement propriété de `queue-panel.ts` en écriture (pas en lecture —
lire `currentItems`/`reviewMode` est déjà prévu) ou de `sift-live.ts`
au-delà de `setReviewMode`, REMONTE-LE (NEEDS_CONTEXT) plutôt que
d'improviser — exactement le type de couplage caché trouvé deux fois en
tranche 1b.

Ne PAS déplacer : `pushAnalyzeProgress`, `runNavExport`, `setReviewMode`
(orchestrateur, reste dans `sift-live.ts`, réécrit à la Step 4), `refresh`,
`installLiveWiring`.

- [ ] **Step 2: Extraire le bloc `batchpick`→`batchstop` en une fonction dédiée**

Dans `installLiveWiring`, le chaînon `data-sift` contient, immédiatement
avant l'appel délégué à `handleRekordboxAction` : `batchpick`, `batchgroup`,
`batchcollapse`, `batchpickfake`, `batchmore`, `batchformat`, `batchopen`,
`batchaction`, `batchstop` — bloc contigu, mêmes garanties de frontière
qu'en tranche 1a (chaîne `else if` sans code interposé d'un autre domaine).

```ts
/** Routes the batch mode's delegated clicks (selection, group toggles, format, confirm-to-file,
 *  stop) — the batchpick/batchgroup/batchcollapse/batchpickfake/batchmore/batchformat/batchopen/
 *  batchaction/batchstop data-sift actions. Extracted from sift-live.ts's installLiveWiring click
 *  handler (Phase 1, tranche 1c) — same split as handleRekordboxAction (1a) and the queue click
 *  handler (1b). Returns true if it handled `act`, false otherwise. */
export function handleBatchAction(el: HTMLElement, act: string, e: MouseEvent): boolean {
  if (act === "batchpick") {
    // corps exact — voir Step 1, copier depuis le fichier source, colonne par colonne identique.
  } else if (act === "batchgroup") {
    // ...
  } else {
    return false;
  }
  return true;
}
```

Le seul changement de logique dans tout ce bloc : `batchopen` appelle
`enterDetailMode()` au lieu de `setReviewMode("detail")` (voir Step 1). Le
`return;` interne à `batchaction` (arm du double-clic) devient `return true;`
pour respecter la signature `boolean` — même mécanisme que `mdbapply` en
tranche 1a.

**N'écris pas le corps complet ici** (contrairement aux tranches 1a/1b où
un extrait anonyme risqué justifiait le collage intégral) : ce bloc est
strictement plus long à retyper qu'à relire directement dans
`frontend/sift-live.ts` aux lignes indiquées par Step 1 (grep `act === "batch`),
et une copie manuelle ici risquerait sa propre divergence. Lis le fichier
source réel, copie-le verbatim toi-même, applique uniquement les deux
changements documentés (`enterDetailMode()`, `return true;`).

- [ ] **Step 3: Créer `frontend/batch-panel.ts`**

En-tête (même esprit que `queue-panel.ts`/`rekordbox-view.ts`) :

```ts
// Revue batch mode panel — selection, group rendering, two-click confirm, batch filing rail.
// Extracted from sift-live.ts (Phase 1, tranche 1c). Reads currentItems/reviewMode/verdictDot
// from queue-panel.ts (leaf-to-leaf import, one direction only — queue-panel.ts never imports
// from here). sift-live.ts's setReviewMode (cross-panel orchestrator, kept there since tranche
// 1b) imports renderBatch + the batch destination state from here for its "batch" branch.
```

Coller verbatim l'état + les fonctions de la Step 1 + `handleBatchAction`
de la Step 2. Importer `currentItems`, `reviewMode`, `verdictDot`,
`prefetchNextAfter`, `enterDetailMode` depuis `./queue-panel`, plus toutes
les dépendances listées dans Interfaces (vérifier chacune par lecture,
liste de départ seulement).

Ajouter aussi (résout le Finding 1, couplage `refresh()`) :

```ts
let refreshHook: (() => Promise<void>) | null = null;

/** Registers sift-live.ts's refresh() (renderHomeSources + renderQueue + updateRevueBadge) so
 *  onFileBatchDone/runBatchDiscard can trigger a full view refresh after filing without a static
 *  import back to sift-live.ts (mirrors registerBatchRenderer in queue-panel.ts, opposite
 *  direction: this module calls OUT to the orchestrator instead of being called INTO). */
export function registerRefreshHook(fn: () => Promise<void>): void {
  refreshHook = fn;
}
```

Et (résout le couplage n°3, listener `"change"`) :

```ts
/** Handles the "file in place" checkbox change (batch mode's #fldz destination toggle) — extracted
 *  from installLiveWiring's dedicated change listener (Phase 1, tranche 1c) so batchInPlace stays
 *  mutated only inside this module. */
export function onBatchInPlaceChange(checked: boolean): void {
  batchInPlace = checked;
  const fldz = document.getElementById("fldz");
  if (fldz) renderBinsForBatch(fldz, batchBin, onBatchBinPick, batchInPlace);
  renderBatchRail(currentItems.filter((it) => it.verdict !== "ok").length);
}
```

- [ ] **Step 4: Retirer le code déplacé de `sift-live.ts`, réécrire `setReviewMode`, câbler**

- Supprimer l'état + les 19 fonctions nommées listées à la Step 1.
- Remplacer le bloc `batchpick`→`batchstop` (Step 2) par :

```ts
    } else if (handleBatchAction(el, act ?? "", e)) {
      // handled — see batch-panel.ts
    } else if (handleRekordboxAction(el, act ?? "", e, () => void runNavExport("rekordbox"))) {
      // handled — see rekordbox-view.ts
    }
```

  (Le chaînon devient : `... reviewmode ... else if (handleBatchAction(...))
  ... else if (handleRekordboxAction(...)) ...` — `handleBatchAction` doit
  précéder `handleRekordboxAction` dans le chaînon, à la même position que
  le bloc batch original.)
- Réécrire `setReviewMode` (reste dans `sift-live.ts`) :

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

  Identique à la version tranche 1b, sauf que `batchGroupCap`/`BATCH_GROUP_PAGE`/
  `renderBatch`/`batchBin`/`onBatchBinPick` sont maintenant des imports
  depuis `./batch-panel` au lieu de références locales.
- Ajouter les imports depuis `./batch-panel` dans `sift-live.ts` :
  `renderBatch`, `batchGroupCap`, `BATCH_GROUP_PAGE`, `batchBin`,
  `batchInPlace`, `onBatchBinPick`, `handleBatchAction`, `pushFileProgress`,
  `onFileStop`, `onFileBatchDone`, `registerRefreshHook`, plus tout autre
  symbole batch encore référencé ailleurs dans `sift-live.ts` après le
  retrait (vérifier chacun individuellement par grep, ne pas présumer).
- `registerBatchRenderer(renderBatch)` (déjà présent depuis la tranche 1b,
  au début de `installLiveWiring`) continue de fonctionner via le nouvel
  import — ne pas dupliquer l'appel.
- Juste après (ou avant, l'ordre entre les deux `register*` n'a pas
  d'importance), ajouter :

```ts
  registerRefreshHook(refresh);
```

- Mettre à jour les 3 lignes de câblage existantes dans `installLiveWiring`
  pour utiliser les imports au lieu des fonctions locales — le nom des
  fonctions ne change pas, seule leur provenance change :

```ts
  void onFileDone(onFileBatchDone);
  void onFileProgress(pushFileProgress);
  setCancelHandler("file", onFileStop);
```

  (Ces 3 lignes existent déjà dans `installLiveWiring` — aucun changement
  de leur propre code, seulement de l'import dont dépendent
  `onFileBatchDone`/`pushFileProgress`/`onFileStop`.)
- Remplacer le corps du listener `"change"` (case "file in place",
  actuellement juste après la fermeture du listener `"click"`) :

```ts
  requireEl("#pa", "installLiveWiring").addEventListener("change", (e) => {
    const ip = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-sift="inplace"]');
    if (ip) onBatchInPlaceChange(ip.checked);
  });
```

  Ajouter `onBatchInPlaceChange` à la liste des imports depuis
  `./batch-panel`.
- Retirer les imports devenus inutiles. **Leçon de la tranche 1b : vérifier
  CHAQUE identifiant individuellement par grep sur le fichier entier avant
  de le garder OU de le retirer — 3 imports morts ont échappé à une
  première passe non exhaustive.**

- [ ] **Step 5: Vérifier**

Run: `npx tsc --noEmit`
Expected: PASS, zéro erreur.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit (après autorisation explicite)**

```bash
git add frontend/batch-panel.ts frontend/sift-live.ts
git commit -m "refactor(frontend): extract batch mode controller into batch-panel.ts

Moves batch selection/rendering/confirm/filing state and functions out of
sift-live.ts into batch-panel.ts, plus a new handleBatchAction extracted
from installLiveWiring's delegated click listener (same split as tranche
1a/1b). batch-panel.ts reads currentItems/reviewMode/verdictDot/
enterDetailMode from queue-panel.ts (leaf-to-leaf, one direction).

Two more hidden couplings found and resolved, same shape as tranche 1b's:
pushFileProgress/onFileStop and the fileStopping/lastFileProgress/
fileClearTimer state they touch turned out to be 100% batch-exclusive
(verified against filing.ts's detail-mode path) and moved too; refresh()
(cross-panel orchestrator, stays in sift-live.ts) is now reached from
onFileBatchDone/runBatchDiscard via a registerRefreshHook() callback
(mirrors registerBatchRenderer, opposite direction) instead of a static
import.

No behavior change, including the BATCH_CONFIRM_THRESHOLD double-click
confirm guard (Phase 1, tranche 1c — see
docs/superpowers/plans/2026-07-13-phase1-tranche1c-batch-controller.md)."
```

---

### Task 2: Vérification manuelle et rapport de fin de tranche

**Files:** aucun changement de code.

- [ ] **Step 1: Checklist comportementale manuelle dans `tauri dev` réel**

Sur des données de test, jamais un vrai `master.db` :
- Bascule Détail/Lot dans les deux sens.
- Sélection individuelle (`batchpick`/`batchpickfake`), sélection de groupe
  (`batchgroup`), repli de groupe (`batchcollapse`), pagination
  (`batchmore`).
- Changement de format (`batchformat`) — thumb glissant correct.
- `batchopen` → retour en mode Détail sur la bonne piste.
- **Confirmation à deux clics** (`batchaction`, >10 pistes) : premier clic
  arme (bouton devient "Confirmer"), n'exécute PAS le filing ; second clic
  dans les 400ms-5s exécute ; passé 5s, désarmé automatiquement. C'est le
  garde-fou anti-incident réel — vérifier avec la plus grande attention.
- `batchstop` interrompt un filing en cours.
- Non-régression : Rekordbox, Revue (file), Écartés, Bibliothèque.

- [ ] **Step 2: Suite Rust**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, 369 tests (aucun fichier Rust touché).

- [ ] **Step 3: Rapport de fin de tranche**

Fichiers modifiés, comportement préservé, taille finale de `sift-live.ts`,
tests exécutés + résultat, risques restants, diff synthétique,
recommandation pour la tranche suivante (1d : progression + événements
globaux — évaluer si encore nécessaire vu ce qui reste dans
`sift-live.ts`).
