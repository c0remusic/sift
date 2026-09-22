#!/usr/bin/env node
// lint-dead-label.mjs — un VERBE D'ACTION retiré de `docs/design-system/content.md` ne doit plus
// paraître dans un libellé du frontend. Un libellé mort survit EN SILENCE : rien ne compile
// moins bien, aucun test ne rougit, et l'utilisateur lit deux mots pour une seule action.
//
// LE RATÉ QUI A MOTIVÉ CETTE GATE, relevé le 2026-09-22. « Ranger » a quitté les « verbes
// préférés » de `content.md` le 2026-07-10 au profit de « Convertir » (retour utilisateur), et le
// bouton d'UNE piste a suivi — `filing.ts` porte même la décision en doc-comment. SEPT sites
// vivants ne l'ont pas su, pendant plus de deux mois :
//
//   - `confirm-modal.ts` ×3 — la modale que « Convertir » ouvre demandait « Ranger la sélection ? »
//     avec un bouton « Ranger 12 », tout en affichant « → Convertir » dans son propre récap. La
//     carte se contredisait elle-même.
//   - `selection-summary.ts` ×2 — le bouton PRIMAIRE du mode Lot disait « Ranger N pistes ».
//   - `queue-panel.ts` ×1 — l'entrée de clic droit de la file.
//   - `filing-bins.ts` ×1 — l'aide de l'arbre de destination.
//
// CE QUE CETTE GATE AJOUTE AU CRAN 1, qui existe et tient. `selection-summary.ts` est un module
// PUR (il le dit en tête), donc Vitest l'atteint : `test/selection-summary.test.ts` épingle
// désormais le verbe, et les trois mutations tombent 3/3. Mais `confirm-modal.ts`,
// `queue-panel.ts` et `filing-bins.ts` sont lourds en DOM (29, 52 et 10 accès à `document`), et la
// suite tourne en env Node SANS jsdom par décision documentée (`CLAUDE.md` § Architecture). Cinq
// des sept sont donc hors de portée du cran 1 — c'est là que ce lint garde, et nulle part ailleurs.
//
// POURQUOI LE TEST N'A RIEN VU VENIR, et c'est la vraie leçon : son aide `compteAffiche` LISAIT
// déjà le libellé (`/batchqueuefile">Ranger (\d+) piste/`) sans jamais l'épingler. Un test qui
// CONSOMME une chaîne ne la garde pas — il la suit. Il est resté vert tout du long.
//
// LA RÈGLE EST BORNÉE AU VERBE, et cette borne est le point délicat. « ranger » reste canonique
// comme ÉTAT (`content.md:28`, « État prêt | Prêt à ranger ») et comme concept produit
// (« déplacer = encoder + ranger », `CLAUDE.md`). Le détecteur ne vise donc que la forme
// capitalisée ISOLÉE : les identifiants la portent collée (`doRanger`, `estRangeableEnLot`,
// `refreshRangerButton`), l'attribut est en minuscules (`data-fil="ranger"`), et l'état aussi.
//
// CE QU'IL NE VOIT PAS, assumé :
//   - `frontend/app.js` est HORS PÉRIMÈTRE. C'est la maquette navigateur, chargée seulement hors
//     Tauri (`main.ts:61`), et `CLAUDE.md` écrit qu'elle « ne fait pas autorité ». Elle porte
//     quatre libellés « Ranger » ; les réécrire serait une décision de design sur une surface qui
//     n'est pas livrée, donc ça se propose, ça ne s'exécute pas.
//   - un libellé assemblé par concaténation de variables, que rien ne lit comme une chaîne.
//   - les autres verbes retirés. La table MORTS ci-dessous s'étend d'une ligne quand `content.md`
//     en retire un de plus.
//
// Ratchet à baseline versionnée, même contrat que ses voisines : seule une HAUSSE échoue.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const BASELINE_FILE = resolve(REPO_ROOT, 'scripts', 'lint-dead-label-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'target', '.claude']);
const SCAN_EXTS = new Set(['.ts', '.tsx']);
const SCAN_ROOTS = ['frontend'];

