#!/usr/bin/env node
// lint-claude-md-inventories.mjs — les trois INVENTAIRES de `CLAUDE.md` doivent dire ce que le
// dépôt fait réellement. Un inventaire périmé échoue EN SILENCE : le fichier reste lisible, rien
// ne compile moins bien, et un agent qui s'y fie saute une gate sans jamais le savoir.
//
// LE RATÉ QUI A MOTIVÉ CETTE GATE, et il est écrit dans `CLAUDE.md` lui-même : « ⚠️ Cette liste
// n'a nommé que CINQ DES HUIT jusqu'au 2026-09-16 : les trois lints ajoutés en septembre —
// `lint:orphans`, `lint:orphan-css`, `lint:css-comments` — tournaient sans être écrits ici ».
// Trois gates tournaient donc en fin de tour sans exister pour quiconque lisait la doc. Corrigé
// à la main par `2624f65`, et rien n'empêchait que ça recommence au lint suivant — ce qui a
// failli arriver deux fois depuis (`lint:pointer-capture` le 2026-09-21, `lint:dead-label` le
// 2026-09-22), rattrapé les deux fois par une relecture, pas par une machine.
//
// Le même fichier prescrit déjà le remède, sans pouvoir l'appliquer : « la vérifier se fait par
// `grep -oE '^ *run \"' .claude/verify.sh`, JAMAIS DE MÉMOIRE ». Cette gate est ce grep, rendu
// exécutable et étendu aux deux autres inventaires.
//
// LES TROIS CONTRÔLES :
//   1. § Commandes — tout script `lint:*` de `package.json` est nommé, et aucun nom fantôme.
//   2. § Définition de fini — la liste des étapes de `.claude/verify.sh`, DANS L'ORDRE.
//   3. § Définition de fini — l'ordre réel des étapes de `.github/workflows/test.yml`.
//
// PAS DE BASELINE, contrairement à ses voisines, et c'est délibéré. Un ratchet sert à ne pas
// empirer une dette qu'on tolère ; ici l'état correct est l'ÉGALITÉ EXACTE, et graver un
// inventaire faux dans une baseline reviendrait à bénir précisément le défaut visé.
//
// FAIL-FAST SUR LES ANCRES : si un marqueur de section est introuvable, la gate ÉCHOUE au lieu
// de passer. Un parseur qui ne trouve plus son ancre ne prouve rien, et un vert qui ne prouve
// rien est exactement ce que ce dépôt appelle « une mesure vide n'est pas un succès ».
//
// MESURE : lancée sur l'arbre de `2624f65^` — celui qui portait le défaut — elle sort les trois
// lints manquants et rend 1. Sur HEAD, 0. Mode `--from-git <rev>` prévu pour ça.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');

const iRev = process.argv.indexOf('--from-git');
const REV = iRev >= 0 ? process.argv[iRev + 1] : null;

const CHEMINS = {
  claude: 'CLAUDE.md',
  verify: '.claude/verify.sh',
  ci: '.github/workflows/test.yml',
  pkg: 'package.json',
};

