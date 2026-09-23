#!/usr/bin/env node
// lint-jargon-allowlist.mjs — la liste de jargon anglais doit décrire le PRODUIT, et les trois
// copies de cette liste doivent dire la même chose.
//
// LE RATÉ QUI A MOTIVÉ CETTE GATE, relevé le 2026-09-23 en préparant la traduction anglaise du
// site. La même liste vit dans TROIS fichiers — `CLAUDE.md`, `docs/design-system/content.md` et
// `docs/manuel.html`, ce dernier publié sur le site — et les trois portaient les deux mêmes
// défauts :
//
//   - `CHECK MATCH` était listé alors qu'il est RETIRÉ du produit (`frontend/filing.ts:627`,
//     ligne 624 à l'époque : « CHECK MATCH removed entirely — annotation confirmed intentional »).
//     Le manuel en ligne promettait donc au lecteur une étiquette que personne ne peut voir.
//   - `XML` manquait alors qu'il est AFFICHÉ (« XML Rekordbox illisible — relie un fichier »,
//     `rekordbox-view.ts:371` à l'époque, `frontend/i18n/rekordbox-view.ts` depuis la migration i18n).
//
// DEUX CONTRÔLES, et il faut les deux — chacun laisse passer ce que l'autre attrape :
//
//   1. TERME MORT. Chaque terme listé doit apparaître dans une chaîne du frontend qui atteint
//      l'écran. Un terme qu'aucune chaîne ne porte ne peut pas être « conservé dans l'UI ».
//      C'est ce contrôle qui aurait attrapé `CHECK MATCH`, et il l'aurait fait alors même que
//      les trois copies étaient d'accord entre elles.
//   2. TROIS COPIES D'ACCORD. Les trois listes doivent être identiques, terme pour terme et
//      dans le même ordre. Ce contrôle-là n'aurait rien vu en 2026-09-23 — les trois étaient
//      fausses ENSEMBLE — mais il attrape la dérive qui suit toute correction partielle, qui
//      est le mode de panne le plus probable maintenant que la liste a été touchée.
//
// ⚠️ CE QU'IL NE VOIT PAS, et c'est assumé : le sens INVERSE du contrôle 1, c'est-à-dire un mot
// anglais affiché par l'app et absent de la liste. Il demanderait de décider quels mots anglais
// d'une interface sont du « jargon conservé » et lesquels sont des noms propres, des unités ou
// des formats — un jugement, pas un motif. `XML` a été trouvé à la main, pas par une machine.
//
// PAS DE BASELINE, comme `lint:claude-md` et pour la même raison : l'état correct est l'égalité
// exacte, et graver une liste fausse dans une baseline bénirait le défaut visé.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');

const SOURCES = [
  {
    fichier: 'CLAUDE.md',
    // « … ne pas « corriger ») : LOSSLESS (…), DUPLICATE, MATCH, XML, kbps, … WAV. »
    re: /Jargon anglais volontairement conservé dans l'UI[^:]*:([\s\S]*?)\.\n/,
  },
  {
    fichier: 'docs/design-system/content.md',
    re: /Liste complète du jargon conservé[^:]*:([\s\S]*?)\. Ne pas/,
  },
  {
    fichier: 'docs/manuel.html',
    re: /<p>((?:<code>[^<]+<\/code>,?\s*)+)\s*restent en anglais/,
  },
];

const echecs = [];

/** Une ancre absente ÉCHOUE : un détecteur qui ne trouve plus sa liste ne prouve rien. */
function extraire({ fichier, re }) {
  const chemin = resolve(REPO_ROOT, fichier);
  if (!existsSync(chemin)) {
    echecs.push(`${fichier} introuvable.`);
    return null;
  }
  const m = readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n').match(re);
  if (!m) {
    echecs.push(
      `${fichier} : la liste de jargon est introuvable. La phrase a été reformulée — corriger ` +
        `ce détecteur dans le même geste, ou il cesse de garder en silence.`,
    );
    return null;
  }
  return m[1]
    .replace(/<\/?code>/g, '')
    .replace(/\([^)]*\)/g, '') // la parenthèse explicative de CLAUDE.md après LOSSLESS
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const listes = SOURCES.map((s) => ({ ...s, termes: extraire(s) })).filter((s) => s.termes);

