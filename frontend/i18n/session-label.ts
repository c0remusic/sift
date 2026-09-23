// Le nom d'une session (`session-label.ts`) : « Hors session » et ses deux formes datées, celle
// d'un groupe de jour (l'heure seule) et celle d'une liste sans jour (date et heure).
//
// La date et l'heure se composent ICI, pas au site : l'ordre jour/mois (08/09 contre 09/08) et la
// notation de l'heure (« 01h24 » contre « 01:24 ») sont des faits de langue. Le site ne fournit
// que les composants, déjà complétés à deux chiffres.
import { dict } from "../i18n";

const fr = {
  noSession: "Hors session",
  atTime: (hh: string, mi: string) => `Session de ${hh}h${mi}`,
  withDate: (dd: string, mm: string, yyyy: number, hh: string, mi: string) =>
    `Session du ${dd}/${mm}/${yyyy} ${hh}h${mi}`,
};

const en: typeof fr = {
  noSession: "No session",
  atTime: (hh, mi) => `Session at ${hh}:${mi}`,
  withDate: (dd, mm, yyyy, hh, mi) => `Session on ${mm}/${dd}/${yyyy} at ${hh}:${mi}`,
};

export const D = { fr, en };
export const T = dict(D);
