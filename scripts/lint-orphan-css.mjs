#!/usr/bin/env node
// lint-orphan-css.mjs — détecte les classes de `styles.css` que plus aucun markup ne pose.
//
// POURQUOI CETTE GATE EXISTE. Le relevé du 2026-09-16 a trouvé VINGT classes déclarées sans un
// seul écrivain dans le dépôt, et toutes ont la même histoire : un commit a retiré le markup, la
// règle est restée. `.sift-bar-icon` est le cas d'école — posée par `2d2c6d4` pour armer le mode
// Lot depuis la barre, son unique poseur retiré par `3c1e05e` quand l'armement est descendu dans
// la file, et son doc-comment affirmait encore « Aujourd'hui un seul porteur : l'icône de
// sélection de Revue ». Une règle morte ment donc deux fois : elle occupe la feuille, et elle
// documente un écran qui n'existe plus.
//
// Aucun outil du dépôt ne pouvait l'attraper :
//   · `lint:tokens` lit les VALEURS d'une règle, jamais son nombre de porteurs ;
//   · `lint:css-comments` garde la syntaxe des commentaires, pas la vie des sélecteurs ;
//   · `lint:orphan-exports` s'arrête aux `export` TypeScript ;
//   · aucun test ne peut voir le markup qui N'EST PAS écrit.
// Cran 2 du barème de `CLAUDE.md`, comme ses trois jumelles : c'est un raté de MOTIF.
//
// CE QU'IL NE VOIT PAS, et c'est assumé :
//   · une classe posée par une feuille de style tierce ou par le navigateur ;
//   · une classe nommée uniquement dans une chaîne construite à l'exécution — d'où la liste
//     `FAMILLES_CONSTRUITES` ci-dessous, qui doit citer le site de construction ;
//   · une classe qui n'existe QUE dans un commentaire CSS : les commentaires sont retirés avant
//     l'extraction, sans quoi les tombstones du fichier (« LES 16 RÈGLES `.sift-home-*` ONT ÉTÉ
//     RETIRÉES ICI ») ressusciteraient les noms qu'elles enterrent. Sans ce retrait le relevé
//     sortait 86 noms au lieu de 20, dont 66 faux.
//
// Ratchet à baseline versionnée, même contrat que les trois autres : seule une HAUSSE échoue.
// Baisser le compte se grave par --write-baseline.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const REPO_ROOT = resolve(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '..',
);
const BASELINE_FILE = resolve(REPO_ROOT, 'scripts', 'lint-orphan-css-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const FEUILLE = resolve(REPO_ROOT, 'frontend', 'styles.css');

/**
 * Les familles dont le nom complet est CONSTRUIT à l'exécution, donc introuvable par recherche
 * textuelle. Chaque entrée cite son site de construction — une entrée sans site vérifiable est un
 * trou dans la gate, pas une exemption.
 */
const FAMILLES_CONSTRUITES = [
  ['sift-bs-section--', 'batch-sheet.ts (ton de la section)'],
  ['sift-rail-src-dot-', 'rail-source-entry.ts, context-menu.ts (teinte de source)'],
  ['ti-fill-', 'report-view.ts (glyphe de transport plein)'],
  ['sift-pz-', 'progress-zone.ts (genre de tâche)'],
  ['qi-', 'queue-panel.ts (identifiant de ligne de file)'],
  ['color-hue-', 'hue-solid.stories.ts (nuancier de story)'],
  ['jrnl-group--l', 'journal.ts:446 (niveau de groupe)'],
];

/** Tous les fichiers susceptibles de POSER une classe. */
function ecrivains() {
  const out = [];
  const pile = [
    resolve(REPO_ROOT, 'frontend'),
    resolve(REPO_ROOT, 'src-tauri', 'src'),
    resolve(REPO_ROOT, 'shared'),
  ];
  while (pile.length) {
    const d = pile.pop();
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) pile.push(p);
      else if (/\.(ts|js|mjs|html|rs)$/.test(e) && !e.endsWith('styles.css')) out.push(p);
    }
  }
  const racine = resolve(REPO_ROOT, 'index.html');
  if (existsSync(racine)) out.push(racine);
  return out;
}

const css = readFileSync(FEUILLE, 'utf8')
  // Les commentaires d'abord : ils enterrent des noms, ils n'en déclarent aucun.
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  // `url(icons.woff2)` n'est pas un sélecteur `.woff2`.
  .replace(/url\([^)]*\)/g, 'url()');