// Verbe retiré -> ce qui le remplace, et la ligne de content.md qui le déclare.
const MORTS = [{ mort: 'Ranger', vivant: 'Convertir', source: 'content.md:27 et § Actions, 2026-07-10' }];

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

/** Remplace le contenu des commentaires par des espaces, en gardant les numéros de ligne intacts.
 *  Un commentaire d'historique CITE forcément le verbe mort — c'est même son travail — donc ne pas
 *  les écarter rendrait la règle inapplicable, et une baseline non vide la viderait de son sens. */
function sansCommentaires(texte) {
  let hors = '';
  let i = 0;
  let etat = 'code'; // code | ligne | bloc | guillemet
  let delim = '';
  while (i < texte.length) {
    const c = texte[i];
    const suivant = texte[i + 1];
    if (etat === 'code') {
      if (c === '/' && suivant === '/') { etat = 'ligne'; hors += '  '; i += 2; continue; }
      if (c === '/' && suivant === '*') { etat = 'bloc'; hors += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { etat = 'guillemet'; delim = c; }
      hors += c; i += 1; continue;
    }
    if (etat === 'guillemet') {
      if (c === '\\') { hors += '  '; i += 2; continue; }
      if (c === delim) etat = 'code';
      hors += c; i += 1; continue;
    }
    if (etat === 'ligne') {
      if (c === '\n') { etat = 'code'; hors += '\n'; } else hors += ' ';
      i += 1; continue;
    }
    // bloc
    if (c === '*' && suivant === '/') { etat = 'code'; hors += '  '; i += 2; continue; }
    hors += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return hors;
}

const trouves = [];
for (const racine of SCAN_ROOTS) {
  const abs = resolve(REPO_ROOT, racine);
  if (!existsSync(abs)) continue;
  for (const chemin of fichiers(abs)) {
    const lignes = sansCommentaires(readFileSync(chemin, 'utf8')).split('\n');
    for (const [i, ligne] of lignes.entries()) {
      for (const { mort, vivant, source } of MORTS) {
        // Forme capitalisée ISOLÉE : ni collée à un identifiant devant, ni suivie d'une lettre.
        // `doRanger` et `estRangeableEnLot` sortent par là, « Prêt à ranger » par la casse.
        const re = new RegExp(`(^|[^\\w$])${mort}(?![\\w$])`, 'g');
        if (!re.test(ligne)) continue;
        trouves.push({
          fichier: relative(REPO_ROOT, chemin).replace(/\\/g, '/'),
          ligne: i + 1,
          mort,
          vivant,
          source,
        });
      }
    }
  }
}

const parFichier = {};
for (const t of trouves) parFichier[t.fichier] = (parFichier[t.fichier] ?? 0) + 1;
const total = trouves.length;

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ total, parFichier }, null, 2)}\n`, 'utf8');
  console.log(`lint-dead-label: baseline écrite — ${total} occurrence(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { total: 0, parFichier: {} };

for (const t of trouves) {
  console.log(
    `${t.fichier}:${t.ligne}: « ${t.mort} » est un verbe d'action RETIRÉ (${t.source}) — ` +
      `le libellé vivant est « ${t.vivant} ». L'état « Prêt à ranger » et le concept produit ne ` +
      `sont pas visés : seule la forme capitalisée isolée l'est.`,
  );
}

console.log(`lint-dead-label: ${total} occurrence(s) (baseline ${baseline.total}).`);
if (total > baseline.total) {
  console.error(
    `lint-dead-label: HAUSSE de ${total - baseline.total} — un verbe que content.md a retiré est ` +
      `revenu dans un libellé. Baisser la baseline se grave par --write-baseline.`,
  );
  process.exit(1);
}
console.log('lint-dead-label: dans la baseline — pass.');
