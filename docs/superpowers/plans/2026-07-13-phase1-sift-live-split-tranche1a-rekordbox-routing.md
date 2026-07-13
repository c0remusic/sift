# Phase 1 (tranche 1a) — Extraire le routage des actions Rekordbox de `sift-live.ts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réduire `frontend/sift-live.ts` en déplaçant le routage des 20 actions
Rekordbox (`rkbreexport`, `mdb*`, `mds*`, `mas*`) hors du handler de clic
délégué géant vers `frontend/rekordbox-view.ts`, sans changement de
comportement observable.

**Architecture:** Le bloc `else if (act === "rkbreexport")` … `else if (act
=== "masapply")` (lignes 1722-2011 de `sift-live.ts`, 290 lignes, 20
branches) est déplacé tel quel dans une nouvelle fonction exportée
`handleRekordboxAction` de `rekordbox-view.ts` — le fichier où vit déjà tout
l'état Rekordbox qu'il manipule (`mdbRepairSel`, `mdsSyncSel`, `masSyncSel`,
etc.). `sift-live.ts` l'appelle depuis son handler de clic existant et
retourne tôt si elle a géré l'action. Un préalable (tranche 1a-0) déplace la
fonction `toast()` — utilisée par le bloc extrait mais privée à
`sift-live.ts` — vers `frontend/dom.ts`, le module de helpers déjà partagé
par les deux fichiers, pour éviter toute dépendance circulaire.

**Tech Stack:** Vite vanilla TypeScript, aucun framework, aucun bus
d'événements générique. Pas de runner de tests frontend existant
(`package.json` ne déclare ni vitest ni jest) — la vérification comportementale
passe par `tsc --noEmit` + une checklist manuelle vérifiée dans la vraie
fenêtre `tauri dev` (voir `CLAUDE.md`, section "Vérification UI").

## Global Constraints

- Vite vanilla TS conservé — pas de React/Vue/Redux/bus d'événements générique.
- Identifiants DOM et contrats Tauri existants préservés à l'identique.
- Pas d'état global dupliqué (un seul point de vérité par donnée d'état).
- Chaque extraction validée indépendamment avant la suivante.
- Zéro changement de comportement observable (mêmes IDs DOM, mêmes
  événements, mêmes appels IPC, même UX de confirmation avant écriture
  `master.db`).
- Jamais deux commandes Cargo/Tauri concurrentes ; ne jamais toucher un vrai
  `master.db` Rekordbox pendant les tests.
- Commit uniquement après autorisation explicite de l'utilisateur pour
  chaque commit (règle projet — ne pas committer automatiquement en fin de
  tâche).
- Spec source : `docs/superpowers/specs/2026-07-13-architecture-evolution-design.md`,
  section 4 (Phase 1).

---

### Task 0: Déplacer `toast()` dans `frontend/dom.ts`

**Files:**
- Modify: `frontend/dom.ts` (ajout)
- Modify: `frontend/sift-live.ts:628-639` (suppression de la définition
  locale, ajout de l'import)

**Interfaces:**
- Consumes: rien (fonction pure, zéro dépendance externe).
- Produces: `export function toast(message: string): void` depuis
  `frontend/dom.ts` — consommée par `sift-live.ts` et par
  `rekordbox-view.ts` (Task 2 de ce plan).

- [ ] **Step 1: Ajouter `toast` à `frontend/dom.ts`**

Ajouter à la fin de `frontend/dom.ts` (après `esc`), en conservant le
commentaire existant tel quel :

```ts
/** A transient bottom-right toast (mirrors filing.ts/library-detail.ts, no undo affordance). */
export function toast(message: string): void {
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

- [ ] **Step 2: Supprimer la définition locale dans `sift-live.ts` et importer depuis `dom.ts`**

Dans `frontend/sift-live.ts`, supprimer les lignes 628-639 (la fonction
`toast` complète, y compris son commentaire JSDoc).

Modifier la ligne d'import existante (actuellement `import { requireEl, esc }
from "./dom";`, ligne 63) :

```ts
import { requireEl, esc, toast } from "./dom";
```

Ne rien changer d'autre : tous les appels `toast(...)` existants dans
`sift-live.ts` continuent de fonctionner via l'import.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit`
Expected: PASS, zéro erreur (aucune référence non résolue à `toast`).

- [ ] **Step 4: Commit (après autorisation explicite)**

```bash
git add frontend/dom.ts frontend/sift-live.ts
git commit -m "refactor(frontend): move toast() to dom.ts as a shared helper

Prep for extracting Rekordbox action routing into rekordbox-view.ts (Phase 1,
tranche 1a) — the extracted code needs toast() without creating a circular
import back into sift-live.ts."
```

---

### Task 1: Checklist de comportement (substitut de caractérisation)

Aucun runner de tests frontend n'existe sur Sift (`package.json` : pas de
vitest/jest). Le seam de sécurité pour cette extraction est une checklist
manuelle vérifiée dans la vraie fenêtre `tauri dev` — avant l'extraction (état
de référence) puis après (Task 3), suivant la même discipline que
`CLAUDE.md` section "Vérification UI".

