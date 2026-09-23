// lint-tokens-spacing.mjs — le classement d'un littéral px trouvé sur une propriété d'espacement
// ou de taille, séparé de `lint-tokens.mjs` pour être importable par Vitest : un `.mjs` à shebang
// casse la collecte en SyntaxError muet. Vecteurs : `test/lint-tokens-spacing.test.ts`.
//
// DEUX RÈGLES, parce que deux familles de propriétés.
//
// ESPACEMENT (`padding`, `margin`, `gap` et leurs variantes) : la seule source légitime est
// l'échelle `--space-*`. Un littéral SUR l'échelle contourne un token qui existe
// (`space-literal` — il se convertit en `var(--space-N)` sans changer un pixel du rendu). Un
// littéral HORS de l'échelle est une valeur hors grille (`px-spacing`), MÊME quand il coïncide
// avec la valeur d'un autre token.
//
// Cette dernière clause est la raison d'être du module. Jusqu'au 2026-09-23 le lint acceptait,
// pour toute propriété, n'importe quel px apparaissant dans N'IMPORTE QUEL token : `gap:5px`
// passait parce que `--border-radius-sm` vaut 5px, `padding:7px` parce qu'un rayon vaut 7px,
// `margin:2px` parce qu'une ombre contient 2px. Et `gap:8px` passait parce que `--space-8` vaut
// 8px — c'est-à-dire que le littéral qui contourne le token était accepté AU NOM de ce token.
// Mesuré ce jour-là : 62 littéraux sur l'échelle et 35 hors échelle, tous invisibles. L'issue
// #61 les disait « tenus par la baseline » ; aucun n'y avait jamais été compté.
//
// TAILLE (`width`, `height` et leurs variantes, `line-height` compris par le motif) : règle
// inchangée. Une taille n'a pas d'échelle propre — `--h-*`, les tailles de texte, les rayons en
// sont toutes des sources — donc toute valeur de token y reste acceptée.

