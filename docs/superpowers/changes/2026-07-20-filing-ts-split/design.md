# Split frontend/filing.ts — design

> Référence : `TECH_DEBT_AUDIT.md` F03 ("Track `filing.ts` as the next split
> candidate"). Suite naturelle du split Phase 1 de `sift-live.ts`
> (`docs/superpowers/plans/2026-07-13-phase1-*`) et du split déjà fait de
> `filing-bins.ts` (2026-07-15).

## Contexte

`frontend/filing.ts` fait 1660 lignes / 39 fonctions top-level — devenu le plus
gros fichier frontend non décomposé après le split `sift-live.ts`. Aucun bug
trouvé (F03 est classé préventif, pas correctif) mais la taille rend le fichier
coûteux à tenir en tête et à modifier en sécurité.

Grep des fonctions top-level (`awk '/^(export )?(async )?function/'`) fait
apparaître 3 groupes par responsabilité, pas par ordre d'exécution
(cf. `~/.claude/rules/audit/architecture.md` § Décomposition temporelle) :

1. Identification Discogs + éditeur de métadonnées (lignes 300-1035 environ).
2. Actions IPC à effet de bord (apply tags, ranger/file, revert, undo, toast)
   (lignes 1036-1358 environ).
3. État partagé (`RevueState`) + orchestration (`openFilingInto`) + rendu
   couplé à l'état (`renderFoot`, `refreshPreview`, etc.).

## Objectif

Extraire les groupes 1 et 2 dans des modules dédiés, en conservant tout le
comportement observable (refactor pur, aucun changement fonctionnel).
`state`/`openSeq`/`acting` (voir Frontière entre modules) déménagent dans un
module dédié `filing-state.ts`, seul propriétaire — `filing.ts` en devient
consommateur au même titre que les deux nouveaux modules, plus propriétaire
exclusif.

## Portée

**Dans ce chantier** : split de `filing.ts` en 3 fichiers, vérification tsc +
checklist comportementale manuelle.

**Hors scope** : tout changement de comportement UX (pas dans F03), toute
modification du backend Rust, tout autre fichier frontend.

## Design

### Architecture / composants

- **`frontend/filing-identify.ts`** (nouveau, ~600 lignes) — sous-arbre
  identification Discogs + éditeur : `onIdentityApplied`, `identifiedLineHtml`,
  `restoreIdentifiedLine`, `wireCandidateClicks`, `doIdentify`, `renderEditor`,
  `renderGenres`, `tagFieldDiffs`, `refreshDiscrepancy`, `beatportSearchUrl`,
  `refreshRebuyLink`.
- **`frontend/filing-actions.ts`** (nouveau, ~350 lignes) — actions à effet de
  bord + feedback : `doApplyTags`, `doUndoApply`, `doRanger`, `doRevert`,
  `doSecondary`, `toast`, `showFiledConfirm`, `setApplyIdle`, `setApplyApplied`,
  `resetApplyButton`, `setActionsDisabled`.
- **`frontend/filing-state.ts`** (nouveau, ~15 lignes) — seul propriétaire de
  l'état partagé : `state: RevueState`, `openState` (objet mutable
  `{ openSeq, acting }`, voir Frontière ci-dessous). Aucune logique, juste la
  déclaration + son type.
- **`frontend/filing.ts`** (reste, ~700 lignes) — `openFilingInto`
  (orchestrateur), `installFilingKeys`, `installUndoShortcut`, `syncDetail`,
  `renderFoot`, `clearPane`, `dupBanner`, helpers de rendu couplés à l'état
  (`refreshPreview`, `updateHeaderName`, `refreshRangerButton`,
  `refreshFootButton`, `destValueLabel`, `defaultTarget`, `targetExt`,
  `displayName`, `fadeSetText`, `ensureKbdLegend`, `positionFmtThumb`) —
  importe `state`/`openState` depuis `filing-state.ts` comme les deux autres
  modules, ne les possède plus.

### Frontière entre modules (corrigé après revue Codex — voir Historique)