// ------------------------------------------------------- 1. les trois copies sont d'accord
if (listes.length === SOURCES.length) {
  const [ref, ...autres] = listes;
  console.log(`1. copies — ${ref.fichier} : ${ref.termes.length} terme(s).`);
  for (const a of autres) {
    if (a.termes.join(' · ') !== ref.termes.join(' · ')) {
      const manque = ref.termes.filter((t) => !a.termes.includes(t));
      const trop = a.termes.filter((t) => !ref.termes.includes(t));
      echecs.push(
        `${a.fichier} diverge de ${ref.fichier}.\n` +
          `    absents ici : ${manque.join(', ') || 'aucun'}\n` +
          `    en trop ici : ${trop.join(', ') || 'aucun'}\n` +
          `    ordre ${a.fichier} : ${a.termes.join(', ')}`,
      );
    }
  }
}

// ------------------------------------------------------- 2. aucun terme mort
const EXCLUS = new Set(['node_modules', 'dist', '.git']);
function fichiersFrontend(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!EXCLUS.has(e.name)) fichiersFrontend(join(dir, e.name), out);
    } else if (['.ts', '.tsx', '.js'].includes(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/** Le contenu des commentaires devient des espaces : `CHECK MATCH` n'y survivait QUE dans un
 *  commentaire qui annonce son retrait, et le compter là rendrait la règle inapplicable. */
function sansCommentaires(texte) {
  let hors = '';
  let i = 0;
  let etat = 'code';
  let delim = '';
  while (i < texte.length) {
    const c = texte[i];
    const s = texte[i + 1];
    if (etat === 'code') {
      if (c === '/' && s === '/') { etat = 'ligne'; hors += '  '; i += 2; continue; }
      if (c === '/' && s === '*') { etat = 'bloc'; hors += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { etat = 'chaine'; delim = c; }
      hors += c; i += 1; continue;
    }
    if (etat === 'chaine') {
      if (c === '\\') { hors += '  '; i += 2; continue; }
      if (c === delim) etat = 'code';
      hors += c; i += 1; continue;
    }
    if (etat === 'ligne') {
      if (c === '\n') { etat = 'code'; hors += '\n'; } else hors += ' ';
      i += 1; continue;
    }
    if (c === '*' && s === '/') { etat = 'code'; hors += '  '; i += 2; continue; }
    hors += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return hors;
}

/** Un dictionnaire (`frontend/i18n/<module>.ts`) porte les deux langues, et seule sa moitié
 *  FRANÇAISE parle de ce que la liste décrit : du jargon anglais « conservé dans l'interface »
 *  française. Dans la moitié anglaise, FAKE ou MATCH sont des mots ordinaires. Les compter là
 *  rendait la règle aveugle depuis la migration i18n du 2026-09-23 : un terme retiré de l'interface
 *  française restait « vivant » grâce à sa traduction anglaise. La forme d'un dictionnaire est fixe
 *  (`frontend/i18n.ts`) — `const fr = {…}` puis `const en: typeof fr = {…}` — donc la coupe se fait
 *  à `const en`. Un dictionnaire sans cette ligne n'a pas la forme attendue : échec, pas repli. */
function moitieFrancaise(fichier, texte) {
  if (!/[\\/]i18n[\\/][^\\/]+\.ts$/.test(fichier)) return texte;
  const i = texte.search(/^const en\b/m);
  if (i < 0) {
    echecs.push(`${fichier} : dictionnaire sans \`const en\` — forme de frontend/i18n.ts non respectée.`);
    return texte;
  }
  return texte.slice(0, i);
}

const racine = resolve(REPO_ROOT, 'frontend');
const corpus = existsSync(racine)
  ? fichiersFrontend(racine)
      .map((f) => sansCommentaires(moitieFrancaise(f, readFileSync(f, 'utf8'))))
      .join('\n')
  : '';

if (listes.length > 0 && corpus) {
  const termes = listes[0].termes;
  const morts = termes.filter((t) => !corpus.includes(t));
  console.log(`2. termes morts — ${termes.length} terme(s) cherché(s) dans frontend/, ${morts.length} absent(s).`);
  for (const t of morts) {
    echecs.push(
      `« ${t} » est listé comme jargon conservé dans l'UI, mais AUCUNE chaîne de frontend/ ne le ` +
        `porte (commentaires exclus). Soit le terme est mort et sort des trois listes, soit il ` +
        `n'a jamais atteint l'écran.`,
    );
  }
}

if (echecs.length === 0) {
  console.log('\nlint-jargon-allowlist: liste cohérente et vivante — pass.');
  process.exit(0);
}
console.error(`\nlint-jargon-allowlist: ÉCHEC — ${echecs.length} écart(s).`);
for (const e of echecs) console.error(`  · ${e}`);
console.error(
  `\nCette liste vit dans TROIS fichiers, dont un publié sur le site. Une seule copie corrigée ` +
    `laisse les deux autres mentir.`,
);
process.exit(1);