// La valeur s'arrête au `;` ou au `}` de la règle — en LOOKAHEAD, pour que la déclaration
// DERNIÈRE de son bloc reste visible (issue #29) — et à trois bornes propres aux gabarits
// TypeScript, chacune payée par un faux :
//
// - le GUILLEMET qui ferme un attribut `style="…"`. Sans lui, `gap:2px">` + `<div style="…`
//   capturait le markup jusqu'au prochain `;`, et un px d'une AUTRE propriété s'y trouvait
//   attribué au `gap` ;
// - le `$` d'une interpolation. Sans lui, `padding:4px 0${…}` échouait EN ENTIER — la valeur
//   butait sur le `{` de `${`, que la borne refuse — et ce 4px était le seul littéral d'une ligne
//   que la conversion du 2026-09-23 avait laissé en place ;
// - le guillemet OUVRANT, facultatif, d'une valeur de clé d'objet (`{ padding: '8px' }`). La
//   borne du guillemet fermant l'aurait rendue invisible, alors que l'ancien motif la voyait.
//
// Une valeur CSS ne contient ni `$` ni guillemet sur ces propriétés : aucune borne ne coupe une
// vraie déclaration.
export const SPACING_PROP_RE =
  /\b(padding|margin|width|height|gap)(-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*["'`]?([^;{}"'`$]+)(?=[;}"'`$])/g;

export const PX_VALUE_RE = /(-?\d+(?:\.\d+)?)px/g;

/**
 * Le nom COMPLET de la propriété d'une correspondance de SPACING_PROP_RE. Le motif ne capture que
 * sa base (`width`), ce qui suffit au classement mais affichait `width: 64px` pour un `min-width`.
 */
export function fullProp(text, match) {
  const prefix = /[a-z-]*$/.exec(text.slice(Math.max(0, match.index - 16), match.index))[0];
  return prefix + match[1] + (match[2] ?? '');
}

// ---- Les tokens : les TROIS blocs `:root`, et rien d'autre ----------------------------------
//
// `:root` suivi d'un nombre quelconque de qualificatifs : attribut (`[data-theme="dark"]`) ET
// pseudo-classe fonctionnelle (`:not([data-theme="light"])`). L'ancien motif n'acceptait que
// l'attribut, donc le bloc `@media (prefers-color-scheme:dark) { :root:not(...) }` n'était pas
// reconnu et toutes ses déclarations de tokens étaient comptées comme des couleurs en dur.
const ROOT_SEL = String.raw`:root(?:(?::not\([^)]*\))|(?:\[[^\]]*\]))*`;
export const TOKEN_BLOCK_RE = new RegExp(
  `(@media[^{]*\\{\\s*${ROOT_SEL}\\s*\\{[^{}]*\\}\\s*\\})|(${ROOT_SEL}\\s*\\{[^{}]*\\})`,
  'g',
);
export const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// Neutraliser en gardant longueur ET sauts de ligne : chaque offset et numéro de ligne reste exact.
export const blank = (s) => s.replace(/[^\n]/g, ' ');

const TOKEN_DECL_RE = /--([a-zA-Z0-9-]+)\s*:\s*([^;}]+)(?=[;}])/g;

/**
 * Les valeurs px des tokens, lues dans les seuls blocs `:root`, commentaires neutralisés.
 *
 * Jusqu'au 2026-09-23 elles étaient lues dans la feuille BRUTE, par un motif `--nom: valeur;`
 * appliqué partout. Il ramassait les propriétés LOCALES d'une règle de composant
 * (`--jrnl-col-time:44px` dans `.sift-jrnl…`, `--dropbefore` dans `.sift-lib-colhead…`) et même
 * du texte de commentaire (`--text-xs` suivi d'un 33px de prose). Leurs px devenaient des
 * « tokens », et la règle des tailles acceptait donc `width:44px` et `width:68px` — des valeurs
 * qu'aucun token de `:root` ne porte.
 */
export function parseTokens(css) {
  const blocks = css.replace(CSS_COMMENT_RE, blank).match(TOKEN_BLOCK_RE) || [];
  const spaceScale = new Map(); // px -> `--space-N`
  const tokenPx = new Map(); // px -> premier token qui porte cette valeur
  for (const block of blocks) {
    for (const m of block.matchAll(TOKEN_DECL_RE)) {
      const name = m[1];
      const value = m[2].trim();
      const onScale = /^space-/.test(name) && /^(\d+(?:\.\d+)?)px$/.exec(value);
      if (onScale && !spaceScale.has(parseFloat(onScale[1]))) {
        spaceScale.set(parseFloat(onScale[1]), `--${name}`);
      }
      for (const p of value.matchAll(PX_VALUE_RE)) {
        const px = parseFloat(p[1]);
        if (!tokenPx.has(px)) tokenPx.set(px, `--${name}`);
      }
    }
  }
  return { spaceScale, tokenPx, blocks: blocks.length };
}

const SPACING_PROPS = new Set(['padding', 'margin', 'gap']);

/** Le token le plus proche dans `map` (px -> nom), s'il est à `maxDist` px ou moins. */
export function nearestToken(px, map, maxDist) {
  let best = null;
  let bestDist = Infinity;
  for (const [val, name] of map) {
    const d = Math.abs(val - px);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best !== null && bestDist <= maxDist ? { name: best, dist: bestDist } : null;
}

/**
 * Classe un littéral px. Rend `null` s'il est légitime, sinon `{ category, suggestion }`.
 *
 * @param {string} prop  propriété de base (`padding`, `margin`, `gap`, `width`, `height`)
 * @param {number} px    valeur lue, signe compris
 * @param {Map<number,string>} spaceScale  l'échelle `--space-*` : px -> `--space-N`
 * @param {Map<number,string>} tokenPx     toute valeur px de tout token : px -> `--nom`
 */
export function classifyPx(prop, px, spaceScale, tokenPx) {
  if (SPACING_PROPS.has(prop)) {
    if (px === 0) return null;
    const token = spaceScale.get(Math.abs(px));
    if (token) {
      return {
        category: 'space-literal',
        suggestion: px < 0 ? `calc(-1 * var(${token}))` : `var(${token})`,
      };
    }
    const near = nearestToken(Math.abs(px), spaceScale, 2);
    return {
      category: 'px-spacing',
      suggestion: near
        ? `hors de l'échelle --space-* (la plus proche : ${near.name}, à ${near.dist}px)`
        : "hors de l'échelle --space-*",
    };
  }
  if (tokenPx.has(px)) return null;
  const near = nearestToken(px, tokenPx, 2);
  return {
    category: 'px-spacing',
    suggestion: near ? `${near.name} (off by ${near.dist}px)` : 'no matching token — new value',
  };
}
