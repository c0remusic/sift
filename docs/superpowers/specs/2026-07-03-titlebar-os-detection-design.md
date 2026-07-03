# Titlebar — détection OS + 2 gaps résiduels (design)

> Statut : design validé (brainstorm 2026-07-03, périmètre étendu le même jour
> à la demande d'Antoine). Brique 1/3 du chantier titlebar custom (voir
> `docs/ressources-externes.md`, section "Titlebar custom" — les briques 2
> (`decorations:false`) et 3 (actions fenêtre) sont déjà livrées dans
> `frontend/chrome.ts`), plus les 2 gaps mineurs déjà notés dans CLAUDE.md pour
> la même barre (tooltip nom tronqué, glyphe maximize/restore dynamique).
> Détection OS non testable en réel : pas de Mac disponible pour valider le
> rendu macOS — code écrit à l'aveugle sur la base de la convention macOS
> connue + doc `tauri-plugin-os`, régression zéro sur Windows visée. Les 2
> gaps résiduels, eux, sont pleinement vérifiables sur cette machine (Windows).

## But

1. Placer les contrôles de fenêtre custom au bon endroit selon l'OS : feux
   tricolores à gauche sur macOS, minimize/maximize/close à droite sur Windows
   (comportement actuel, inchangé).
2. Le nom de fenêtre (`#sift-tb-title`) tronque proprement (ellipsis) au lieu
   de déborder, et porte un `title` natif (tooltip) reprenant le texte complet.
3. Le bouton "Agrandir" bascule visuellement en "Restaurer" (icône +
   `title`/`aria-label`) dès que la fenêtre est maximisée — par clic sur le
   bouton lui-même, mais aussi par tout autre moyen de (dé)maximiser (double-clic
   sur la barre, raccourci OS, glisser-déposer sur les bords d'écran).

Ferme les 3 gaps connus de la titlebar custom.

## Hors périmètre

- Tout style Linux spécifique — Linux tombe sur le layout Windows par défaut
  (comportement actuel, pas une régression : c'est déjà ce qui se passe).
- Double-clic sur la barre pour maximiser/restaurer — pas demandé, pas dans
  les 3 gaps listés en CLAUDE.md, YAGNI.

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

**Tooltip nom tronqué** : ajouter `overflow:hidden;text-overflow:ellipsis;
white-space:nowrap;min-width:0` sur `#sift-tb-title` (aujourd'hui sans limite,
le texte est statique "Sift" donc jamais tronqué en pratique — mais rien
n'empêchait un débordement moche si ce texte devenait dynamique un jour), et
poser l'attribut natif `title="…"` en miroir du texte affiché à la création.
Pas de logique JS de détection de troncature réelle nécessaire : un `title`
natif s'affiche toujours au survol, tronqué ou non — c'est le comportement
standard du navigateur, pas une réinvention.

**Glyphe maximize/restore dynamique** : icône Tabler `ti-restore` (existe,
vérifiée) remplace `ti-square` quand la fenêtre est maximisée, avec
`title`/`aria-label` "Restaurer" au lieu de "Agrandir". Détection de l'état
maximisé via l'API `@tauri-apps/api/window` : `w.isMaximized()` à
l'initialisation puis `w.onResized(...)` (déclenché aussi par un double-clic
sur la barre native de la fenêtre, un raccourci OS, ou un drag sur les bords
d'écran — pas seulement par notre propre bouton) pour re-checker l'état et
mettre à jour l'icône à chaque resize.

## Composants

- `src-tauri/Cargo.toml` : ajout dépendance `tauri-plugin-os`.
- `src-tauri/src/lib.rs` : `.plugin(tauri_plugin_os::init())` dans le builder.
- `package.json` : ajout `@tauri-apps/plugin-os`.
- `frontend/chrome.ts` :
  - `injectTitlebar()` devient `async fn`, appelle `platform()` une fois.
  - Nouvelle fonction pure `controlsMarkup(isMac: boolean): string` (rend l'un
    ou l'autre layout) — testable/lisible séparément du DOM.
  - `title="Sift"` posé sur `#sift-tb-title` à la création (miroir du
    `textContent`) + CSS de troncature ajouté au bloc de style existant.
  - Nouvelle fonction `syncMaxButton(btn: HTMLElement, maximized: boolean): void`
    (bascule icône + title/aria-label) appelée à l'init (après
    `w.isMaximized()`) et dans le handler `w.onResized`.
  - CSS ajouté dans le bloc de style injecté existant (mêmes tokens
    `--color-*`, pas de littéral).

## Données

Aucune persistance. Détection OS une fois par session au montage — l'OS ne
change pas en cours d'exécution. L'état maximisé, lui, est ré-évalué à chaque
`onResized` (peut changer plusieurs fois par session).

## Gestion d'erreurs

`platform()` qui rejette (cas limite, plugin mal initialisé) → fallback sur
le layout Windows actuel (comportement 100% existant), jamais un écran
cassé. C'est le seul fallback silencieux acceptable ici : c'est littéralement
le comportement déjà en place aujourd'hui pour 100% des utilisateurs.
`w.isMaximized()`/`w.onResized` qui rejette → l'icône reste sur "Agrandir"
(état par défaut actuel), pas de crash, dégradation gracieuse identique à
l'existant.

## Tests

Pas de test Rust utile (le plugin est juste enregistré, zéro logique métier
ajoutée côté backend — pas de fonction à unit-tester). Côté front, TS vanilla
sans harness (comme le reste de `chrome.ts`) : `controlsMarkup(isMac)` et
`syncMaxButton(btn, maximized)` restent des fonctions pures facilement
relisables en revue, mais pas testées automatiquement.

**Vérifiable maintenant (Windows, cette machine)** : troncature/tooltip du
nom de fenêtre, bascule icône maximize↔restore par clic sur le bouton ET par
double-clic sur la barre/drag sur les bords d'écran, non-régression du
layout Windows existant — via `npm run tauri dev`.

**Non vérifiable avant qu'un Mac soit disponible** : le rendu du layout
macOS (feux tricolores à gauche) reste non confirmé visuellement.
