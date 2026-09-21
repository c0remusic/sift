#!/usr/bin/env node
// lint-pointer-capture.mjs — un élément qui CAPTURE le pointeur ne doit pas aussi écouter des
// événements SOURIS. Les deux familles ne coexistent pas sur le même élément, et leur mélange
// échoue EN SILENCE.
//
// LE RATÉ QUI A MOTIVÉ CETTE GATE, signalé par Antoine avec capture le 2026-09-17 : la bulle
// mm:ss du lecteur ne suivait pas le pouce pendant un glissement. Le slider de progression
// (`report-view.ts`) pilotait le POUCE par `pointermove` et la BULLE par `mousemove`, sur le même
// élément — et son `pointerdown` appelle `preventDefault()`.
//
// Pointer Events niveau 3, § 11 « Compatibility mapping with mouse events », normatif :
//
//   « If the pointer event dispatched was pointerdown and the event was canceled, then set the
//     PREVENT MOUSE EVENT flag for this pointerType. »
//
// La spec compare les deux séquences : un `pointerdown` normal donne « zero or more pointermove
// AND mousemove events », un `pointerdown` annulé donne « zero or more pointermove events » —
// sans mousemove. Le `mousemove` est donc supprimé pour TOUT le glissement, et la bulle gelait à
// sa dernière position de survol pendant que le pouce avançait.
//
// POURQUOI UN LINT ET PAS UN TEST. La suite Vitest du dépôt tourne en env Node SANS jsdom, par
// décision documentée (`CLAUDE.md` § Architecture) : elle ne peut ni dispatcher un vrai
// `pointerdown`, ni exercer `setPointerCapture`, ni observer la suppression des événements de
// compatibilité — qui est un comportement de MOTEUR, pas de DOM. Le cran 1 est donc réellement
// hors de portée ici, et c'est le cran 2 qui garde : le défaut est un MOTIF (deux familles
// d'événements sur un même élément), il se compte.
//
// CE QU'IL NE VOIT PAS, et c'est assumé : un élément dont la capture et l'écoute souris vivent
// dans deux FICHIERS différents, et un élément atteint par une expression et non par une variable
// nommée. Le détecteur travaille par nom de récepteur dans un même fichier — la forme réelle du
// bug, et celle qu'un futur slider reproduirait en copiant son voisin.
//
// ⚠️ Un `mousemove` sur `document` n'est PAS visé, et c'est voulu : `library-columns.ts`,
// `router.ts` et `toolbar.ts` font du glissement en souris pure, sans un seul événement pointeur.
// Cette famille-là est cohérente, donc correcte.
//
// Ratchet à baseline versionnée, même contrat que lint-accents.mjs : seule une HAUSSE échoue.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const BASELINE_FILE = resolve(REPO_ROOT, 'scripts', 'lint-pointer-capture-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'target', '.claude']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js']);
const SCAN_ROOTS = ['frontend'];

// Les événements souris qu'un élément capturant ne recevra plus de façon fiable.
const SOURIS = ['mousemove', 'mouseleave', 'mouseenter', 'mousedown', 'mouseup', 'mouseover', 'mouseout'];

function fichiers(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) fichiers(join(dir, e.name), out);
    } else if (SCAN_EXTS.has(extname(e.name))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const trouves = [];
for (const racine of SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, racine);
  if (!existsSync(abs)) continue;
  for (const chemin of fichiers(abs)) {
    const texte = readFileSync(chemin, 'utf8');
    // Les récepteurs de capture du fichier : `X.setPointerCapture(`.
    const captureurs = new Set(
      [...texte.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*setPointerCapture\s*\(/g)].map((m) => m[1]),
    );
    if (captureurs.size === 0) continue;
    const lignes = texte.split('\n');
    for (const [i, ligne] of lignes.entries()) {
      const m = ligne.match(/([A-Za-z_$][\w$]*)\s*\.\s*addEventListener\s*\(\s*["']([a-z]+)["']/);
      if (!m) continue;
      const [, recepteur, evenement] = m;
      if (!captureurs.has(recepteur) || !SOURIS.includes(evenement)) continue;
      trouves.push({
        fichier: relative(REPO_ROOT, chemin).replace(/\\/g, '/'),
        ligne: i + 1,
        recepteur,
        evenement,
      });
    }
  }
}

const parFichier = {};
for (const t of trouves) parFichier[t.fichier] = (parFichier[t.fichier] ?? 0) + 1;
const total = trouves.length;

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ total, parFichier }, null, 2)}\n`, 'utf8');
  console.log(`lint-pointer-capture: baseline écrite — ${total} occurrence(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { total: 0, parFichier: {} };

for (const t of trouves) {
  console.log(
    `${t.fichier}:${t.ligne}: \`${t.recepteur}\` capture le pointeur ET écoute \`${t.evenement}\` — ` +
      `un pointerdown annulé supprime les événements souris de ce pointeur (Pointer Events L3 § 11). ` +
      `Utiliser \`pointer${t.evenement.slice(5)}\`.`,
  );
}

console.log(`lint-pointer-capture: ${total} occurrence(s) (baseline ${baseline.total}).`);
if (total > baseline.total) {
  console.error(
    `lint-pointer-capture: HAUSSE de ${total - baseline.total} — un élément capturant ne doit pas ` +
      `écouter la souris. Baisser la baseline se grave par --write-baseline.`,
  );
  process.exit(1);
}
console.log('lint-pointer-capture: dans la baseline — pass.');
