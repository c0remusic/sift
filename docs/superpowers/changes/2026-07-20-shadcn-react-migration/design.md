# Migration Sift vers React + shadcn/ui — plan (pas exécuté)

> Cadré via `interview` le 2026-07-20, en session croisée avec shaderlab
> (`C:\dev\shaderlab\PRD.md`). Ce document fige le QUOI et le POURQUOI ; le
> COMMENT détaillé (découpage en tâches, ordre des écrans) se conçoit via
> `superpowers:brainstorming` quand ce chantier démarre réellement.

## Contexte

Sift (frontend TS vanilla + manipulation DOM, backend Rust/Tauri v2, voir
`PRD.md` racine pour le produit) a son propre design system CSS
(`frontend/styles.css`, ~1400 lignes de composants + tokens `:root`). shaderlab
migre en parallèle vers `shadcn/ui` (React+Tailwind, déjà en place côté
framework). Antoine veut la même base de composants sur les deux projets pour
réduire le coût de maintenance (un changement de token = un seul endroit ; un
nouveau composant = piocher via la CLI shadcn, pas le coder à la main), tout en
gardant l'identité visuelle propre à chaque projet (pas de fusion de palette).

**Pourquoi Sift, pas juste shaderlab** : Sift n'a aucun framework composant —
shadcn (React+Tailwind) ne peut pas s'y greffer sans réécriture du frontend.
« Utiliser shadcn pour Sift » = migrer Sift de TS vanilla vers React, pas
installer une lib par-dessus l'existant.

## Objectif

Réécrire le frontend de Sift en React + Tailwind + shadcn/ui, en conservant
tout le comportement produit actuel (voir `PRD.md` racine — chemin utilisateur,
stations, contraintes d'inacceptable) et la palette/tokens visuels déjà établis
(mappés dans le thème shadcn plutôt que redécidés).

## Portée de CE chantier (2026-07-20)

**Ce PRD-chantier ne couvre QUE la planification.** Décision explicite
d'Antoine : « shaderlab migré, Sift planifié seulement » — donc à ce stade,
aucun code Sift n'est touché. Le jalon « terminé » de cette étape = ce document
validé, pas une migration livrée.

## Comportements attendus (une fois la migration exécutée, futur)

- Quand un composant UI existant (dialog, dropdown, table, bouton) doit
  changer → on modifie/installe un composant shadcn au lieu de retoucher
  `styles.css` à la main.
- Quand un token de couleur/spacing/radius change → un seul endroit (le thème
  shadcn/Tailwind), propagé partout sans resynchronisation manuelle.
- Quand l'app est lancée (`npm run tauri dev` / build release) → le
  comportement produit reste identique à ce que `PRD.md` racine décrit (aucune
  régression fonctionnelle due à la migration de framework).

## Hors-scope explicite (de ce chantier)

- Exécuter la migration elle-même (code) — reporté à une session dédiée future,
  post-brainstorming.
- Changer la palette/l'identité visuelle de Sift (conservée telle quelle,
  simplement portée dans le thème shadcn).
- Toucher à Tuple — exclu de ce chantier (device Max/jweb, aucun chemin
  d'intégration shadcn possible, cf. décision de cadrage session).
- Toucher au backend Rust/Tauri (migration = frontend uniquement).

## Contraintes d'inacceptable

**Projet (héritées de `PRD.md` racine, s'appliquent à toute la migration)** :
- Ne jamais perdre un original, ne jamais dégrader en cachette, ne jamais
  casser Rekordbox — ces trois planchers ne doivent pas être affectés par un
  changement de frontend.

**Chantier (migration elle-même, une fois lancée)** :
- Fenêtre de coupure acceptée par Antoine (pas besoin de migration progressive
  écran-par-écran) — mais l'app doit être fonctionnelle et vérifiée avant de
  déclarer la migration terminée, pas juste "compile".

## Terminé = démontrable

- **Cette étape (planification)** : ce document existe, validé par Antoine —
  pas de code.
- **La migration elle-même (future)** : Sift tourne sur React+shadcn+Tailwind,
  tous les écrans du chemin utilisateur (`PRD.md` racine) fonctionnels,
  vérifiés manuellement ou via captures, palette actuelle préservée.

## Annexe — Choix techniques déduits (à valider au lancement réel du chantier)

- **React + Vite** — Sift utilise déjà Vite (confirmé lors du setup Storybook
  cette session) ; ajouter React au même bundler plutôt qu'un changement d'outil
  de build.
- **Tailwind + shadcn/ui + `components.json`** — même stack que shaderlab, pour
  que les deux projets partagent la même base de composants/CLI.
- **Storybook déjà en place** (`.storybook/`, stories sous `frontend/`) —
  réutilisé tel quel comme visionneuse pendant la migration ; les stories
  existantes (empty-state, error-pattern, segmented-control) servent de
  checklist de comportements à retrouver dans les équivalents React.
- **Backend Rust/Tauri inchangé** — la migration ne touche que
  `frontend/`, la frontière IPC (Tauri commands) reste la même.

---

**Chantier planifié, pas lancé.** Prochaine étape quand Antoine décide de
démarrer : `superpowers:brainstorming` à partir de ce document pour découper la
migration en tranches verticales exécutables.
