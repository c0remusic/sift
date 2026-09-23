// Les dictionnaires de `frontend/i18n/` : chaque module exporte ses deux langues (`D`) et son
// accesseur (`T`), et sa moitié ANGLAISE ne contient pas de français.
//
// La parité des clés n'est PAS testée ici : l'annotation `const en: typeof fr` la fait tenir par
// `tsc`, plus tôt et plus sûrement. Ce qui échappe à tsc, c'est une valeur anglaise qui est restée
// la chaîne française — même type, même clé, texte non traduit. C'est ce que ce fichier attrape, sur
// les feuilles `string` ; une fonction de dictionnaire ne peut pas être évaluée sans connaître ses
// arguments, et reste hors de portée.
import { describe, expect, it } from "vitest";

type Dict = Record<string, unknown>;
const modules = import.meta.glob<{ D?: { fr: Dict; en: Dict }; T?: unknown }>("../frontend/i18n/*.ts", {
  eager: true,
});

// Lettres que l'anglais n'écrit pas. « é » compris : aucun libellé anglais de l'app ne dit
// « café » ou « résumé », et si un jour il le fallait, la ligne s'ajoute à EXCEPTIONS.
const DIACRITIQUES = /[àâäéèêëîïôöùûüçœÀÂÉÈÊËÎÏÔÙÛÇŒ]/;
// Mots-outils français qui n'existent pas en anglais — pas « de », « le », « la », qui se
// retrouvent dans des noms propres ou des titres de piste d'exemple.
const MOTS_FR = /\b(les|des|une|du|pour|dans|avec|sans|aucun|aucune|pistes?|fichiers?|dossiers?|réessaie|choisis)\b/i;
const EXCEPTIONS = new Set<string>([
  // Noms de langue écrits dans leur langue (`reglages-view.ts`, rangée Langue).
  "Français",
]);

function feuilles(d: Dict, prefixe = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string") out.push([prefixe + k, v]);
    else if (v && typeof v === "object") out.push(...feuilles(v as Dict, `${prefixe}${k}.`));
  }
  return out;
}

describe("dictionnaires de frontend/i18n/", () => {
  const entrees = Object.entries(modules);

  it("il y en a, et chacun exporte D (deux langues) et T (accesseur)", () => {
    expect(entrees.length).toBeGreaterThan(0);
    for (const [f, m] of entrees) {
      expect(m.D, `${f} n'exporte pas D`).toBeDefined();
      expect(typeof m.T, `${f} n'exporte pas T`).toBe("function");
      expect(Object.keys(m.D!.en).sort(), `${f} : clés divergentes`).toEqual(Object.keys(m.D!.fr).sort());
    }
  });

  it("aucune valeur anglaise n'est restée en français", () => {
    const fautes: string[] = [];
    let vues = 0;
    for (const [f, m] of entrees) {
      for (const [cle, v] of feuilles(m.D!.en)) {
        vues++;
        if (EXCEPTIONS.has(v)) continue;
        if (DIACRITIQUES.test(v) || MOTS_FR.test(v)) fautes.push(`${f.replace("../frontend/i18n/", "")} ${cle} = ${JSON.stringify(v)}`);
      }
    }
    // Compte positif : une liste de fautes vide ne vaut rien si aucune feuille n'a été lue.
    expect(vues).toBeGreaterThan(0);
    expect(fautes).toEqual([]);
  });
});
