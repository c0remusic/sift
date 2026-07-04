# Design — Fixes issus de l'audit du token-sync tool (2026-07-04)

> Source : audit code (2 agents parallèles, correction + nettoyage/conventions, 4 findings
> vérifiés sur le code réel) et audit UI (`/impeccable audit`, 4 findings vérifiés en direct
> via preview_inspect/preview_eval) menés sur `design_handoff_sift_refonte/token-sync/` dans
> cette session. Ce spec couvre les 8 correctifs retenus. Hors scope, explicitement : les
> dimensions Responsive/Theming de l'audit UI sur `editor.html` (outil desktop-only local,
> jamais utilisé sur mobile — pas d'action recommandée).

## Contexte

Huit défauts distincts, indépendants sauf pour un partage d'infrastructure (baseline de sync
partagée entre `pull-styles-css.cjs` et le nouveau `pull-theme-html.cjs`) :

**Audit code :**
1. `generate-theme-html.cjs:31` — la clé legacy est interpolée dans `new RegExp()` sans
   échappement, contrairement à son générateur jumeau (`generate-styles-css.cjs` échappe via
   `escapeRegex()`). Dormant aujourd'hui (aucune clé d'`alias-map.json` n'a de métacaractère
   regex), latent si une future clé en a un.
2. `editor-server.cjs:96` — `POST /validate` ne vérifie que la présence (truthy) de
   `colors`/`static`, jamais leur forme. Un objet malformé s'écrit tel quel dans
   `design-tokens.json`, puis les générateurs lisant `v.light`/`v.dark` sur une valeur qui
   n'est pas un objet obtiennent `undefined`, écrit littéralement dans `styles.css` sans
   aucune erreur.
3. `generate-design-md.cjs:41` — les listes `lightBullets`/`darkBullets` sont des sous-listes
   codées à la main (`darkBullets` omet volontairement `"track"`, DESIGN.md n'a pas cette
   bullet en sombre). Chaque bullet *connue* est vérifiée individuellement, mais rien ne
   détecte qu'une bullet *nouvelle* soit apparue dans le fichier réel sans que la liste le
   sache — dérive silencieuse possible, contraire au principe fail-fast du projet.
4. Fonction d'échappement regex dupliquée 3 fois (`generate-styles-css.cjs`,
   `generate-design-md.cjs`, inlinée dans `pull-styles-css.cjs`).

**Audit UI (`editor.html`) :**
5. Aucun `<input>` n'a de label associé (ni `<label>`, ni `aria-label`) — vérifié via
   `input.labels.length === 0` en direct dans le navigateur.
6. Texte secondaire/tertiaire (`#918a7d`, `#a39c8f`) sous le seuil de contraste AA (~2.8-3.4:1
   contre blanc, vérifié via `getComputedStyle`) — requis 4.5:1 pour du texte normal.
7. `<html>` sans `lang="fr"`, `<iframe id="mockup-frame">` sans `title` — vérifiés
   (`document.documentElement.lang === ""`, `iframe.title === ""`).

**Gap architectural (pas un bug, une pièce manquante) :**
8. Pas de chemin de remontée pour `Sift.dc.html` — si une couleur change côté Claude Design
   (projet cloud "Refonte UI Sift"), on peut rapatrier le fichier, mais rien ne fait remonter
   ce changement dans `design-tokens.json`. Seul `pull-styles-css.cjs` existe (sens
   `styles.css` → canonique).

## Section A — Fixes mécaniques (points 1, 2, 4, 5, 6, 7)

**Approche retenue** : chaque fix touche un seul fichier existant, pas de nouvelle
architecture.

- **Point 1 + 4 (regroupés)** : nouveau fichier
  `design_handoff_sift_refonte/token-sync/regex-utils.cjs`, exportant `escapeRegex(s)` (la
  même implémentation déjà présente 3 fois). `generate-styles-css.cjs`,
  `generate-design-md.cjs`, `generate-theme-html.cjs` et `pull-styles-css.cjs` l'importent via
  `require("./regex-utils.cjs")` au lieu de définir/dupliquer leur propre copie.
  `generate-theme-html.cjs`'s `replaceKeysInObjectLiteral()` échappe désormais `key` avant de
  construire son `RegExp` (comme le fait déjà `generate-styles-css.cjs`).