**Files:**
- Create: `docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md`

- [ ] **Step 1: Écrire la checklist**

Créer `docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md` :

```markdown
# Checklist comportementale — routage actions Rekordbox (avant/après extraction)

Vérifié dans `tauri dev` réel, page Rekordbox (`renderRekordboxLive`), avec
au moins un candidat en attente par section (Tier 1/2/3 texte/3 pochette) —
sur des données de test, jamais un vrai `master.db`.

## Export
- [ ] Bouton "Réexporter" (`rkbreexport`) déclenche `runNavExport("rekordbox")`
  — statut de lien Rekordbox rafraîchi après.

## Tier 1 — réparations de chemin (`mdb*`)
- [ ] `mdbpick` : clic sur une ligne candidate coche/décoche sa sélection
  (checkbox visuel synchronisé), ne rafraîchit QUE la section réparations.
- [ ] `mdbgrouptoggle` : clic sur l'en-tête de groupe replie/déplie le
  groupe.
- [ ] `mdbgroupselect` : clic sur la sélection de groupe coche/décoche tous
  les IDs du groupe (tri-state : partiel → tout sélectionner, complet →
  tout désélectionner).
- [ ] `mdbdismiss` : ignore une ligne, elle disparaît de la liste pending.
- [ ] `mdbresolve` : résolution manuelle d'un candidat ambigu vers le bon
  chemin.
- [ ] `mdbapply` : nécessite une confirmation `confirmAction` avant
  d'écrire ; annuler la confirmation → aucun appel IPC ; confirmer → applique,
  toast de résultat (N synchronisés / N échoués), rafraîchit la page.
- [ ] `mdbdedup` : idem confirmation avant `rekordboxMasterdbDedupPlaylistGroup`.

## Tier 3 métadonnées (`mds*`)
- [ ] `mdspick`/`mdsgrouptoggle`/`mdsgroupselect`/`mdsdismiss`/`mdsresolve`/
  `mdsapply` : même comportement que Tier 1, section métadonnées seule
  rafraîchie.

## Tier 3 pochette (`mas*`)
- [ ] `maspick`/`masgrouptoggle`/`masgroupselect`/`masdismiss`/`masresolve`/
  `masapply` : même comportement que Tier 1, section pochette seule
  rafraîchie.

## Non-régression des autres écrans (le handler de clic est partagé)
- [ ] Écran Revue : sélection de piste dans la file, mode Lot, toujours OK.
- [ ] Écran Écartés : trash/restore/requeue/purge toujours OK.
- [ ] Écran Bibliothèque : facettes/tri/édition toujours OK.
```

- [ ] **Step 2: Remplir la colonne "avant" en cochant chaque case dans `tauri dev` réel avant toute extraction, sur l'état actuel du code.**

Aucune commande automatisée — vérification manuelle, résultat noté dans le
rapport de fin de tâche (Task 3).

---

### Task 2: Extraire le routage des actions Rekordbox — créer `handleRekordboxAction` et le brancher depuis `sift-live.ts`

> Fusion des tranches "créer la fonction" et "retirer le bloc d'origine" en
> une seule tâche/commit : prises séparément, elles laisseraient un état
> intermédiaire où la même logique existe en double (dans
> `rekordbox-view.ts` ET encore dans `sift-live.ts`) — un défaut qu'un
> reviewer relirait à raison sur un diff intermédiaire. Ce n'est qu'un seul
> mouvement de code atomique.

