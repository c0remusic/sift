// Cliquet de couverture de la traduction : le nombre de littéraux portant du français visible hors
// des dictionnaires (`frontend/i18n/`) ne peut que DESCENDRE. Chacun est un texte que l'interface
// anglaise affichera en français.
//
// Pour abaisser le cliquet après une migration : remplacer PLAFOND par le compte affiché. Le
// remonter demande une raison écrite à côté — un texte ajouté en dur est exactement ce que ce
// fichier empêche.
import { describe, expect, it } from "vitest";
import { frenchLiterals, scanFrontend } from "../scripts/i18n-coverage.mjs";

const PLAFOND = 13;

describe("couverture de la traduction", () => {
  it("le détecteur voit un littéral français, et ignore commentaire, console et anglais", () => {
    const src = [
      'const a = "Aucune piste";',
      "// « Convertir » dans un commentaire",
      'console.error("échec de lecture", e);',
      'const b = `<button title="Choisis un dossier">${n}</button>`;',
      'const c = "No track";',
      'const d = "sift-qi-on";',
    ].join("\n");
    expect(frenchLiterals(src).map((h: { line: number }) => h.line)).toEqual([1, 4]);
  });

  it(`au plus ${PLAFOND} littéraux français hors de frontend/i18n/`, () => {
    const { files, hits } = scanFrontend(process.cwd());
    expect(files).toBeGreaterThan(30);
    const detail = hits.map((h: { file: string; line: number; text: string }) => `${h.file}:${h.line}  ${h.text}`);
    expect(hits.length, detail.join("\n")).toBeLessThanOrEqual(PLAFOND);
  });
});
