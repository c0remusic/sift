# Design — Rewire verdict text colors (`semGreen`/`semAmber`) to real tokens (2026-07-04)

> Suite de l'audit post-plan v2 de l'éditeur de tokens. Contexte complet :
> `docs/superpowers/specs/2026-07-04-token-sync-tool-v2-design.md` (addendum
> rgba/alpha) et `docs/superpowers/specs/2026-07-04-token-editor-darkmode-and-ux-fixes-design.md`.

## Contexte : pourquoi ce suivi existe

En testant l'éditeur de tokens (`design_handoff_sift_refonte/token-sync/editor.html`),
il a été constaté que modifier **« Texte vert — OK »** (`--color-text-success`)
ne montre aucun changement, ni dans « Aperçu rapide », ni dans « Maquette
complète ».

**Root cause confirmée** : `alias-map.json` ne mappe aucune clé legacy vers
`--color-text-success` (ni vers 16 des 33 tokens réels). Sans entrée
alias-map, `generate-theme-html.transform()` — utilisé à la fois par le
chemin d'écriture fichier ET par la route live `/preview.html` d'
`editor-server.cjs` — n'a aucun moyen d'injecter la valeur éditée dans
l'objet `theme()` de `Sift.dc.html`. Ce n'est pas un bug de rafraîchissement,
c'est un vrai trou de couverture.

**Périmètre complet du trou** : 17 des 33 tokens n'ont aucune voie
d'aperçu live nulle part (ni Aperçu rapide, ni Maquette complète) :
tout le groupe « États (vert/ambre) » (7), tout « Survol/sélection » (4),
tout « Bouton Identifier » (4), et 2 des 4 « Bordures »
(`border-info`, `border-danger`).

**Découpage acté avec Antoine** : ce trou se scinde en deux groupes de
risque très différent —
- **Groupe A** (ce document) : les couleurs de **texte** de verdict
  (`text-success`, `text-danger`, `text-warning`) ont déjà un mécanisme
  équivalent dans `Sift.dc.html` (`semGreen()`/`semAmber()`, sensibles au
  mode sombre), juste non branché sur `theme()`/l'alias-map — un pur
  rewiring, bas risque.
- **Groupe B** (hors scope, décision séparée à venir) : les 4 fonds de
  verdict (`background-success/danger/warning/info`), tout
  « Survol/sélection », tout « Bouton Identifier » — aucun équivalent
  existant dans la maquette, nécessiterait de la vraie nouvelle UI (ou,
  pour les fonds, un choix de design vu l'incohérence d'alpha déjà
  présente aujourd'hui — voir section suivante).

## Ce qui existe déjà dans `Sift.dc.html` (vérifié par lecture directe)

Trois mécanismes de couleur de verdict coexistent, incohérents entre eux —
découverts en creusant ce suivi, pas supposés :

1. **`GREENT`/`AMBERT` via `semGreen()`/`semAmber()`** (`Sift.dc.html:732,
   848-849`) — sensibles au mode sombre, mais via leur PROPRE ternaire
   manuel (`isDark()?'#9fe0af':this.GREENT`), pas via `theme()`/`T`. Valeurs
   actuelles : `GREENT='#3f6d4c'` (clair), dark hardcodé `'#9fe0af'` dans
   `semGreen()` ; `AMBERT='#8f6318'` (clair), dark hardcodé `'#f2c274'` dans
   `semAmber()`. Utilisés pour la couleur du **texte** de verdict
   (`verdictColor`, `specColor`, `matchColor`).
2. **`GREEN`/`AMBER` (sans T)** (`Sift.dc.html:732`) — **PAS** sensibles au
   mode sombre, valeurs fixes `'#4C7B57'`/`'#B07A28'`. Utilisés pour les
   **pastilles de statut** (`dotColor` dans plusieurs listes/journaux) — un
   concept décoratif différent, volontairement plat.
3. **`specBadgeBg`/`matchBg`** (`Sift.dc.html:1152,1171,1307`) — chaînes
   rgba **littérales inline**, **incohérentes entre elles** :
   `rgba(76,123,87,0.14)` à un endroit, `0.32` à un autre, `0.34` à un
   troisième — pour ce qui est censé être le même concept de « fond vert
   de succès ». Aucune ne correspond à l'alpha canonique de nos tokens
   (`background-success`/`-danger`/`-warning` sont tous à `.14`).

**Vérifié** : `text-danger` et `text-warning` sont **actuellement des
valeurs strictement identiques** (`#8f6318` clair / `#f2c274` sombre) dans
`design-tokens.{light,dark}.json` — de même pour `background-danger`/
`background-warning` (`rgba(176,122,40,.14)` dans les deux cas). Le concept
« ambre unique » de la maquette correspond donc à la réalité actuelle des
tokens ; danger et warning n'ont pas encore divergé.

## Décision de scope (actée avec Antoine)

**Seuls les 3 tokens texte** (`text-success`, `text-danger`, `text-warning`)
sont dans ce suivi — pas les 4 fonds. Rewiring des fonds écarté pour
l'instant : re-brancher `specBadgeBg`/`matchBg` sur l'alpha canonique `.14`
changerait visiblement l'apparence actuelle des badges (`.32`/`.34` → `.14`,
beaucoup plus discret) — une vraie décision de design, pas un simple
rewiring, à traiter séparément.