**Files:**
- Modify: `frontend/rekordbox-view.ts` (ajout de la fonction + imports)
- Modify: `frontend/sift-live.ts:1722-2011` (suppression du bloc, remplacé
  par un appel délégué)
- Modify: `frontend/sift-live.ts` imports (retrait des imports devenus
  inutiles, ajout de `handleRekordboxAction`)
- Read only (pour copier le bloc exact) : `frontend/sift-live.ts:1722-2011`

**Interfaces:**
- Consumes (déjà exportés par `rekordbox-view.ts` lui-même, donc accès
  direct sans nouvel import une fois le code déplacé) :
  `mdbRepairSel`, `mdbErrorById`, `mdbDedupErrorByKey`, `mdsSyncSel`,
  `mdsErrorById`, `masSyncSel`, `masErrorById`, `lastScannedDuplicateGroups`,
  `duplicateGroupKey`, `rerenderMasterdbRepairsSection`,
  `rerenderMetadataSyncsSection`, `rerenderArtworkSyncsSection`,
  `mdbExpandedGroups`, `mdsExpandedGroups`, `masExpandedGroups`,
  `lastPendingRepairs`, `lastPendingMetadataSyncs`, `lastPendingArtworkSyncs`,
  `idsInSessionGroup`, `renderRekordboxLive`.
- Consumes (nouveaux imports requis dans `rekordbox-view.ts`) :
  `toast` depuis `./dom` (Task 0), `confirmAction` depuis `./confirm-modal`,
  les 10 fonctions IPC `rekordboxMasterdb*` depuis `./ipc`
  (`rekordboxMasterdbDismissRepair`, `rekordboxMasterdbResolveAmbiguous`,
  `rekordboxMasterdbApplyRepairs`, `rekordboxMasterdbDedupPlaylistGroup`,
  `rekordboxMasterdbDismissMetadataSync`,
  `rekordboxMasterdbResolveAmbiguousMetadataSync`,
  `rekordboxMasterdbApplyMetadataSyncs`, `rekordboxMasterdbDismissArtworkSync`,
  `rekordboxMasterdbResolveAmbiguousArtworkSync`,
  `rekordboxMasterdbApplyArtworkSyncs`), et le type
  `ApplyMetadataSyncOutcome` depuis `../shared/contracts`.
- Produces: `export function handleRekordboxAction(el: HTMLElement, act:
  string, e: MouseEvent, onReexport: () => void): boolean` — retourne `true`
  si l'action a été gérée (l'appelant doit `return` immédiatement après),
  `false` sinon. Consommée par `sift-live.ts` dans cette même tâche.

- [ ] **Step 1: Lire le bloc source exact**

Lire `frontend/sift-live.ts` lignes 1722 à 2011 (les 20 branches
`rkbreexport` → `masapply`, jusqu'à la ligne juste avant la fermeture du
`if (!el) return;` chain — ne pas inclure la ligne `});` de fermeture du
listener à la ligne 2012).

- [ ] **Step 2: Ajouter les imports nécessaires en tête de `frontend/rekordbox-view.ts`**

Ajouter (fusionner avec les imports existants plutôt que dupliquer un bloc
`import` séparé) :

```ts
import { toast } from "./dom";
import { confirmAction } from "./confirm-modal";
import {
  rekordboxMasterdbDismissRepair,
  rekordboxMasterdbResolveAmbiguous,
  rekordboxMasterdbApplyRepairs,
  rekordboxMasterdbDedupPlaylistGroup,
  rekordboxMasterdbDismissMetadataSync,
  rekordboxMasterdbResolveAmbiguousMetadataSync,
  rekordboxMasterdbApplyMetadataSyncs,
  rekordboxMasterdbDismissArtworkSync,
  rekordboxMasterdbResolveAmbiguousArtworkSync,
  rekordboxMasterdbApplyArtworkSyncs,
} from "./ipc";
import type { ApplyMetadataSyncOutcome } from "../shared/contracts";
```

(Si `ApplyMetadataSyncOutcome` ou l'une de ces fonctions IPC est déjà
importée dans `rekordbox-view.ts` — vérifier avant d'ajouter — ne pas
dupliquer l'import, l'ajouter à la liste existante.)

