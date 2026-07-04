# Design — Bouton Annuler pour l'éditeur de tokens (2026-07-04)

> Déclenché par un incident réel de la session : le bouton "Valider" de
> `editor.html` écrit `design-tokens.json` et le propage vers `styles.css`/
> `Sift.dc.html`/`DESIGN.md` immédiatement, sans confirmation ni moyen
> d'annuler depuis l'outil. Un clic accidentel a dû être diagnostiqué et
> corrigé à la main via le CLI. Ce spec ajoute un filet de sécurité après
> coup, pas une confirmation avant (décision explicite : cohérent avec la
> règle du projet contre `window.confirm()`/`alert()` comme garde-fou avant
> une action, et garde le clic normal aussi direct qu'aujourd'hui).

## Décisions actées

- **1 seul niveau d'annulation** (le dernier "Valider" seulement), pas un
  historique multi-niveaux. Un 2e clic sur "Annuler" après en avoir déjà
  consommé un n'a aucun effet tant qu'un nouveau "Valider" n'a pas eu lieu.
- **Pas de confirmation avant écriture** — "Valider" reste un clic direct.
  Le filet de sécurité est uniquement après coup.
- **Snapshot dédié**, séparé de `last-sync.json` — celui-ci sert exclusivement
  de baseline de conflit pour `pull-styles-css.cjs`/`pull-theme-html.cjs`.
  Réutiliser le même fichier pour l'undo mélangerait deux responsabilités
  (baseline de conflit vs. snapshot d'annulation) dans un seul état partagé,
  avec un risque réel : annuler un "Valider" pourrait fausser la détection de
  conflit d'un `pull` lancé juste après, ou l'inverse. Un concept séparé, une
  seule responsabilité chacun.
- **En mémoire seulement**, pas sur disque — même modèle que `pendingTokens`
  (déjà dans `editor-server.cjs`) : le besoin est d'annuler un clic qui vient
  de se produire dans la même session du serveur, pas de survivre à un
  redémarrage. Perdu si le serveur redémarre, ce qui est acceptable (le
  problème que ça résout — un clic accidentel qu'on remarque tout de suite
  — se produit dans la même session, pas après un restart).

## Serveur (`editor-server.cjs`)

- Nouvelle variable module-level `lastValidateSnapshot` (initialisée à
  `null`), à côté de `pendingTokens` existant.
- Dans le handler `POST /validate` : juste avant `fs.writeFileSync(tokensPath,
  ...)`, lire l'état *actuel* de `design-tokens.json` (celui qui va être
  remplacé) et le stocker dans `lastValidateSnapshot`, avant d'écrire le
  nouveau contenu.
- Nouvel endpoint `POST /undo-validate` :
  - Si `lastValidateSnapshot === null` → réponse `400 { error: "rien à annuler" }`.
  - Sinon : écrit `lastValidateSnapshot` comme nouveau contenu de
    `design-tokens.json`, relance les 3 générateurs (`generate-styles-css`,
    `generate-theme-html`, `generate-design-md`) avec `{ write: true }` —
    exactement la même logique que `/validate`, réutilisée telle quelle, pas
    dupliquée — remet `lastValidateSnapshot` à `null` (usage unique), et
    retourne la même forme `{ results, consumers }` que `/validate` pour que
    le client puisse réutiliser son code de rendu de rapport existant.

## Client (`editor.html`)

- Après un `POST /validate` réussi qui a **réellement changé quelque chose**
  (au moins un générateur avec `noOp: false`) : afficher un bouton "↩ Annuler
  ce Valider" dans la zone `#report`, sous le rapport habituel.
- Si le "Valider" n'a rien changé (tout `noOp: true`) : pas de bouton Annuler
  affiché (rien à annuler).
- Clic sur "Annuler ce Valider" : `POST /undo-validate`, affiche le résultat
  retourné (même rendu que pour `/validate`), puis recharge le formulaire
  (`fetch("/tokens.json")` + `renderColorGroups()` + `refreshPreview()`, comme
  au chargement initial de la page) pour que les pastilles/champs reflètent
  l'état restauré. Le bouton "Annuler" disparaît après usage (le nouveau
  rapport affiché est celui du undo lui-même, qui n'a pas son propre bouton
  Annuler — pas d'annulation en cascade).

## Hors scope (explicitement)

- Historique multi-niveaux — refusé, YAGNI pour le besoin réel.
- Confirmation avant écriture — refusée, cohérent avec la doctrine du projet.
- Persistance du snapshot sur disque / survie à un redémarrage serveur — pas
  nécessaire pour le cas d'usage réel (annuler un clic récent).
- Annulation du "Rafraîchir la maquette" (preview en mémoire, `/preview-tokens`)
  — ce chemin n'écrit jamais sur disque, rien à annuler côté fichiers réels.
