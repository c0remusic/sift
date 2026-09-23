// Les actions de Revue (`filing-actions.ts`) : Convertir et ses refus, le bandeau de rangement
// (en cours / converti / échoué), l'écart vers À re-sourcer ou Écartés et son annulation.
//
// Les issues de l'annulation ciblée (« Annulé — retour dans la file », etc.) ne sont PAS ici : elles
// vivent dans `i18n/filing-toast.ts`, que `doRevert` partage avec l'annulation LIFO du toast.
//
// Les refus de Convertir sont choisis par des tests sur la chaîne d'erreur du backend
// (`NoLibraryRoot`, `ALREADY_FILING`, `upscale`, `spawn failed`, …) : ces littéraux restent dans le
// module source, seul le texte AFFICHÉ en résultat est ici.
//
// ⚠️ `inPlaceBin` est de l'anglais DANS la valeur française : c'est le texte d'origine du bandeau
// « Rangé » (`→ source folder`) quand la piste est convertie sur place, recopié octet pour octet.
// Le franciser (par exemple « dossier source », qu'emploie déjà le rail du mode Lot) est une
// décision de libellé, pas une traduction — même motif que `stopRequested` dans `batch-panel.ts`.
import { dict } from "../i18n";

const fr = {
  inPlaceBin: "source folder",
  chooseDestination: "Choisis un dossier de destination.",
  converting: "Conversion en cours…",
  railMismatch: (ext: string) =>
    `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
    `le convertir créerait un faux fichier lossless.\n\nConvertir quand même ?`,
  noLibraryRoot: "Conversion bloquée — aucune racine de bibliothèque.",
  chooseRoot: "Choisir la racine",
  alreadyFiling: "Ce morceau est déjà en cours de conversion.",
  upscaleRefused: "Refusé : pas de surqualité lossy → lossless.",
  ffmpegMissing:
    "FFmpeg est introuvable — Sift ne peut convertir aucun fichier tant qu'il manque. Réinstaller l'app le rétablit.",
  accessDenied: "Refusé : accès au fichier/dossier refusé.",
  fileNotFound: "Fichier introuvable — a-t-il été déplacé ?",
  convertFailed: "La conversion a échoué. Le détail exact est dans la console.",
  close: "Fermer",
  converted: "Converti",
  conversionFailed: "Conversion échouée",
  failedBackInQueue: (name: string) => `Conversion échouée — ${name} est revenu dans la file`,
  markedResource: "Marqué à re-sourcer",
  setAside: "Écarté",
  markResourceFailed: "Impossible de marquer à re-sourcer — réessaie",
  setAsideFailed: "Impossible d'écarter la piste — réessaie",
};

const en: typeof fr = {
  inPlaceBin: "source folder",
  chooseDestination: "Choose a destination folder.",
  converting: "Converting…",
  railMismatch: (ext) =>
    `This file is declared ${ext} but its real content is compressed (lossy) — ` +
    `converting it would create a fake lossless file.\n\nConvert anyway?`,
  noLibraryRoot: "Conversion blocked — no library root.",
  chooseRoot: "Choose the root",
  alreadyFiling: "This track is already converting.",
  upscaleRefused: "Refused: no lossy → lossless upscaling.",
  ffmpegMissing: "FFmpeg can't be found — Sift can't convert any file without it. Reinstall the app to bring it back.",
  accessDenied: "Refused: access to the file/folder denied.",
  fileNotFound: "File not found — was it moved?",
  convertFailed: "Conversion failed. The full error is in the console.",
  close: "Close",
  converted: "Converted",
  conversionFailed: "Conversion failed",
  failedBackInQueue: (name) => `Conversion failed — ${name} is back in the queue`,
  markedResource: "Marked to re-source",
  setAside: "Set aside",
  markResourceFailed: "Couldn't mark to re-source — try again",
  setAsideFailed: "Couldn't set the track aside — try again",
};

export const D = { fr, en };
export const T = dict(D);