- [ ] **Step 3: Ajouter la fonction `handleRekordboxAction`**

Ajouter à la fin de `frontend/rekordbox-view.ts` :

```ts
/** Routes the Rekordbox master.db action panel's delegated clicks (Tier 1 path repairs, Tier 3
 *  metadata/artwork sync — the `rkbreexport`/`mdb*`/`mds*`/`mas*` `data-sift` actions). Extracted
 *  from sift-live.ts's installLiveWiring click handler (Phase 1, tranche 1a) — this state already
 *  lived here, the dispatch logic follows it. Returns true if it handled `act` (caller must stop
 *  processing), false otherwise so the caller's chain can continue to non-Rekordbox actions.
 *  `onReexport` is injected because the actual XML export (`runNavExport`) also serves the USB nav
 *  icon and stays in sift-live.ts — this avoids a reverse import back into sift-live.ts. */
export function handleRekordboxAction(
  el: HTMLElement,
  act: string,
  e: MouseEvent,
  onReexport: () => void,
): boolean {
  if (act === "rkbreexport") {
    e.stopPropagation();
    onReexport();
  } else if (act === "mdbpick") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (mdbRepairSel.has(id)) {
      mdbRepairSel.delete(id);
    } else {
      mdbRepairSel.add(id);
      mdbErrorById.delete(id);
    }
    rerenderMasterdbRepairsSection();
  } else if (act === "mdbgrouptoggle") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    if (mdbExpandedGroups.has(key)) mdbExpandedGroups.delete(key);
    else mdbExpandedGroups.add(key);
    rerenderMasterdbRepairsSection();
  } else if (act === "mdbgroupselect") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    const ids = idsInSessionGroup(lastPendingRepairs, key);
    const allSelected = ids.length > 0 && ids.every((id) => mdbRepairSel.has(id));
    for (const id of ids) {
      if (allSelected) mdbRepairSel.delete(id);
      else {
        mdbRepairSel.add(id);
        mdbErrorById.delete(id);
      }
    }
    rerenderMasterdbRepairsSection();
  } else if (act === "mdbdismiss") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    void (async () => {
      try {
        await rekordboxMasterdbDismissRepair(id);
      } catch (e) {
        console.error("rekordbox_masterdb_dismiss_repair failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdbresolve") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const trackId = el.dataset.track || "";
    void (async () => {
      try {
        await rekordboxMasterdbResolveAmbiguous(id, trackId);
      } catch (e) {
        console.error("rekordbox_masterdb_resolve_ambiguous failed", e);
        toast("Choix impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdbapply") {
    e.stopPropagation();
    const ids = [...mdbRepairSel];
    if (!ids.length) return true;
    void (async () => {
      const proceed = await confirmAction(
        `Synchroniser ${ids.length} fichier${ids.length > 1 ? "s" : ""} avec Rekordbox ? Ferme Rekordbox avant de continuer.`,
        "Synchroniser",
      );
      if (!proceed) return;
      try {
        const outcomes = await rekordboxMasterdbApplyRepairs(ids);
        let ok = 0;
        for (const o of outcomes) {
          mdbRepairSel.delete(o.id);
          if (o.ok) {
            mdbErrorById.delete(o.id);
            ok++;
          } else {
            mdbErrorById.set(o.id, o.error || "échec inconnu");
          }
        }
        const failed = outcomes.length - ok;
        toast(
          failed > 0
            ? `${ok} fichier${ok > 1 ? "s" : ""} synchronisé${ok > 1 ? "s" : ""}, ${failed} échoué${failed > 1 ? "s" : ""}`
            : `${ok} fichier${ok > 1 ? "s" : ""} synchronisé${ok > 1 ? "s" : ""}`,
        );
      } catch (e) {
        console.error("rekordbox_masterdb_apply_repairs failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdbdedup") {
    e.stopPropagation();
    const idx = Number(el.dataset.idx);
    const group = lastScannedDuplicateGroups[idx];
    if (!group) return true;
    void (async () => {
      const proceed = await confirmAction(
        `Synchroniser cette playlist avec Rekordbox — retirer ${group.remove.length} doublon${group.remove.length > 1 ? "s" : ""} ? Ferme Rekordbox avant de continuer.`,
        "Synchroniser",
      );
      if (!proceed) return;
      const key = duplicateGroupKey(group);
      try {
        await rekordboxMasterdbDedupPlaylistGroup(group);
        mdbDedupErrorByKey.delete(key);
        toast(`${group.remove.length} doublon${group.remove.length > 1 ? "s" : ""} retiré${group.remove.length > 1 ? "s" : ""}`);
      } catch (e) {
        console.error("rekordbox_masterdb_dedup_playlist_group failed", e);
        mdbDedupErrorByKey.set(key, e instanceof Error ? e.message : "échec inconnu");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdspick") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (mdsSyncSel.has(id)) {
      mdsSyncSel.delete(id);
    } else {
      mdsSyncSel.add(id);
      mdsErrorById.delete(id);
    }
    rerenderMetadataSyncsSection();
  } else if (act === "mdsgrouptoggle") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    if (mdsExpandedGroups.has(key)) mdsExpandedGroups.delete(key);
    else mdsExpandedGroups.add(key);
    rerenderMetadataSyncsSection();
  } else if (act === "mdsgroupselect") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    const ids = idsInSessionGroup(lastPendingMetadataSyncs, key);
    const allSelected = ids.length > 0 && ids.every((id) => mdsSyncSel.has(id));
    for (const id of ids) {
      if (allSelected) mdsSyncSel.delete(id);
      else {
        mdsSyncSel.add(id);
        mdsErrorById.delete(id);
      }
    }
    rerenderMetadataSyncsSection();
  } else if (act === "mdsdismiss") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    void (async () => {
      try {
        await rekordboxMasterdbDismissMetadataSync(id);
      } catch (e) {
        console.error("rekordbox_masterdb_dismiss_metadata_sync failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdsresolve") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const trackId = el.dataset.track || "";
    void (async () => {
      try {
        await rekordboxMasterdbResolveAmbiguousMetadataSync(id, trackId);
      } catch (e) {
        console.error("rekordbox_masterdb_resolve_ambiguous_metadata_sync failed", e);
        toast("Choix impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "mdsapply") {
    e.stopPropagation();
    const ids = [...mdsSyncSel];
    if (!ids.length) return true;
    void (async () => {
      const proceed = await confirmAction(
        `Synchroniser les métadonnées de ${ids.length} morceau${ids.length > 1 ? "x" : ""} avec Rekordbox ? Ferme Rekordbox avant de continuer.`,
        "Synchroniser",
      );
      if (!proceed) return;
      try {
        const outcomes: ApplyMetadataSyncOutcome[] = await rekordboxMasterdbApplyMetadataSyncs(ids);
        let ok = 0;
        for (const o of outcomes) {
          mdsSyncSel.delete(o.id);
          if (o.ok) {
            mdsErrorById.delete(o.id);
            ok++;
          } else {
            mdsErrorById.set(o.id, o.error || "échec inconnu");
          }
        }
        const failed = outcomes.length - ok;
        toast(
          failed > 0
            ? `${ok} morceau${ok > 1 ? "x" : ""} synchronisé${ok > 1 ? "s" : ""}, ${failed} échoué${failed > 1 ? "s" : ""}`
            : `${ok} morceau${ok > 1 ? "x" : ""} synchronisé${ok > 1 ? "s" : ""}`,
        );
      } catch (e) {
        console.error("rekordbox_masterdb_apply_metadata_syncs failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "maspick") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (masSyncSel.has(id)) {
      masSyncSel.delete(id);
    } else {
      masSyncSel.add(id);
      masErrorById.delete(id);
    }
    rerenderArtworkSyncsSection();
  } else if (act === "masgrouptoggle") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    if (masExpandedGroups.has(key)) masExpandedGroups.delete(key);
    else masExpandedGroups.add(key);
    rerenderArtworkSyncsSection();
  } else if (act === "masgroupselect") {
    e.stopPropagation();
    const key = el.dataset.session || "";
    const ids = idsInSessionGroup(lastPendingArtworkSyncs, key);
    const allSelected = ids.length > 0 && ids.every((id) => masSyncSel.has(id));
    for (const id of ids) {
      if (allSelected) masSyncSel.delete(id);
      else {
        masSyncSel.add(id);
        masErrorById.delete(id);
      }
    }
    rerenderArtworkSyncsSection();
  } else if (act === "masdismiss") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    void (async () => {
      try {
        await rekordboxMasterdbDismissArtworkSync(id);
      } catch (e) {
        console.error("rekordbox_masterdb_dismiss_artwork_sync failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "masresolve") {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const trackId = el.dataset.track || "";
    void (async () => {
      try {
        await rekordboxMasterdbResolveAmbiguousArtworkSync(id, trackId);
      } catch (e) {
        console.error("rekordbox_masterdb_resolve_ambiguous_artwork_sync failed", e);
        toast("Choix impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else if (act === "masapply") {
    e.stopPropagation();
    const ids = [...masSyncSel];
    if (!ids.length) return true;
    void (async () => {
      const proceed = await confirmAction(
        `Synchroniser la pochette de ${ids.length} morceau${ids.length > 1 ? "x" : ""} avec Rekordbox ? Ferme Rekordbox avant de continuer.`,
        "Synchroniser",
      );
      if (!proceed) return;
      try {
        const outcomes = await rekordboxMasterdbApplyArtworkSyncs(ids);
        let ok = 0;
        for (const o of outcomes) {
          masSyncSel.delete(o.id);
          if (o.ok) {
            masErrorById.delete(o.id);
            ok++;
          } else {
            masErrorById.set(o.id, o.error || "échec inconnu");
          }
        }
        const failed = outcomes.length - ok;
        toast(
          failed > 0
            ? `${ok} pochette${ok > 1 ? "s" : ""} synchronisée${ok > 1 ? "s" : ""}, ${failed} échouée${failed > 1 ? "s" : ""}`
            : `${ok} pochette${ok > 1 ? "s" : ""} synchronisée${ok > 1 ? "s" : ""}`,
        );
      } catch (e) {
        console.error("rekordbox_masterdb_apply_artwork_syncs failed", e);
        toast("Action impossible — réessaie");
      }
      void renderRekordboxLive();
    })();
  } else {
    return false;
  }
  return true;
}
```

