// Les infobulles de la pastille de verdict de la ligne de file (`queue-verdict-dot.ts`) : les trois
// verdicts, l'analyse abandonnée et l'attente. La pastille ne porte aucun mot visible — ces textes
// sont son seul nom, au survol. Vocabulaire des verdicts : `docs/design-system/content.md`
// § Locale `en` (VRAI → GENUINE).
import { dict } from "../i18n";

const fr = {
  ok: "authentique",
  fake: "faux / sur-encodé",
  grey: "zone grise",
  abandoned: "analyse abandonnée",
  pending: "en attente d'analyse",
};

const en: typeof fr = {
  ok: "genuine",
  fake: "fake / transcoded",
  grey: "gray area",
  abandoned: "analysis abandoned",
  pending: "waiting for analysis",
};

export const D = { fr, en };
export const T = dict(D);