**Constat vérifié sur le code réel** (pas supposé) : `state: RevueState`
(`filing.ts:106`), `openSeq` (`filing.ts:1399`) et `acting` (`filing.ts:1164`)
sont des variables module-globales fermées par closure — `onIdentityApplied`
(`filing.ts:388`), `doApplyTags` (`:1070`), `doRanger` (`:1179`) et les autres
fonctions candidates au split y accèdent directement, **sans** les recevoir en
paramètre. La première rédaction de ce document ("mêmes signatures, juste
déplacées") était donc incorrecte — `filing-bins.ts` n'est pas un précédent
direct ici : il possède son propre état de destination, il n'a jamais eu besoin
de lire `RevueState`.

**Pattern retenu** : `state: RevueState` reste un objet — sa mutation par les
consommateurs (`state.canonical = ...`, déjà le style actuel) fonctionne sans
changement une fois relocalisé, une liaison ES importée interdisant la
RÉASSIGNATION mais pas la mutation de propriété. `openSeq`/`acting` en
revanche sont aujourd'hui des primitives réassignées directement
(`openSeq++`, `acting = true`, `filing.ts:1399,1164`) — un export `let`
réassigné depuis un autre module échouerait à la compilation TS (liaison en
lecture seule côté importeur). Ils sont donc regroupés dans un objet mutable
unique `openState = { openSeq: 0, acting: false }` exporté `const` ; tout
site qui faisait `openSeq++`/`acting = true` devient
`openState.openSeq++`/`openState.acting = true` (mutation de propriété, pas
réassignation — valide en ESM). `frontend/filing-state.ts` exporte `state` et
`openState`, sans logique additionnelle. `filing.ts`, `filing-identify.ts` et
`filing-actions.ts` importent depuis `filing-state.ts` ; aucun des trois
n'importe les deux autres pour de l'état, donc pas de cycle sur cet axe.

**Axe restant à risque (annoncé, pas résolu à l'avance)** : au moins un appel
croisé existe déjà — `onIdentityApplied` (→ `filing-identify.ts`) appelle
`refreshPreview()` (reste dans `filing.ts`). D'autres couplages de ce type
sont probables et **ne seront pas devinés à l'avance** : comme pour les 5
couplages cachés trouvés pendant le split `sift-live.ts` (Phase 1, tranches
1a-1c), l'implémenteur les découvre à l'extraction et les résout par injection
de dépendance (`registerXxx()` enregistré une fois au wiring, même pattern que
`registerOpenTrackPathGetter`/`registerDestChangeHook` de `filing-bins.ts`) —
jamais par un import circulaire. Le plan d'implémentation doit traiter
l'inventaire exact des couplages croisés comme une tâche de découverte, pas
comme un fait déjà établi par ce design.

### Data flow

`openFilingInto` (orchestrateur, reste dans `filing.ts`) appelle les fonctions
exportées de `filing-identify.ts` et `filing-actions.ts` en réaction aux clics
utilisateur — sens d'appel et séquence inchangés, seule la localisation du
code bouge.

### Gestion d'erreur

Aucun nouveau chemin d'erreur — refactor pur, comportement observable
identique avant/après.

### Vérification (pas de suite de tests frontend)

1. `npx tsc --noEmit` après chaque tranche.
2. Checklist comportementale manuelle écrite AVANT le split (même format que
   `docs/superpowers/plans/2026-07-13-phase1-tranche1a-behavior-checklist.md`) :
   identifier un morceau (Discogs), appliquer les tags, ranger (File), annuler
   (Undo), re-sourcer/écarter (Secondary), vérifiée contre la vraie fenêtre
   `tauri dev` par Antoine après chaque tranche.
3. `cargo test`/`clippy` non concernés (frontend uniquement, aucun fichier
   Rust touché).

## Terminé = démontrable

- `filing.ts` ≤ ~750 lignes, `filing-identify.ts` et `filing-actions.ts`
  existent et compilent (`tsc --noEmit` clean).
- Checklist comportementale passée sur la vraie fenêtre `tauri dev` après
  chaque tranche, sans régression.
- Aucun fichier Rust touché, aucun changement de comportement produit.

## Historique

- 2026-07-20 — Révision post codex-crosscheck (lecture seule, HEAD du commit
  design initial) : la section "Frontière entre modules" affirmait que l'état
  serait passé en paramètres avec les signatures actuelles, contredit par le
  code réel (`state`/`openSeq`/`acting` sont des globales de module fermées
  par closure, jamais reçues en paramètre — `filing.ts:106,1164,1399`).
  Corrigé : nouveau module `filing-state.ts` comme propriétaire unique de ces
  3 variables, importé par les 3 fichiers ; les appels croisés restants
  (ex. `onIdentityApplied` → `refreshPreview`) traités par injection de
  dépendance au moment de l'implémentation, pas devinés ici.