`warning` ne reçoit pas sa propre clé alias-map dans ce suivi — il fusionne
avec `danger` (même chemin `AMBERT`/`semAmber()`), cohérent avec le fait que
les deux tokens sont aujourd'hui identiques. Si `text-danger`/`text-warning`
divergent un jour intentionnellement, ce merge devra être défait (`semAmber()`
devra distinguer selon le contexte d'appel — retrouver quels appels sont
vraiment "erreur" vs "attention").

## Changements

### 1. `theme()` (`Sift.dc.html`)

Ajouter 2 nouvelles clés aux deux branches (claire/sombre) de l'objet
retourné par `theme()` : `successText`, `dangerText` — valeurs prises dans
`design-tokens.{light,dark}.json` via le mécanisme de génération existant
(`generate-theme-html.cjs` régénère cet objet depuis le canonique + l'alias-map,
donc une fois l'alias-map étendu, ces clés se peuplent automatiquement au
prochain `--write`).

### 2. `alias-map.json`

Ajouter :
```json
"successText": "--color-text-success",
"dangerText": "--color-text-danger"
```
(`warning` non mappé séparément, voir décision de scope ci-dessus.)

### 3. `semGreen()`/`semAmber()` (`Sift.dc.html`)

Remplacer le ternaire manuel `isDark()`-aware par une lecture de `theme()` :
```js
semGreen(){ return this.theme().successText; }
semAmber(){ return this.theme().dangerText; }
```
(`this.theme()` retourne déjà l'objet correct clair/sombre selon
`isDark()` — pas besoin de dupliquer la logique de branchement ici.)

**Non touché** : `GREEN`/`AMBER` (pastilles, concept plat différent),
`specBadgeBg`/`matchBg` (fonds, décision de scope séparée), tout le reste
de `Sift.dc.html`.

## Vérification attendue

- `node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs`
  après l'ajout des clés alias-map doit détecter un changement (`Changed:
  successText, dangerText`) au premier `--write`, puis no-op ensuite.
- Dans l'éditeur, éditer « Texte vert — OK » ou « Texte ambre » doit
  maintenant se refléter dans « Maquette complète » (verdict badges,
  labels de correspondance) après le délai de debounce habituel (~0,5s).
- Confirmer que les pastilles de statut (`dotColor`, non touchées) gardent
  leur couleur actuelle, non affectées par ce changement.

## Non-goals

- Pas de câblage des 4 tokens fond (`background-success/danger/warning/info`)
  — Groupe B, décision séparée.
- Pas de câblage de « Survol/sélection » ni « Bouton Identifier » — Groupe B.
- Pas de refonte de `GREEN`/`AMBER` (pastilles) ni de `specBadgeBg`/`matchBg`
  (fonds de badge) — laissés tels quels, incohérences existantes non
  résolues par ce suivi.
- Pas de séparation `danger`/`warning` en deux chemins distincts — restent
  fusionnés tant qu'ils sont identiques en valeur.
