// Dictionnaire de l'écran Réglages (`frontend/i18n/reglages-view.ts`).
//
// `reglages-view.ts` lui-même ne se charge pas en env Node (il importe `./ipc` et le plugin de
// dialogue) ; ce qui se tient ici, c'est ce qu'une valeur de dictionnaire peut casser SANS erreur de
// compilation : quatre valeurs partent dans un attribut HTML entre guillemets doubles (`placeholder`,
// `title`, `aria-label`), et un `"`, `<` ou `>` y fermerait l'attribut en plein milieu. Et les
// catégories de la colonne doivent couvrir les quatre sections rendues, dans les deux langues —
// une clé manquante retomberait sur la clé brute (`bibliotheque`) à l'écran.
import { describe, expect, it } from "vitest";
import { D } from "../frontend/i18n/reglages-view";

const SECTIONS = ["bibliotheque", "nommage", "discogs", "apparence"];

describe("dictionnaire de Réglages", () => {
  for (const l of ["fr", "en"] as const) {
    it(`${l} : aucune valeur posée en attribut ne contient " < ou >`, () => {
      const d = D[l];
      for (const v of [d.jetonPlaceholder, d.afficherJeton, d.masquerJeton, d.modeleAria, d.categoriesAria]) {
        expect(v, v).not.toMatch(/["<>]/);
        expect(v.length).toBeGreaterThan(0);
      }
    });

    it(`${l} : chaque section rendue a son libellé de catégorie`, () => {
      const labels: Record<string, string> = D[l].categories;
      for (const s of SECTIONS) expect(labels[s], s).toBeTruthy();
    });
  }

  it("le français est celui d'avant la migration, l'anglais suit le vocabulaire canonique", () => {
    expect(D.fr.categories.bibliotheque).toBe("Général");
    expect(D.fr.colonneTitre).toBe("Réglages");
    expect(D.en.colonneTitre).toBe("Settings");
    expect(D.en.categories.apparence).toBe("Appearance");
  });
});
