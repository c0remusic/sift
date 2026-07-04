# Design — Token-sync tool v2 : DTCG, consolidation, navigation, preview live (2026-07-04)

> Suite de la construction du token-sync tool (design_handoff_sift_refonte/token-sync/,
> voir docs/ressources-externes.md Évaluation 8). Motivé par la découverte de 4 outils
> externes (engramma, Tokens Studio, Style Dictionary, Magic Patterns) et 2 sources
> DTCG faisant autorité (designtokens.org/tr/drafts/resolver/, alwaystwisted.com —
> design tokens workflow part 7) : aucun ne remplace notre outil (voir conversation),
> mais plusieurs idées valent d'être incorporées. Magic Patterns n'apporte rien
> (génération de code UI par prompt, hors sujet sync de tokens) — pas de section pour lui.

## Décisions actées (résumé)

- **Format DTCG réel** pour `design-tokens.json` (valeurs structurées, pas juste
  renommage) — remplace la forme maison actuelle.
- **Pas de module Resolver formel, pas de Terrazzo.** Cascade à 2 fichiers (light
  complet + dark en overrides), fusionnée par une fonction maison de ~10 lignes.
  Le module Resolver DTCG officiel (resolver.json, sets, modifiers, contexts,
  resolutionOrder) est conçu pour plusieurs axes (thème + plateforme + densité...) —
  on n'a que 2 modes fixes, cette généralité serait de la machinerie inutile.
  Terrazzo écarté pour la même raison : ses plugins ne couvrent aucune de nos 2
  cibles propriétaires (Sift.dc.html, DESIGN.md), donc on écrirait quand même ces
  2 générateurs à la main — le seul gain réel (CSS custom-properties standard +
  validation) ne justifie pas la dépendance + le config file.
- **Consolidation partielle** du chargement canonique + de la mécanique finale
  lire/écrire, dupliquée 3 fois dans `generate-*.cjs` — **pas** un registre de
  formats façon Style Dictionary (voir Section B : vérifié contre le code réel,
  ce modèle ne colle pas à nos 3 générateurs).
- **Aperçu auto-rafraîchi** (façon engramma) dans l'onglet "Maquette complète" de
  `editor.html`.
- **Navigation par barre latérale + recherche** (façon panneau Variables de Figma,
  vu via le plugin DTCG Design Token Manager) pour remplacer les accordéons empilés.

## Section A — Architecture des tokens (format DTCG réel)

### Forme actuelle (à remplacer)

```json
{
  "colors": { "--color-background-primary": { "light": "#E7E2DB", "dark": "#282825" } },
  "static": { "--border-radius-md": "6px" }
}
```

### Nouvelle forme : 2 fichiers, tokens DTCG structurés

**`design-tokens.light.json`** — ensemble complet (tous les tokens statiques +
toutes les couleurs en valeur claire) :

```json
{
  "color": {
    "background-primary": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.906, 0.886, 0.863], "hex": "#E7E2DB" }
    }
  },
  "radius": {
    "md": { "$type": "dimension", "$value": { "value": 6, "unit": "px" } }
  },
  "text": {
    "md": { "$type": "dimension", "$value": { "value": 12, "unit": "px" } }
  },
  "space": {
    "16": { "$type": "dimension", "$value": { "value": 16, "unit": "px" } }
  },
  "height": {
    "36": { "$type": "dimension", "$value": { "value": 36, "unit": "px" } }
  },
  "shadow": {
    "toast": { "$type": "shadow", "$value": "0 8px 28px rgba(0,0,0,.4)" }
  },
  "font": {
    "ui": { "$type": "fontFamily", "$value": "\"Outfit\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif" }
  }
}
```

**`design-tokens.dark.json`** — overrides uniquement, seulement les `color.*` qui
diffèrent réellement en sombre (les tokens `radius`/`text`/`space`/`height` ne
varient jamais par thème, jamais dupliqués ici) :