function lire(rel) {
  const texte = REV
    ? execFileSync('git', ['show', `${REV}:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    : readFileSync(resolve(REPO_ROOT, rel), 'utf8');
  return texte.replace(/\r\n/g, '\n');
}

const echecs = [];
const dire = (m) => console.log(m);

let claude, verify, ci, pkg;
try {
  claude = lire(CHEMINS.claude);
  verify = lire(CHEMINS.verify);
  ci = lire(CHEMINS.ci);
  pkg = JSON.parse(lire(CHEMINS.pkg));
} catch (e) {
  console.error(`lint-claude-md-inventories: fichier illisible — ${e.message}`);
  process.exit(1);
}

/** Une ancre absente est un ÉCHEC, jamais un passage. */
function ancre(texte, re, quoi) {
  const m = texte.match(re);
  if (!m) {
    echecs.push(
      `ancre introuvable : ${quoi}. La section a été reformulée — corriger ce détecteur dans le ` +
        `même geste, ou il cesse de garder en silence.`,
    );
    return null;
  }
  return m[1];
}

// ---------------------------------------------------------------- 1. § Commandes
{
  const declares = Object.keys(pkg.scripts ?? {})
    .filter((k) => k.startsWith('lint:'))
    .sort();
  const nommes = [...new Set([...claude.matchAll(/npm run (lint:[a-z-]+)/g)].map((m) => m[1]))].sort();
  const absents = declares.filter((l) => !nommes.includes(l));
  const fantomes = nommes.filter((l) => !declares.includes(l));
  dire(`1. § Commandes — ${declares.length} lint(s) dans package.json, ${nommes.length} nommé(s).`);
  for (const l of absents) echecs.push(`§ Commandes ne nomme pas \`npm run ${l}\`, qui existe dans package.json.`);
  for (const l of fantomes) echecs.push(`§ Commandes nomme \`npm run ${l}\`, qui n'existe pas dans package.json.`);
}

// ---------------------------------------------------------------- 2. liste de verify.sh
{
  const reel = [...verify.matchAll(/^\s*run "([^"]+)"/gm)].map((m) => {
    const p = m[1].match(/\(([^)]+)\)/);
    return (p ? p[1] : m[1]).trim();
  });
  // `cargo check` est borné par un timeout et lancé hors d'un `run "..."`.
  if (/timeout 25/.test(verify)) reel.push('cargo check');

  const bloc = ancre(claude, /\*\*`\.claude\/verify\.sh`\*\*([\s\S]*?)⚠️ Cette liste/, 'liste de verify.sh');
  if (bloc !== null) {
    const cites = [...bloc.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    dire(`2. § verify.sh — ${reel.length} étape(s) réelle(s), ${cites.length} citée(s).`);
    if (reel.join(' + ') !== cites.join(' + ')) {
      for (const r of reel) if (!cites.includes(r)) echecs.push(`verify.sh lance \`${r}\`, que CLAUDE.md ne cite pas.`);
      for (const c of cites) if (!reel.includes(c)) echecs.push(`CLAUDE.md cite \`${c}\`, que verify.sh ne lance pas.`);
      if (reel.every((r) => cites.includes(r)) && cites.every((c) => reel.includes(c))) {
        echecs.push(`verify.sh : mêmes étapes, ORDRE différent.\n    réel  : ${reel.join(' + ')}\n    écrit : ${cites.join(' + ')}`);
      }
    }
  }
}

// ---------------------------------------------------------------- 3. ordre de la CI
{
  const BOOTSTRAP = ['fetch-ffmpeg', 'make-fixtures'];
  const cle = (c) => {
    if (c.includes('check-tauri-security')) return 'check:security';
    if (c.startsWith('npx tsc')) return 'tsc --noEmit';
    if (c.startsWith('cargo fmt')) return 'cargo fmt --check';
    if (c.startsWith('cargo clippy')) return 'clippy -D warnings';
    if (c.startsWith('cargo test')) return 'cargo test';
    return c.replace('npm run ', '').trim();
  };
  const reel = [...ci.matchAll(/^\s+run: (npm run [a-z:-]+|npx tsc --noEmit|cargo [^\n]+|node [^\n]+)/gm)]
    .map((m) => m[1])
    .filter((c) => !BOOTSTRAP.some((b) => c.includes(b)))
    .map(cle);

  const ligne = ancre(claude, /dans cet ordre([\s\S]*?)Ordre délibéré/, 'ordre réel de la CI');
  if (ligne !== null) {
    const ecrit = [...ligne.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1].trim())
      .map((c) => (c === 'npm run test' || c === 'npm run lint' ? c.replace('npm run ', '') : c));
    dire(`3. § ordre CI — ${reel.length} étape(s) réelle(s) hors bootstrap, ${ecrit.length} écrite(s).`);
    if (reel.join(' → ') !== ecrit.join(' → ')) {
      const n = Math.max(reel.length, ecrit.length);
      for (let i = 0; i < n; i += 1) {
        const a = reel[i] ?? '(rien)';
        const b = ecrit[i] ?? '(rien)';
        if (a !== b) echecs.push(`ordre CI, position ${i + 1} : test.yml lance \`${a}\`, CLAUDE.md écrit \`${b}\`.`);
      }
    }
  }
}

// ----------------------------------------------------------------
const ou = REV ? `à ${REV}` : 'sur l’arbre courant';
if (echecs.length === 0) {
  dire(`\nlint-claude-md-inventories: les trois inventaires sont justes ${ou} — pass.`);
  process.exit(0);
}
console.error(`\nlint-claude-md-inventories: ÉCHEC ${ou} — ${echecs.length} écart(s).`);
for (const e of echecs) console.error(`  · ${e}`);
console.error(
  `\nUn inventaire périmé de CLAUDE.md ne casse rien et se lit sans qu'on le remarque : c'est ` +
    `pour ça qu'il se compte. Corriger le fichier, jamais le détecteur — sauf si une ancre a bougé.`,
);
process.exit(1);