- **Point 2** : nouvelle fonction `validateTokensShape(tokens)` dans `editor-server.cjs` (pas
  besoin d'un fichier séparé, utilisée uniquement là) : vérifie que `tokens.colors` est un
  objet non-null où chaque valeur est `{light: string, dark: string}`, et que `tokens.static`
  est un objet non-null où chaque valeur est une string. Lève une erreur descriptive sinon.
  Appelée en tête de `POST /validate` et `POST /preview-tokens`, avant tout usage de
  `edited`/`pendingTokens` — remplace le check `!edited.colors || !edited.static` actuel.
- **Point 5** : dans `makeModeSlot()` (le picker couleur ET le champ texte) et dans le
  constructeur de ligne statique d'`editor.html`, ajoute
  `input.setAttribute("aria-label", `${label} (${mode === "light" ? "Clair" : "Sombre"})`)`
  (ou juste `label` pour les lignes statiques, qui n'ont pas de mode).
- **Point 6** : remplace `#918a7d` et `#a39c8f` par `#6b6459` (déjà utilisé ailleurs dans le
  fichier pour `header p`, contraste ~5.85:1 déjà validé) dans les règles CSS `.group-hint`,
  `.token-name`, `.consumer`, `.preview-tab` (état par défaut).
- **Point 7** : `<html lang="fr">` (ligne 2) ; `<iframe id="mockup-frame" title="Maquette interactive Sift">` (ligne 140, ajout de l'attribut à la liste existante).

**Test/vérification** : `node generate-*.cjs` (no-op check habituel) après le point 1 ;
`tsc`/lint n'applique pas ici (JS/HTML pur) ; pour les points 5-7, vérification directe via
`preview_eval`/`preview_inspect` (mêmes outils déjà utilisés pour les trouver) — confirmer
`labels.length > 0`, contraste recalculé, `lang`/`title` non vides.

## Section B — `generate-design-md.cjs` : détection de dérive de structure (point 3)

**Approche retenue** : validation par comptage, pas par contenu (reste simple, pas de
parseur Markdown).

Avant d'appliquer les remplacements sur chaque section (claire/sombre), compter les vraies
lignes bullet du fichier réel via une regex générique (`/^- .+ : `[^`]+`$/gm` appliquée à
chaque section) et comparer ce compte au nombre de bullets que la liste codée en dur
(`lightBullets`/`darkBullets` + la ligne CTA à part) s'attend à traiter pour cette section. Si
les comptes ne correspondent pas → `throw` explicite nommant la section et les deux comptes
("DESIGN.md section claire a N bullets, le générateur en attend M — la liste
lightBullets/darkBullets doit être mise à jour"), avant toute écriture.

**Limite assumée** : ça détecte un changement de *nombre* de bullets, pas un changement de
*libellé* à effectif constant (ex. renommer "Bordure fine" sans ajouter/retirer de ligne) —
ce dernier cas est déjà couvert par le `throw` existant par bullet individuelle (le label ne
serait plus trouvé). Combiné, les deux couvrent tous les cas de dérive silencieuse identifiés.

**Test/vérification** : dry-run sur l'état actuel (doit passer, 0 dérive) ; test de régression
volontaire (ajouter une bullet factice dans une copie de `DESIGN.md`, confirmer que le
générateur lève l'erreur au lieu de continuer silencieusement) — même méthode "mutation
temporaire + restauration" déjà utilisée pour valider les 3 générateurs existants.

## Section C — `pull-theme-html.cjs` (point 8, la vraie nouveauté)

**Approche retenue** : miroir exact de `pull-styles-css.cjs`, baseline `last-sync.json`
**partagée** entre les deux (validé avec l'utilisateur) — la baseline représente l'état du
canonique au dernier sync, pas d'un fichier source en particulier, donc un seul fichier de
suivi couvre les deux directions sans ambiguïté.

1. Extrait les valeurs actuelles de `theme()` dans `Sift.dc.html` (réutilise la regex
   d'extraction déjà écrite dans `verify-roundtrip.cjs`/`generate-theme-html.cjs`, capture des
   deux branches `isDark() ? {...} : {...}`).
2. Pour chaque entrée non-null d'`alias-map.json` : compare la valeur Sift.dc.html (par mode)
   à la valeur canonique actuelle et à la valeur dans `last-sync.json`.
   - Canonique == baseline → **pull sûr**, adopte la valeur Sift.dc.html dans le canonique.
   - Canonique != baseline (le canonique a aussi changé depuis, ex. via l'éditeur UI ou
     `pull-styles-css.cjs`) → **conflit**, affiché avec baseline/canonique/Sift.dc.html côte à
     côte, rien n'est écrit, exit non-zéro.
3. Dry-run par défaut (affiche ce qui serait tiré) ; `--write` persiste dans
   `design-tokens.json` et met à jour la baseline partagée.
4. Si `last-sync.json` n'existe pas encore (ne devrait pas arriver, déjà bootstrapé par
   `pull-styles-css.cjs` dans cette session) : même comportement bootstrap que
   `pull-styles-css.cjs` — si Sift.dc.html correspond déjà au canonique pour toutes les clés,
   initialise la baseline silencieusement ; sinon, erreur demandant une réconciliation
   manuelle d'abord.

**Usage prévu** (documenté en tête de fichier, comme les autres scripts) : après avoir
rapatrié un `Sift.dc.html` modifié depuis le projet Claude Design "Refonte UI Sift" (fetch
manuel via `mcp__claude_design__read_file`, hors scope de ce script), lancer
`pull-theme-html.cjs` pour remonter les changements dans le canonique, avant d'utiliser
`apply-tokens.cjs --write` pour repropager vers `styles.css`/`DESIGN.md`.

**Test/vérification** : même protocole que pour `pull-styles-css.cjs` dans cette session —
(a) pull sûr : muter une valeur dans une copie de `Sift.dc.html`, confirmer la détection en
dry-run, confirmer l'écriture réelle en `--write`, restaurer ; (b) conflit réel : diverger
`Sift.dc.html` ET `design-tokens.json` sur la même clé depuis la baseline, confirmer le
refus d'écrire et le rapport de conflit ; (c) après chaque test, restaurer tous les fichiers
touchés et reconfirmer l'état no-op via `apply-tokens.cjs` + les deux scripts `pull-*`.

## Ordre d'implémentation

1. Section A (fixes mécaniques) — indépendants, rapides, faible risque.
2. Section B (`generate-design-md.cjs`) — un seul fichier, testable isolément.
3. Section C (`pull-theme-html.cjs`) — dépend de rien de nouveau (réutilise
   `last-sync.json` déjà créé), mais la plus grosse pièce ; à faire en dernier et à tester le
   plus rigoureusement (le protocole "mutation + conflit + restauration" prend le plus de
   temps).