```json
{
  "color": {
    "background-primary": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.157, 0.157, 0.145], "hex": "#282825" }
    }
  }
}
```

### Portée de la conformité DTCG (décision de scope explicite)

- **`color`** : forme structurée complète (`colorSpace`/`components`/`hex`) —
  conforme.
- **`dimension`** (radius/text/space/height) : forme structurée `{value, unit}` —
  conforme.
- **`shadow`** et **`fontFamily`** : `$type` correct, mais `$value` reste une
  chaîne brute (pas la forme composite complète du spec DTCG — `shadow` en toute
  rigueur est `{color, offsetX, offsetY, blur, spread}`, `fontFamily` est un
  tableau de chaînes). Décision : pas assez de valeur réelle pour la complexité —
  2 catégories, jamais consommées par un outil DTCG tiers dans ce projet. Documenté
  ici plutôt que laissé comme un oubli silencieux.

### Fusion (remplace le besoin de Resolver/Terrazzo)

Nouvelle fonction partagée (dans `sync-core.cjs`, voir Section B) :

```js
function resolveTheme(light, dark, mode) {
  if (mode === "light") return light;
  return {
    ...light,
    color: { ...light.color, ...dark.color },
  };
}
```

Appelée par tout script qui a besoin de la valeur effective d'un mode donné
(remplace les accès directs `tokens.colors[key].light/.dark` partout).

### Mapping des noms

- `--color-background-primary` → chemin DTCG `color.background-primary` (préfixe
  `--color-` retiré, reste kebab-case).
- `--border-radius-md` → `radius.md`. `--shadow-toast` → `shadow.toast`.
  `--font-ui` → `font.ui`. `--text-md` → `text.md`. `--space-16` → `space.16`.
  `--h-36` → `height.36`.
- `alias-map.json` (mapping des clés legacy `theme()` → noms `--color-*`) reste
  **inchangé** — indépendant de la forme interne des fichiers de tokens.

### Source de vérité hex vs. components (ambiguïté résolue)

`hex` est la seule valeur qu'un humain ou `editor.html` édite jamais (color
picker natif, champ texte) — `components` n'est **jamais lu-modifié-écrit**,
il est **recalculé à neuf depuis `hex`** à chaque écriture (`sync-core.cjs`,
au moment de `finalizeRun`/`/validate`), jamais accumulé d'une édition à
l'autre. Ça élimine structurellement tout risque de dérive d'arrondi entre
`hex` et `components` au fil des cycles d'édition (pas besoin de prouver
qu'une précision décimale donnée round-trip parfaitement les 256 valeurs
d'un octet — la question ne se pose plus, `components` est toujours dérivé,
jamais source). Formule : `components[i] = round(byte[i] / 255, 4)`
(4 décimales, uniquement pour l'affichage/interop DTCG — sans conséquence
sur la fidélité puisque `hex` reste la valeur qui fait autorité).

### Pruning des overrides `dark.json` convergents

