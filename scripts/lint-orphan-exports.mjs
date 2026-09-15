#!/usr/bin/env node
// lint-orphan-exports.mjs — détecte les `export` de frontend/ et shared/ que personne n'importe.
//
// POURQUOI CETTE GATE EXISTE. La revue d'architecture du 2026-09-15 a trouvé
// `batch-panel.ts::isBatchRunning` — une ligne, exportée, ZÉRO appelant dans tout le dépôt, et
// mort-née : le commit qui l'écrit répond à sa propre question avec un AUTRE accesseur
// (`isBatchSheetOpen`, celui qui est réellement importé). Elle a vécu ainsi jusqu'à ce qu'une
// lecture humaine la voie.
//
// Aucun outil du dépôt ne pouvait l'attraper, et c'est le point :
//   · `tsconfig.json` a `noUnusedLocals` — il voit un IMPORT orphelin, jamais un EXPORT ;
//   · ESLint n'a que `@typescript-eslint/no-unused-vars`, qui s'arrête au fichier ;
//   · un test ne peut pas voir ses propres appelants.
// Le cran 1 du barème de CLAUDE.md est donc hors d'atteinte pour cette CLASSE de défaut, et le
// cran 2 est le bon — c'est un raté de MOTIF, pas de valeur.
//
// CE QU'IL NE VOIT PAS, et c'est assumé :
//   · un export réexporté en cascade (`export * from`) — le dépôt n'en a pas ;
//   · un symbole importé sous un autre nom au moyen d'un alias de chemin ;
//   · un export consommé uniquement par du HTML ou une chaîne construite à l'exécution.
// Le comptage est textuel, comme lint-tokens et lint-accents : il cherche le NOM ailleurs que
// dans sa propre définition. Un nom très court ou très courant est donc conservateur — il passera
// pour utilisé. Une gate qui attrape la forme dominante sans crier au loup vaut mieux qu'une gate
// exhaustive qu'on éteint.
//
// Ratchet à baseline versionnée, même contrat que les deux autres : seule une HAUSSE échoue.
// Baisser le compte se grave par --write-baseline.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const REPO_ROOT = resolve(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '..',
);
const BASELINE_FILE = resolve(REPO_ROOT, 'scripts', 'lint-orphan-exports-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const SCAN_DIRS = ['frontend', 'shared'];

/** Tous les fichiers TypeScript sous `dir`, en excluant les stories (elles n'importent rien). */
function fichiers(dir) {
  const out = [];
  const racine = resolve(REPO_ROOT, dir);
  if (!existsSync(racine)) return out;
  const pile = [racine];
  while (pile.length) {
    const d = pile.pop();
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        pile.push(p);
      } else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  }
  return out.sort();
}

// `export function nom`, `export const nom`, `export class nom`, `export type nom`…
// Volontairement PAS `export default` (sans nom) ni `export {}` (réexport, hors périmètre).
const DECLARATION =
  /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

const tous = SCAN_DIRS.flatMap(fichiers);
const source = new Map(tous.map((f) => [f, readFileSync(f, 'utf8')]));

// Les stories sont sources d'USAGE mais jamais scannées pour leurs déclarations : Storybook lit
// leurs exports nommés PAR CONVENTION, comme les variantes d'un composant, sans qu'aucun fichier
// ne les importe. Les compter donnerait 40 faux positifs structurels sur 68 — le taux auquel une
// gate se désactive la première semaine.
const EST_STORY = (f) => f.endsWith('.stories.ts');

// `shared/contracts.ts` est exclu pour une raison différente et tout aussi structurelle : c'est un
// MIROIR À LA MAIN des structs serde de `src-tauri/src/ipc*.rs`, et sa complétude est le point. Un
// type qui n'a pas encore de consommateur TypeScript y est normal — le retirer rendrait le miroir
// faux, ce qui est exactement le défaut que les tests Rust de contrat existent pour empêcher.
const EST_MIROIR = (f) => f.replace(/\\/g, '/').endsWith('shared/contracts.ts');

const orphelins = [];
for (const [fichier, texte] of source) {
  if (EST_STORY(fichier) || EST_MIROIR(fichier)) continue;
  for (const m of texte.matchAll(DECLARATION)) {
    const nom = m[1];
    // Cherché dans TOUS les autres fichiers : une seule mention suffit à le déclarer vivant.
    // Les stories et les tests comptent — un export qui ne sert qu'à Storybook sert.
    let vu = false;
    for (const [autre, t] of source) {
      if (autre === fichier) continue;
      if (new RegExp(`\\b${nom}\\b`).test(t)) {
        vu = true;
        break;
      }
    }
    if (!vu) {
      // Un export peut aussi être consommé depuis le même fichier par du code qui le réexporte,
      // ou depuis `test/` et `scripts/`. On regarde ces deux-là avant de conclure.
      for (const d of ['test', 'scripts', 'src-tauri/src']) {
        for (const f of fichiers(d)) {
          if (new RegExp(`\\b${nom}\\b`).test(readFileSync(f, 'utf8'))) {
            vu = true;
            break;
          }
        }
        if (vu) break;
      }
    }
    if (!vu) orphelins.push(`${relative(REPO_ROOT, fichier).replace(/\\/g, '/')}: ${nom}`);
  }
}

orphelins.sort();
const compte = orphelins.length;

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ count: compte, items: orphelins }, null, 2)}\n`);
  console.log(`lint-orphan-exports: baseline gravée à ${compte}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).count
  : 0;

console.log(`lint-orphan-exports: ${compte} export(s) sans importeur (baseline ${baseline}).`);
for (const o of orphelins) console.log(`  ${o}`);

if (compte > baseline) {
  console.error(
    `lint-orphan-exports: ÉCHEC — ${compte - baseline} export(s) orphelin(s) de plus que la baseline.`,
  );
  console.error("Retirer l'export, ou l'utiliser. Un ajout délibéré se grave par --write-baseline.");
  process.exit(1);
}
if (compte < baseline) {
  console.log('lint-orphan-exports: sous la baseline — graver le gain par --write-baseline.');
}
console.log('lint-orphan-exports: dans la baseline — pass.');
