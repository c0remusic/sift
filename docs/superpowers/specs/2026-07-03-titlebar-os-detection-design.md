# Titlebar — détection OS (design)

> Statut : design validé (brainstorm 2026-07-03). Brique 1/3 du chantier titlebar
> custom (voir `docs/ressources-externes.md`, section "Titlebar custom" — les
> briques 2 (`decorations:false`) et 3 (actions fenêtre) sont déjà livrées dans
> `frontend/chrome.ts`). Non testable en réel : pas de Mac disponible pour
> valider le rendu macOS — code écrit à l'aveugle sur la base de la convention
> macOS connue + doc `tauri-plugin-os`, régression zéro sur Windows visée.

## But

Placer les contrôles de fenêtre custom au bon endroit selon l'OS : feux
tricolores à gauche sur macOS, minimize/maximize/close à droite sur Windows
(comportement actuel, inchangé). Seule brique manquante du chantier titlebar.

## Hors périmètre

- Tooltip sur nom de fenêtre tronqué (gap noté séparément dans CLAUDE.md, pas
  traité dans cette passe).
- Glyphe maximize → restore dynamique quand déjà maximisé (idem, pas traité ici).
- Tout style Linux spécifique — Linux tombe sur le layout Windows par défaut
  (comportement actuel, pas une régression : c'est déjà ce qui se passe).

## Approche

`tauri-plugin-os` (officiel) exposé côté frontend via `platform()`
(`@tauri-apps/plugin-os`). `injectTitlebar()` dans `frontend/chrome.ts` devient
`async`, résout la plateforme une fois au montage, et rend l'un des deux
layouts :
- **Windows/Linux/autre** (défaut, y compris si `platform()` échoue) : markup
  actuel inchangé, boutons à droite, glyphes `ti-minus`/`ti-square`/`ti-x`.
- **macOS** : 3 pastilles rondes (rouge/jaune/vert) à gauche, mêmes actions
  (`close`/`minimize`/`toggleMaximize`), zone de drag ajustée.

Alternative écartée : détection via `navigator.platform`/`userAgent` —
déprécié et non fiable dans une WebView Tauri (pas d'user-agent custom
garanti cross-plateforme). `tauri-plugin-os` est la seule source fiable ici.

## Composants

- `src-tauri/Cargo.toml` : ajout dépendance `tauri-plugin-os`.
- `src-tauri/src/lib.rs` : `.plugin(tauri_plugin_os::init())` dans le builder.
- `package.json` : ajout `@tauri-apps/plugin-os`.
- `frontend/chrome.ts` :
  - `injectTitlebar()` devient `async fn`, appelle `platform()` une fois.
  - Nouvelle fonction pure `controlsMarkup(isMac: boolean): string` (rend l'un
    ou l'autre layout) — testable/lisible séparément du DOM.
  - CSS ajouté dans le bloc de style injecté existant (mêmes tokens
    `--color-*`, pas de littéral).

## Données

Aucune persistance. Détection une fois par session au montage — l'OS ne
change pas en cours d'exécution.

## Gestion d'erreurs

`platform()` qui rejette (cas limite, plugin mal initialisé) → fallback sur
le layout Windows actuel (comportement 100% existant), jamais un écran
cassé. C'est le seul fallback silencieux acceptable ici : c'est littéralement
le comportement déjà en place aujourd'hui pour 100% des utilisateurs.

## Tests

Pas de test Rust utile (le plugin est juste enregistré, zéro logique métier
ajoutée côté backend — pas de fonction à unit-tester). Côté front, TS vanilla
sans harness (comme le reste de `chrome.ts`) : `controlsMarkup(isMac)` reste
une fonction pure facilement relisable en revue, mais pas testée
automatiquement. **Vérification manuelle impossible avant qu'un Mac soit
disponible** — le rendu macOS reste non confirmé visuellement après cette
implémentation ; seule la non-régression Windows (`npm run tauri dev` sur
cette machine) est vérifiable maintenant.