Si une valeur pulée (`pull-styles-css.cjs`/`pull-theme-html.cjs`) ou éditée
dans `design-tokens.dark.json` redevient **identique** à sa valeur `light`
correspondante (ex. après un revert), le token doit être **retiré** de
`design-tokens.dark.json` plutôt que d'y rester en doublon inutile — sinon
`dark.json` accumule des overrides qui ne servent plus à rien et deviennent
trompeurs (« pourquoi ce token est dans dark.json s'il ne diffère pas ? »).
Cette règle de pruning s'applique dans les 3 points d'écriture de
`design-tokens.dark.json` : `/validate`, `pull-styles-css.cjs --write`,
`pull-theme-html.cjs --write`.

### Forme de `last-sync.json` (précisée)

Devient `{ "light": { ...snapshot complet de design-tokens.light.json... },
"dark": { ...snapshot complet de design-tokens.dark.json... } }` — un seul
fichier de baseline, toujours partagé entre `pull-styles-css.cjs` et
`pull-theme-html.cjs` (même raisonnement que l'architecture actuelle : la
baseline représente l'état canonique au dernier sync, pas une propriété
d'un seul fichier source).

### Frontière client/serveur (précisée après lecture de editor-server.cjs)

Le DTCG reste une préoccupation **stockage + générateurs uniquement**. Le
contrat de données navigateur↔serveur (`{colors: {clé: {light, dark: hex}},
static: {clé: valeur}}`, exactement la forme actuelle) **ne change pas** :
`editor-server.cjs` fait toute la conversion aux 3 points frontière :
- `GET /tokens.json` : lit les 2 fichiers DTCG, résout, convertit vers la forme
  simple pour le navigateur.
- `POST /preview-tokens` / `POST /validate` : reçoit la forme simple (inchangée),
  la convertit vers la forme DTCG (recalcule `components` depuis `hex`, applique
  le pruning de `dark.json`) avant d'écrire/consommer.

Conséquence : `editor.html` et `validateTokensShape()` **ne changent pas du
tout** pour la Section A — seule la Section D (navigation) touche `editor.html`.
Ça réduit le nombre de fichiers réellement impactés par la migration DTCG.

### Fichiers touchés

Les 6 scripts (`generate-styles-css.cjs`, `generate-theme-html.cjs`,
`generate-design-md.cjs`, `pull-styles-css.cjs`, `pull-theme-html.cjs`,
`apply-tokens.cjs` — ce dernier sans changement de code, juste par dépendance
transitive aux générateurs), la couche de conversion dans `editor-server.cjs`
(nouvelles fonctions internes, PAS `validateTokensShape()` ni le contrat des
routes), et la forme de `last-sync.json`. `locate.cjs`, `editor.html` (hors
Section D) et `apply-tokens.cjs` (code) ne sont pas touchés.

## Section B — Consolidation partielle (pas un registre de formats)

**Correction faite en relisant le code réel** (les 3 `generate-*.cjs`) avant
d'écrire le plan : le modèle Style Dictionary (`format() => contenu de fichier
complet`, diffé tel quel) ne colle pas. Les 3 générateurs actuels font tous du
**patch chirurgical par regex** sur des fichiers rédigés à la main — chacun ne
touche qu'un bloc précis (les 3 blocs CSS de `styles.css`, les 2 littéraux objet
de `theme()` dans `Sift.dc.html`, les bullets de `DESIGN.md` + une vérification
de dérive de comptage) et laisse tout le reste du fichier intact. Faire produire
à un `format()` le contenu entier du fichier forcerait chaque générateur à
reconstruire fidèlement tout ce qu'il ne touche pas aujourd'hui — pas de vraie
simplification, et un risque réel de corruption si la reconstruction dérive
(viole le principe « changements chirurgicaux » du projet). Ce modèle est
abandonné.

**Ce qui est réellement dupliqué et vaut la peine d'être extrait** dans un
nouveau `sync-core.cjs` :
- Charger les 2 fichiers canoniques (`design-tokens.light.json`/`.dark.json`)
  et exposer `resolveTheme()`.
- Charger `alias-map.json`.
- La mécanique finale commune : comparer `original` vs `updated` (déjà calculé
  par la logique propre à chaque générateur), logger le message standard,
  écrire si `--write` et qu'il y a un changement, retourner `{noOp, changedKeys}`.

```js
// sync-core.cjs
function loadCanonical() {
  const light = loadJSON("design-tokens.light.json");
  const dark = loadJSON("design-tokens.dark.json");
  return { light, dark, resolveTheme: (mode) => resolveTheme(light, dark, mode) };
}
function loadAliasMap() { return loadJSON("alias-map.json"); }
function finalizeRun({ targetPath, original, updated, changedKeys, write, label }) {
  if (updated === original) { console.log(`No-op: ${label}.`); return { noOp: true, changedKeys: [] }; }
  console.log(`Changed: ${changedKeys.join(", ")}`);
  if (write) fs.writeFileSync(targetPath, updated, "utf8");
  console.log(write ? `Written to ${targetPath}.` : "Dry run only — pass --write to persist.");
  return { noOp: false, changedKeys };
}
module.exports = { loadCanonical, loadAliasMap, finalizeRun, resolveTheme };
```

Chaque `generate-*.cjs` garde **sa logique de repérage/remplacement de bloc
propre** (regex CSS, littéraux `theme()`, bullets + drift-check DESIGN.md) —
seuls le chargement canonique et la mécanique finale sont mutualisés. Nom de
fichier et usage CLI inchangés pour `apply-tokens.cjs` et les autres scripts.

## Section C — Aperçu auto-rafraîchi (façon engramma)

Dans `editor.html`, l'onglet "Maquette complète" (iframe `#mockup-frame` chargeant
`/preview.html`) exige aujourd'hui un clic sur "↻ Rafraîchir la maquette". Nouveau
comportement :

- Sur tout changement de valeur (color picker ou champ texte), démarrer/relancer
  un debounce de 500 ms.
- À l'expiration, si l'onglet "Maquette complète" est actuellement visible
  (`tab.dataset.active === "mockup"` ou équivalent), POST `/preview-tokens` puis
  recharger l'iframe (cache-bust identique à l'actuel).
