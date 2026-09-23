// Le rail du mode Lot (`batch-panel.ts`) : libellé de destination (« sur place », racine),
// sélecteurs de format, bouton Stop, et les notes écrites sous le rail — refus de lancement, bilan
// de fin de lot, échec d'écartement.
//
// ⚠️ `stopRequested` et `stop` sont de l'anglais DANS la valeur française : c'est le texte d'origine
// du rail, recopié octet pour octet. Le franciser est une décision de libellé, pas une traduction.
//
// Pluriels : le français accorde à partir de 2 (`n > 1`), l'anglais dès que n ≠ 1.
import { dict } from "../i18n";

const fr = {
  inPlace: "Dossier source de chaque morceau",
  libraryRoot: "Racine de bibliothèque",
  destination: "Destination",
  lossyOnly: "— seul format possible",
  stop: "Stop",
  stopRequested: "Stop requested — finishing the current file…",
  noRoot: "Conversion bloquée — aucune racine de bibliothèque.",
  chooseRoot: "Choisir la racine",
  launchFailed: "Échec du lancement de la conversion — réessaie",
  doneWithKo: (filed: number, ko: number) => `${filed} ${filed > 1 ? "rangées" : "rangée"} · ${ko} à vérifier`,
  doneAll: (filed: number) => `${filed} ${filed > 1 ? "pistes rangées" : "piste rangée"}`,
  interrupted: (base: string) => `Conversion interrompue · ${base}`,
  discardFailed: "Échec de l'écartement — réessaie",
};

const en: typeof fr = {
  inPlace: "Each track's source folder",
  libraryRoot: "Library root",
  destination: "Destination",
  lossyOnly: "— only possible format",
  stop: "Stop",
  stopRequested: "Stop requested — finishing the current file…",
  noRoot: "Conversion blocked — no library root.",
  chooseRoot: "Choose the root",
  launchFailed: "Couldn't start the conversion — try again",
  doneWithKo: (filed, ko) => `${filed} filed · ${ko} to check`,
  doneAll: (filed) => `${filed} track${filed === 1 ? "" : "s"} filed`,
  interrupted: (base) => `Conversion stopped · ${base}`,
  discardFailed: "Couldn't set the tracks aside — try again",
};

export const D = { fr, en };
export const T = dict(D);
