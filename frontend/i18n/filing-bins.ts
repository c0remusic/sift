// Le popover Destination de Revue (`filing-bins.ts`) : arbre de la bibliothèque, filtre de dossiers,
// groupe « Autres », case « Sur place », pied Nouveau dossier / Choisir un dossier, et les deux
// échecs qu'il affiche (lecture de l'arbre, enregistrement de la racine).
//
// ⚠️ `library`, `collapse` et `expand` sont de l'anglais DANS la valeur française : c'est le texte
// d'origine (nom de repli de la racine, infobulles du chevron), recopié octet pour octet. Les
// franciser est une décision de libellé, pas une traduction.
import { dict } from "../i18n";

const fr = {
  loadFailed: "L'arbre de destination n'a pas pu être lu.",
  saveRootFailed: "Échec d'enregistrement de la racine — réessaie",
  library: "Library",
  collapse: "Collapse",
  expand: "Expand",
  others: "Autres",
  retry: "Réessayer",
  filterPlaceholder: "Filtrer les dossiers…",
  noRoot:
    "Aucune racine de bibliothèque — cet arbre reste vide. Convertir sur place ou dans un autre dossier fonctionne sans elle.",
  chooseRoot: "Choisir la racine…",
  noMatch: "Aucun dossier correspondant.",
  emptyNote: "vide — crée un dossier",
  inPlace: "Sur place",
  inPlaceNote: "(dossier du fichier)",
  newFolder: "Nouveau dossier…",
  chooseFolder: "Choisir un dossier…",
  libraryGroup: "Bibliothèque",
};

const en: typeof fr = {
  loadFailed: "Couldn't read the destination tree.",
  saveRootFailed: "Couldn't save the root — try again",
  library: "Library",
  collapse: "Collapse",
  expand: "Expand",
  others: "Other",
  retry: "Try again",
  filterPlaceholder: "Filter folders…",
  noRoot:
    "No library root — this tree stays empty. Converting in place or into another folder works without one.",
  chooseRoot: "Choose the root…",
  noMatch: "No matching folder.",
  emptyNote: "empty — create a folder",
  inPlace: "In place",
  inPlaceNote: "(the file's folder)",
  newFolder: "New folder…",
  chooseFolder: "Choose a folder…",
  libraryGroup: "Library",
};

export const D = { fr, en };
export const T = dict(D);
