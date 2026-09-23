// i18n-coverage.mjs — les littéraux de chaîne qui portent du FRANÇAIS VISIBLE hors des
// dictionnaires (`frontend/i18n/`). Chacun est un texte que l'interface anglaise affichera en
// français. Consommé par `test/i18n-coverage.test.ts`, qui en fait un cliquet.
//
// Pas de shebang : Vitest l'importe (un `.mjs` à shebang casse la collecte en SyntaxError muet).
//
// Heuristique assumée, pas un analyseur : une chaîne compte si, une fois retirés ses balises et ses
// `${…}`, son texte ou ses attributs `title`/`aria-label`/`placeholder`/`alt` portent une lettre
// accentuée française ou un mot-outil français. Faux négatif connu : un libellé d'un seul mot sans
// accent (« Annuler », « Convertir ») n'est vu que s'il figure dans MOTS. Faux positif connu : un
// nom propre accentué. Le cliquet absorbe les deux ; il ne tolère qu'une chose, la hausse.

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ACCENTS = /[àâäéèêëîïôöùûüçœÀÂÉÈÊËÎÏÔÙÛÇŒ]/;
const MOTS = /\b(le|la|les|un|une|des|du|et|ou|pas|pour|sur|dans|avec|sans|aucun|aucune|piste|pistes|fichier|fichiers|dossier|dossiers|annuler|fermer|ouvrir|choisir|choisis|supprimer|convertir|écarter|ranger|réessaie|chargement|vider|restaurer|envoyer|doublon|doublons|corbeille)\b/i;

// Hors périmètre, et pourquoi :
// - `i18n/`, `i18n.ts` : les dictionnaires et leur mécanisme, le français y est chez lui ;
// - `app.js` : pas scanné (.js), c'est la démo navigateur, jamais chargée sous Tauri ;
// - outils de développement, éliminés du build de production ;
// - stories : documentation Storybook, leurs données d'exemple sont du contenu, pas de l'interface.
const EXCLUS = new Set(['i18n.ts', 'dev-inspector.ts', 'dev-annotate.ts', 'selftest.ts']);

/** Les littéraux français d'un source TypeScript. Commentaires et lignes `console.*` ignorés : les
 *  premiers ne s'affichent pas, les secondes s'adressent au développeur. */
export function frenchLiterals(src) {
  const sansCommentaires = src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (s, p) => p + ' '.repeat(s.length - p.length));
  const lignes = sansCommentaires.split('\n');
  const out = [];
  for (const m of sansCommentaires.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs)) {
    const s = m[2];
    if (s.length < 2) continue;
    const ligne = sansCommentaires.slice(0, m.index).split('\n').length;
    if (/\bconsole\.\w+\(/.test(lignes[ligne - 1] ?? '')) continue;
    const texte = s.replace(/<[^>]*>/g, ' ').replace(/\$\{[^}]*\}/g, ' ');
    const attrs = [...s.matchAll(/(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map((x) => x[1]).join(' ');
    const visible = `${texte} ${attrs}`;
    if (ACCENTS.test(visible) || MOTS.test(visible)) out.push({ line: ligne, text: s.slice(0, 80) });
  }
  return out;
}

/** Tous les littéraux français de `frontend/` hors périmètre exclu, triés par fichier. */
export function scanFrontend(root) {
  const base = join(root, 'frontend');
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const a = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'i18n') walk(a);
      } else if (extname(e.name) === '.ts' && !e.name.endsWith('.stories.ts') && !EXCLUS.has(e.name)) {
        files.push(a);
      }
    }
  })(base);
  const out = [];
  for (const f of files.sort()) {
    const rel = relative(root, f).replace(/\\/g, '/');
    for (const hit of frenchLiterals(readFileSync(f, 'utf8'))) out.push({ file: rel, ...hit });
  }
  return { files: files.length, hits: out };
}