const declarees = new Set((css.match(/\.[a-zA-Z][\w-]*/g) || []).map((s) => s.slice(1)));

/**
 * Le texte d'un fichier source, SANS ses lignes de commentaire.
 *
 * Trouvé le 2026-09-16, quelques heures après la mise en service de cette gate, par l'audit
 * Karpathy : `.sift-bib-count` n'est posée par aucun markup, et pourtant cette gate la déclarait
 * vivante — sa seule mention hors CSS est le doc-comment de `queue-count-label.ts:35`, qui
 * renvoie à elle comme au « compte jumeau de la Bibliothèque ». Ce jumeau a déménagé dans
 * `#sift-tb-count` le 2026-09-08 ; le commentaire ne l'a pas suivi. Un commentaire périmé
 * maintenait donc une règle morte en vie, et les deux défauts se protégeaient.
 *
 * Même correctif que côté CSS, où les tombstones ressuscitaient les noms qu'elles enterrent.
 *
 * On ne retire QUE les lignes entièrement commentaires : un `//` en fin de ligne de code est
 * laissé tel quel, et une classe posée par du vrai code n'est jamais seule sur une ligne de
 * commentaire. Le risque d'un strip plus ambitieux — avaler une chaîne contenant `//`, ou un
 * littéral d'expression régulière — serait un FAUX POSITIF, c'est-à-dire crier sur une classe
 * vivante. Bien pire que le faux négatif qu'on corrige.
 */
function sansCommentaires(texte) {
  return texte
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#'));
    })
    .join('\n');
}

let blob = '';
for (const f of ecrivains()) blob += `\n${sansCommentaires(readFileSync(f, 'utf8'))}`;

/**
 * Le nom apparaît-il comme un NOM ENTIER dans le code, et non comme un fragment ?
 *
 * `blob.includes(c)` suffisait tant qu'aucune classe n'était courte. `.mf` a montré la limite le
 * 2026-09-16 : elle n'est posée par aucun markup, et pourtant elle passait — le fragment `mf` vit
 * dans `aacmf256`, un nom de famille du corpus de détection cité dans les commentaires de
 * `analysis/mdct.rs`. Un nom court est donc tenu vivant par n'importe quel mot qui le contient.
 *
 * Pas de `\b` : un nom de classe contient des tirets, que JavaScript ne compte pas comme des
 * caractères de mot, donc `\b` couperait au mauvais endroit. On vérifie les deux voisins à la
 * main.
 */
function nommeeEntierement(texte, nom) {
  const bord = /[A-Za-z0-9_-]/;
  let i = texte.indexOf(nom);
  while (i !== -1) {
    const avant = i === 0 ? '' : texte[i - 1];
    const apres = texte[i + nom.length] ?? '';
    if (!bord.test(avant) && !bord.test(apres)) return true;
    i = texte.indexOf(nom, i + 1);
  }
  return false;
}

const orphelines = [];
for (const c of [...declarees].sort()) {
  if (nommeeEntierement(blob, c)) continue;
  if (FAMILLES_CONSTRUITES.some(([p]) => c.startsWith(p))) continue;
  orphelines.push(c);
}

const compte = orphelines.length;

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ count: compte, items: orphelines }, null, 2)}\n`);
  console.log(`lint-orphan-css: baseline gravée à ${compte}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).count
  : 0;

console.log(
  `lint-orphan-css: ${compte} classe(s) sans écrivain dans ${relative(REPO_ROOT, FEUILLE).replace(/\\/g, '/')} (baseline ${baseline}).`,
);
for (const o of orphelines) console.log(`  .${o}`);

if (compte > baseline) {
  console.error(
    `lint-orphan-css: ÉCHEC — ${compte - baseline} classe(s) orpheline(s) de plus que la baseline.`,
  );
  console.error(
    'Retirer la règle (avec son doc, et une tombstone datée comme le reste du fichier), ou poser la classe.',
  );
  console.error(
    "Un nom construit à l'exécution s'inscrit dans FAMILLES_CONSTRUITES avec son site de construction.",
  );
  process.exit(1);
}
if (compte < baseline) {
  console.log('lint-orphan-css: sous la baseline — graver le gain par --write-baseline.');
}
console.log('lint-orphan-css: dans la baseline — pass.');
