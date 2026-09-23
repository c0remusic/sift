// Le compte de la file dans la barre unifiée de Revue (`queue-count-label.ts`) : total de la file,
// pistes laissées visibles par un filtre, sélection du mode Lot. Les trois gabarits accordent leur
// nom au nombre — en français 0 et 1 au singulier, en anglais seul 1 l'est (« 0 tracks »).
import { dict } from "../i18n";

const fr = {
  selected: (n: number) => `${n} sélectionnée${n > 1 ? "s" : ""}`,
  filtered: (n: number) => `${n} piste${n > 1 ? "s" : ""} filtrée${n > 1 ? "s" : ""}`,
  total: (n: number) => `${n} piste${n > 1 ? "s" : ""}`,
};

const en: typeof fr = {
  selected: (n) => `${n} selected`,
  filtered: (n) => `${n} filtered track${n === 1 ? "" : "s"}`,
  total: (n) => `${n} track${n === 1 ? "" : "s"}`,
};

export const D = { fr, en };
export const T = dict(D);
