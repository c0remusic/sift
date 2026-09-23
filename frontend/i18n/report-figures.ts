// Trois mesures du Diagnostic mises en forme sans DOM (`report-figures.ts`) : la référence des deux
// densités spectrales (« dans / sous la plage des masters ») et la durée décodée quand elle diverge
// de l'en-tête.
//
// Une densité se dit comme un FAIT, jamais comme un verdict : l'anglais garde cette retenue
// (« within / below », pas « suspicious »). Les bornes arrivent déjà mises en forme par l'appelant.
import { dict } from "../i18n";

const fr = {
  refRange: (inside: boolean, lo: string, hi: string) =>
    `${inside ? "dans" : "sous"} la plage des masters (${lo} à ${hi})`,
  decodedShortfall: (decoded: string, declared: string) => `${decoded} s sur ${declared} s annoncées`,
};

const en: typeof fr = {
  refRange: (inside, lo, hi) => `${inside ? "within" : "below"} the master range (${lo} to ${hi})`,
  decodedShortfall: (decoded, declared) => `${decoded} s of ${declared} s declared`,
};

export const D = { fr, en };
export const T = dict(D);
