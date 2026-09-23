// Le toast partagé (`filing-toast.ts`) : libellé par défaut de son bouton d'action, issues de
// l'annulation LIFO (`undoLast`) et échec du presse-papier.
//
// Les issues d'annulation servent AUSSI l'annulation ciblée d'un rangement
// (`filing-actions.ts::doRevert`), qui dit la même chose dans les mêmes mots : un seul jeu de
// libellés, importé là-bas, plutôt que deux copies qui dériveraient.
import { dict } from "../i18n";

const fr = {
  undo: "Annuler",
  undone: "Annulé — retour dans la file",
  nothingToUndo: "Rien à annuler.",
  undoSourceGone:
    "Annulation impossible : un fichier nécessaire a disparu — l'original a peut-être été purgé de la corbeille.",
  undoFailed: "Échec de l'annulation — réessaie",
  copyFailed: "Copie impossible — le presse-papier a refusé",
};

const en: typeof fr = {
  undo: "Undo",
  undone: "Undone — back in the queue",
  nothingToUndo: "Nothing to undo.",
  undoSourceGone: "Can't undo: a required file is gone — the original may have been purged from Trash.",
  undoFailed: "Undo failed — try again",
  copyFailed: "Couldn't copy — the clipboard refused",
};

export const D = { fr, en };
export const T = dict(D);
