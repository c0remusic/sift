// L'infobulle de la pastille de verdict de la file (`queue-verdict-dot.ts`), dans les deux langues.
//
// Ce que ces vecteurs tiennent : la table `VERDICT_DOT` s'évalue à l'IMPORT du module, avant que la
// langue soit tranchée au démarrage. Un libellé écrit dans la table en chaîne — et non en fonction
// lue au rendu — resterait français dans l'interface anglaise, sans erreur de compilation ni test
// rouge ailleurs. La langue est donc posée ici APRÈS l'import, exactement comme au démarrage.
import { afterEach, describe, expect, it } from "vitest";
import { verdictDot } from "../frontend/queue-verdict-dot";
import { setCurrentLang } from "../frontend/i18n";
import { MAX_ANALYSIS_ATTEMPTS } from "../shared/contracts";

function titre(html: string): string {
  const m = /title="([^"]*)"/.exec(html);
  if (!m) throw new Error(`pastille sans title : ${html}`);
  return m[1];
}

const CAS = [
  { verdict: "ok" as const, analysis_attempts: 1 },
  { verdict: "fake" as const, analysis_attempts: 1 },
  { verdict: "grey" as const, analysis_attempts: 1 },
  { verdict: null, analysis_attempts: MAX_ANALYSIS_ATTEMPTS },
  { verdict: null, analysis_attempts: 0 },
];

describe("verdictDot — infobulle", () => {
  afterEach(() => setCurrentLang("fr"));

  it("nomme les cinq cas en français par défaut", () => {
    expect(CAS.map((c) => titre(verdictDot(c)))).toEqual([
      "authentique",
      "faux / sur-encodé",
      "zone grise",
      "analyse abandonnée",
      "en attente d'analyse",
    ]);
  });

  it("les nomme en anglais quand la langue change après l'import", () => {
    setCurrentLang("en");
    expect(CAS.map((c) => titre(verdictDot(c)))).toEqual([
      "genuine",
      "fake / transcoded",
      "gray area",
      "analysis abandoned",
      "waiting for analysis",
    ]);
  });
});
