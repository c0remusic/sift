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
comportement observable (refactor pur, aucun changement fonctionnel). `filing.ts`
reste le seul propriétaire de `RevueState`.

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
- **`frontend/filing.ts`** (reste, ~700 lignes) — `RevueState` (état
  module-privé, jamais exporté brut), `openFilingInto` (orchestrateur),
  `installFilingKeys`, `installUndoShortcut`, `syncDetail`, `renderFoot`,
  `clearPane`, `dupBanner`, helpers de rendu couplés à l'état (`refreshPreview`,
  `updateHeaderName`, `refreshRangerButton`, `refreshFootButton`,
  `destValueLabel`, `defaultTarget`, `targetExt`, `displayName`,
  `fadeSetText`, `ensureKbdLegend`, `positionFmtThumb`).

### Frontière entre modules (pattern déjà établi par `filing-bins.ts`)

`RevueState` reste privé à `filing.ts`. Les deux nouveaux modules ne
l'importent jamais directement — ils reçoivent les éléments d'état dont ils
ont besoin en paramètres de fonction (mêmes signatures que les fonctions
actuelles, juste déplacées). Si un couplage caché apparaît en cours de split
(cf. précédent des tranches `sift-live.ts` — 5 couplages trouvés et résolus par
injection de dépendance `registerXxx()`), l'implémenteur l'escalade plutôt que
de le deviner, même pattern que `registerOpenTrackPathGetter`/
`registerDestChangeHook` de `filing-bins.ts`.

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
