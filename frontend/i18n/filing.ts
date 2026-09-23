// Le contrôleur de rangement de Revue (`filing.ts`) : réglages et pied de la boîte de lecture
// (Destination · Format · Nom final, Écarter / Re-source, Convertir), états vides du panneau,
// bandeau de doublon, puce de lecture incomplète et toasts de la file et de l'annulation.
//
// Vocabulaire : `docs/design-system/content.md` § Locale `en`. « Convertir » → « Convert »,
// « Écarter » → « Set aside » (jamais « Discard »), « Nom final » → « Final name ». Les pistes
// écartées atterrissent dans l'écran « À re-sourcer », « To re-source » en anglais.
//
// ⚠️ Les infobulles (`fmtNoUpscale`, `resourceTitle`, `setAsideTitle`) sont posées dans un attribut
// `title` non échappé : aucune valeur n'y porte de guillemet droit ni de chevron. La puce DUPLICATE
// n'est pas ici : c'est du jargon conservé, identique dans les deux langues.
import { dict } from "../i18n";

const fr = {
  choose: "Choisir…",
  convert: "Convertir",
  convertTitle: "Convertir (Entrée)",
  convertNeedsDest: "Choisis une destination avant de convertir",
  fmtNoUpscale: "Pas de surqualité depuis un fichier lossy",
  resource: "Re-source",
  resourceTitle: "Fichier faux — va dans À re-sourcer (⌫)",
  setAside: "Écarter",
  setAsideTitle: "Écarter — va dans À re-sourcer (⌫)",
  destination: "Destination",
  format: "Format",
  finalName: "Nom final",
  allSortedTitle: "Tout est trié",
  allSortedNote: (n: number) => `${n} morceau${n > 1 ? "x rangés" : " rangé"} cette session. Ta file est vide.`,
  viewLibrary: "Voir la Bibliothèque",
  nothingTitle: "Rien à revoir",
  nothingNote:
    "Les morceaux à traiter apparaissent ici dès qu'un dossier est surveillé — ou dépose des fichiers directement dans la file.",
  addWatchedFolder: "Ajouter un dossier à surveiller",
  clearPane: "Sélectionne un morceau dans la file pour l'écouter et le convertir.",
  dupFiled: (where: string) => `Déjà converti : ${where}`,
  dupPending: (name: string) => `Doublon d'un fichier en file : ${name}`,
  dupSure: "Doublon",
  dupMaybe: "Doublon possible (même nom — à vérifier)",
  queueReloadFailed: "La file n'a pas pu être relue — réessaie.",
  readIncomplete: "LECTURE INCOMPLÈTE",
  undone: "Action annulée",
};

const en: typeof fr = {
  choose: "Choose…",
  convert: "Convert",
  convertTitle: "Convert (Enter)",
  convertNeedsDest: "Choose a destination before converting",
  fmtNoUpscale: "No upscaling from a lossy file",
  resource: "Re-source",
  resourceTitle: "Fake file — goes to To re-source (⌫)",
  setAside: "Set aside",
  setAsideTitle: "Set aside — goes to To re-source (⌫)",
  destination: "Destination",
  format: "Format",
  finalName: "Final name",
  allSortedTitle: "All sorted",
  allSortedNote: (n) => `${n} track${n > 1 ? "s" : ""} filed this session. Your queue is empty.`,
  viewLibrary: "View the Library",
  nothingTitle: "Nothing to review",
  nothingNote:
    "Tracks to process show up here as soon as a folder is watched — or drop files straight into the queue.",
  addWatchedFolder: "Add a folder to watch",
  clearPane: "Select a track in the queue to listen to it and convert it.",
  dupFiled: (where) => `Already converted: ${where}`,
  dupPending: (name) => `Duplicate of a file in the queue: ${name}`,
  dupSure: "Duplicate",
  dupMaybe: "Possible duplicate (same name — check it)",
  queueReloadFailed: "Couldn't reload the queue — try again.",
  readIncomplete: "INCOMPLETE READ",
  undone: "Action undone",
};

export const D = { fr, en };
export const T = dict(D);
