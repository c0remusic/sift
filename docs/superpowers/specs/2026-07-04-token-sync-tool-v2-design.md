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
- **Registre de formats façon Style Dictionary** pour consolider les 3
  `generate-*.cjs` (DRY sur la mécanique lire/diff/écrire dupliquée 3 fois), sans
  système de plugin générique pour une 4e cible hypothétique.
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

### Fichiers touchés

Les 6 scripts (`generate-styles-css.cjs`, `generate-theme-html.cjs`,
`generate-design-md.cjs`, `pull-styles-css.cjs`, `pull-theme-html.cjs`,
`apply-tokens.cjs`), tout le contrat de données de `editor-server.cjs`
(`/tokens.json`, `/preview-tokens`, `/validate`, `validateTokensShape()`),
la lecture/écriture de `editor.html`, et la forme de `last-sync.json`. `locate.cjs`
n'est pas touché (travaille sur les noms `--color-*` de production, pas la forme
des fichiers de tokens).

## Section B — Registre de formats (façon Style Dictionary)

Nouveau `sync-core.cjs`, qui porte la mécanique aujourd'hui dupliquée 3 fois :
charger les 2 fichiers canoniques + `resolveTheme()`, charger `alias-map.json`,
lire le fichier cible, comparer, écrire si `--write` et qu'il y a un changement,
imprimer le rapport (no-op / valeurs changées).

```js
// sync-core.cjs
function runFormat({ name, targetFile, format }, { write }) {
  const light = loadJSON("design-tokens.light.json");
  const dark = loadJSON("design-tokens.dark.json");
  const aliasMap = loadJSON("alias-map.json");
  const desired = format({ light, dark, resolveTheme }, aliasMap);
  const current = fs.readFileSync(targetFile, "utf8");
  if (desired === current) { console.log(`No-op: ${name} déjà à jour.`); return { noOp: true }; }
  console.log(`${name} : contenu différent.`);
  if (write) fs.writeFileSync(targetFile, desired, "utf8");
  return { noOp: false };
}
module.exports = { runFormat, resolveTheme };
```

Chaque `generate-*.cjs` garde son nom de fichier (aucun changement pour
`apply-tokens.cjs` ni pour l'usage CLI existant) mais se réduit à sa fonction
`format()` propre, enregistrée via `runFormat()`. Pas de découverte de plugins,
pas de config déclarative — juste la mécanique lire/diff/écrire mutualisée.

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