Ce corps est une copie verbatim des lignes 1722-2011 de `sift-live.ts` au
moment du diagnostic (commit `30e06ff`), avec exactement deux changements :
le premier bras (`rkbreexport`) appelle `onReexport()` au lieu de
`runNavExport("rekordbox")` directement, et les trois `return;` internes aux
branches `mdbapply`/`mdbdedup`/`mdsapply`/`masapply` qui sortaient
auparavant de la fonction `installLiveWiring` (type `void`) sont devenus
`return true;` pour respecter la signature `boolean` de
`handleRekordboxAction` — sans changement de comportement runtime (dans les
deux cas, la fonction s'arrête et le clic a été traité). Si le fichier a
changé depuis ce commit, relire `frontend/sift-live.ts:1722-2011` avant de
coller pour confirmer qu'aucune branche n'a été ajoutée/modifiée entre-temps.

- [ ] **Step 4: Remplacer les lignes 1722-2011 de `sift-live.ts` par un appel délégué**

Remplacer tout le bloc (de `} else if (act === "rkbreexport") {` ligne 1722
jusqu'à la fin de la branche `masapply`, juste avant la fermeture du
`if (act === "addsrc") { ... }` chain à la ligne 2011) par :

```ts
    } else if (handleRekordboxAction(el, act ?? "", e, () => void runNavExport("rekordbox"))) {
      // handled — see rekordbox-view.ts
    }
```

- [ ] **Step 5: Retirer les imports devenus inutiles dans `sift-live.ts`**

Dans le bloc d'import du haut de fichier (lignes 3-35 et 73-94), retirer
UNIQUEMENT les identifiants qui n'apparaissent plus nulle part ailleurs dans
`sift-live.ts` après la Step 4. Vérifier chacun individuellement plutôt que
d'en présumer la liste — au minimum, ces 10 imports IPC
(`rekordboxMasterdbApplyRepairs`, `rekordboxMasterdbDismissRepair`,
`rekordboxMasterdbResolveAmbiguous`, `rekordboxMasterdbDedupPlaylistGroup`,
`rekordboxMasterdbApplyMetadataSyncs`, `rekordboxMasterdbDismissMetadataSync`,
`rekordboxMasterdbResolveAmbiguousMetadataSync`,
`rekordboxMasterdbApplyArtworkSyncs`, `rekordboxMasterdbDismissArtworkSync`,
`rekordboxMasterdbResolveAmbiguousArtworkSync`) et
`ApplyMetadataSyncOutcome`, `mdbRepairSel`, `mdbErrorById`,
`mdbDedupErrorByKey`, `mdsSyncSel`, `mdsErrorById`, `masSyncSel`,
`masErrorById`, `lastScannedDuplicateGroups`, `duplicateGroupKey`,
`rerenderMasterdbRepairsSection`, `rerenderMetadataSyncsSection`,
`rerenderArtworkSyncsSection`, `mdbExpandedGroups`, `mdsExpandedGroups`,
`masExpandedGroups`, `lastPendingRepairs`, `lastPendingMetadataSyncs`,
`lastPendingArtworkSyncs`, `idsInSessionGroup` sont candidats — NE PAS
retirer `renderRekordboxLive` (toujours utilisé ailleurs, ex.
`window.__siftRkb`).

- [ ] **Step 6: Ajouter l'import de `handleRekordboxAction`**

Ajouter `handleRekordboxAction` à l'import existant depuis
`./rekordbox-view` (celui qui importe déjà `mdbRepairSel` etc. avant
nettoyage — fusionner, ne pas dupliquer l'`import { ... } from
"./rekordbox-view";`).

- [ ] **Step 7: Vérifier**

Run: `npx tsc --noEmit`
Expected: PASS, zéro erreur, zéro import inutilisé signalé.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit (après autorisation explicite)**

```bash
git add frontend/rekordbox-view.ts frontend/sift-live.ts
git commit -m "refactor(frontend): extract Rekordbox action routing into rekordbox-view.ts

Moves the 20-branch rkbreexport/mdb*/mds*/mas* data-sift dispatch out of
sift-live.ts's installLiveWiring click handler into handleRekordboxAction,
next to the state it already manipulates (mdbRepairSel, mdsSyncSel,
masSyncSel, etc.). sift-live.ts now delegates a single call, no behavior
change (Phase 1, tranche 1a — see docs/superpowers/plans/2026-07-13-phase1-sift-live-split-tranche1a-rekordbox-routing.md)."
```

---

### Task 3: Vérification manuelle et rapport de fin de tranche

**Files:** aucun changement de code — validation uniquement.

- [ ] **Step 1: Lancer `tauri dev` et rejouer la checklist de la Task 1**

Cocher chaque case de
`docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md`
dans la vraie fenêtre `tauri dev` (jamais la démo web `preview_*` — les
appels IPC réels n'y tournent pas). Sur des données de test, jamais un vrai
`master.db`.

- [ ] **Step 2: Lancer la suite Rust (aucun fichier Rust modifié par cette
  tranche, mais confirme l'absence de régression croisée)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, même nombre de tests qu'avant la tranche.

- [ ] **Step 3: Rédiger le rapport de fin de tranche**

Suivant le gabarit de la spec (section 10) : fichiers modifiés,
comportement préservé (checklist Task 1 avant/après), décisions
architecturales (extraction du dispatch Rekordbox hors du pattern
"dispatch centralisé" documenté dans `AGENTS.md`, décision volontaire et
scoping à ce seul domaine), tests exécutés + résultat, risques restants
(queue/batch/progression/events globaux restent à traiter dans les
tranches suivantes de la Phase 1, chacune nécessitant sa propre analyse de
couplage — `reviewMode`/`batchConfirmArmed`/`currentItems` sont
partagés entre plusieurs candidats et n'ont pas encore été démêlés), diff
synthétique, recommandation (tranche 1b : contrôleur de file/sélection
Revue, ou tranche 1c : contrôleur de mode lot — à trancher après lecture
détaillée du couplage `reviewMode`/`batchConfirmArmed` entre les deux).

- [ ] **Step 4: Arrêt — attendre l'autorisation avant la tranche suivante ou le commit**

Ne pas committer sans autorisation explicite (règle projet). Ne pas
enchaîner sur la tranche 1b sans validation du rapport.
