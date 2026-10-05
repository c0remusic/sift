// Le BRANCHEMENT des gardes clavier et de la garde d'écran de Rangés, lu dans les vrais fichiers.
//
// `key-chords.test.ts` tient les prédicats (`isBareKey`, `isUndoChord`…). Il ne tient pas leur
// place : la revue adverse du 2026-10-05 l'a mesuré — supprimer l'appel à `isBareKey` dans
// `filing.ts`, ou passer l'accord de l'inspecteur sous la garde « Ctrl sans Alt » de
// `shortcuts.ts`, laissait la suite verte. Et deux défauts de la même revue vivaient dans un ORDRE
// d'instructions, pas dans une valeur :
//   · la couche 3 de Revue gardait sur `state.track`, qui survit à la navigation : Espace et
//     Entrée de Revue agissaient sur TOUS les écrans ;
//   · `renderBiblioLive`, appelé par un rappel tardif depuis un autre écran, y peignait Rangés.
//
// Les modules visés touchent au DOM et à l'IPC : ils ne se chargent pas en env Node. Le test lit
// donc leur source, comme `queue-row-height.test.ts`. Chaque garde a été mesurée en la retirant.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Fins de ligne ramenées à LF : le dépôt mélange LF et CRLF selon les fichiers, et une extraction
// Windows (core.autocrlf) les passe toutes en CRLF.
const lire = (chemin: string): string => readFileSync(chemin, "utf8").replace(/\r\n/g, "\n");
const FILING = lire("frontend/filing.ts");
const SHORTCUTS = lire("frontend/shortcuts.ts");
const JOURNAL = lire("frontend/journal.ts");
const BIBLIO = lire("frontend/bibliotheque-view.ts");

/** Le corps d'une fonction de premier niveau : de sa signature à la suivante. */
function corps(src: string, signature: string): string {
  const debut = src.indexOf(signature);
  if (debut < 0) throw new Error(`signature introuvable : ${signature}`);
  const suite = src.slice(debut + signature.length);
  const fin = suite.search(/\n(?:export )?(?:async )?function /);
  return fin < 0 ? suite : suite.slice(0, fin);
}

/** Position d'un motif, qui DOIT être présent. */
function pos(texte: string, motif: string): number {
  const i = texte.indexOf(motif);
  if (i < 0) throw new Error(`motif introuvable : ${motif}`);
  return i;
}

describe("couche 3 de Revue (filing.ts::installFilingKeys)", () => {
  const f = corps(FILING, "export function installFilingKeys");
  const premiereTouche = pos(f, "e.key ===");

  it("n'écoute que les touches NUES, avant toute touche lue", () => {
    expect(pos(f, "if (!isBareKey(e)) return;")).toBeLessThan(premiereTouche);
  });

  it("n'agit que si le panneau de Revue est à l'écran, pas sur la seule piste en mémoire", () => {
    expect(pos(f, '!mid?.querySelector(".sift-fil")')).toBeLessThan(premiereTouche);
  });

  it("laisse ses touches à un menu contextuel ouvert", () => {
    expect(pos(f, `t?.closest('[role="menu"]')`)).toBeLessThan(premiereTouche);
  });
});

describe("annulation globale (filing.ts::installUndoShortcut)", () => {
  it("passe par `isUndoChord` : Maj+Ctrl+Z n'annule pas une seconde action", () => {
    const f = corps(FILING, "export function installUndoShortcut");
    expect(f).toContain("if (!isUndoChord(e)) return;");
  });
});

describe("couche 1 (shortcuts.ts)", () => {
  it("lit l'accord de l'inspecteur AVANT la garde qui écarte tout accord avec Alt", () => {
    const f = corps(SHORTCUTS, "export function installWindowShortcuts");
    expect(pos(f, "if (isInspectorToggleChord(e))")).toBeLessThan(pos(f, "if (!mod || e.altKey) return;"));
  });
});

describe("Journal : ⇧⌘A sur une sélection vide ne repeint rien", () => {
  it("sort avant de vider, faute de quoi la zone D s'ouvrait sur « 0 action »", () => {
    const branche = JOURNAL.slice(pos(JOURNAL, 'if (sel === "none") {'));
    expect(pos(branche, "if (!jrnlState.selection.size) return;")).toBeLessThan(pos(branche, "jrnlState.selection.clear();"));
  });
});

describe("Rangés (bibliotheque-view.ts)", () => {
  it("ne peint rien hors de son écran : la garde précède toute écriture de #content", () => {
    const f = corps(BIBLIO, "export async function renderBiblioLive");
    expect(pos(f, 'if (document.body.dataset.view !== "biblio") return;')).toBeLessThan(pos(f, "content.innerHTML"));
  });

  it("suit une édition de fiche EN PLACE, sans rendu complet qui renverrait la table en haut", () => {
    const f = corps(BIBLIO, "export function openBiblioDetail");
    const rappel = f.slice(pos(f, "(updated) => {"));
    const finRappel = pos(rappel, "\n    },");
    expect(rappel.slice(0, finRappel)).toContain("patchBibRow(updated);");
    expect(rappel.slice(0, finRappel)).not.toContain("renderBiblioLive");
  });
});