- Si l'onglet n'est pas visible, ne rien faire (pas de coût réseau/rendu pour un
  iframe invisible) — au moment où l'utilisateur bascule sur cet onglet, forcer un
  rafraîchissement immédiat (pas d'attente du prochain changement).
- Le bouton "↻ Rafraîchir la maquette" reste, en filet de secours manuel.

## Section D — Navigation barre latérale + recherche (façon panneau Variables Figma)

Remplace les accordéons `<details>` empilés de `editor.html` par :

- **Barre latérale gauche** : liste des groupes existants (mêmes noms français —
  Fonds, Textes, États (vert/ambre), Bordures, Survol/sélection, Bouton
  Identifier, Coins arrondis, Ombres, Police, Tailles de texte, Espacements,
  Hauteur des boutons), chacun avec un **compteur** (nombre de tokens). Clic sur
  un groupe → affiche uniquement ses tokens dans le panneau principal.
- **Champ de recherche** en haut de la barre latérale : filtre les tokens par nom
  ou libellé français au fur et à mesure de la saisie, tous groupes confondus
  (bascule vers une vue "résultats" quand la recherche est non vide).
- Le panneau principal garde les mêmes widgets d'édition qu'aujourd'hui (pastille
  color picker native + champ texte par mode) — seule la navigation change, pas
  la mécanique d'édition ni le flux `/validate`.

## Hors scope (explicitement)

- **Module Resolver DTCG formel** (resolver.json, sets/modifiers/contexts) et
  **Terrazzo** comme dépendance — voir décision actée ci-dessus.
- **Migration vers Figma** — écartée séparément (Variables REST API réservée aux
  comptes Enterprise ; voir conversation, pas de doc dédiée pour l'instant).
- **Conformité composite complète pour `shadow`/`fontFamily`** — voir Section A,
  décision de scope.
- **Features de Magic Patterns** — aucune applicable à un outil de sync de tokens.
- **Historique multi-niveaux de l'éditeur, confirmation avant écriture** — déjà
  hors scope du spec précédent (undo), non concerné par celui-ci.

## Ordre de construction suggéré (pour le plan)

1. **Section A** (fondation — tout le reste en dépend).
2. **Section B** (consolidation, s'appuie sur la nouvelle forme de A).
3. **Section D** (restructuration de navigation dans `editor.html`).
4. **Section C** (aperçu auto-rafraîchi, indépendant, risque le plus faible — bien
   pour finir).
