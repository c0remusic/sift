// La feuille de rangement du mode Lot (`batch-sheet.ts`) : en-tête de progression, étape en cours,
// puis le rapport final — compte traité / rangé / à vérifier, sections Rangées, À valider, Échecs.
// Le message d'échec d'une piste vient du backend et n'est pas écrit ici.
//
// Pluriels : le français accorde à partir de 2 (`n > 1`), l'anglais dès que n ≠ 1.
import { dict } from "../i18n";

const fr = {
  title: (n: number) => `Rangement de ${n} piste${n > 1 ? "s" : ""}`,
  stop: "Arrêter",
  showDetails: "Afficher les détails",
  step: (i: number, total: number) => `Conversion ${i} sur ${total}`,
  stepDone: (total: number) => `${total} sur ${total}`,
  processed: (n: number) => `${n} traitée${n > 1 ? "s" : ""}`,
  filed: (n: number) => `${n} rangée${n > 1 ? "s" : ""}`,
  toCheck: (n: number) => `${n} à vérifier`,
  sectionFiled: "Rangées",
  sectionToValidate: "À valider",
  sectionFailed: "Échecs",
  close: "Fermer",
  detail: "Détail",
};

const en: typeof fr = {
  title: (n) => `Filing ${n} track${n === 1 ? "" : "s"}`,
  stop: "Stop",
  showDetails: "Show details",
  step: (i, total) => `Converting ${i} of ${total}`,
  stepDone: (total) => `${total} of ${total}`,
  processed: (n) => `${n} processed`,
  filed: (n) => `${n} filed`,
  toCheck: (n) => `${n} to check`,
  sectionFiled: "Filed",
  sectionToValidate: "To validate",
  sectionFailed: "Failed",
  close: "Close",
  detail: "Details",
};

export const D = { fr, en };
export const T = dict(D);
