// La barre de menus macOS (`macos-menu.ts`, #58). Les intitulés reprennent ceux des apps d'Apple
// dans chaque langue (Finder, Safari) : c'est le système qui les dicte, pas Sift. `app` reçoit le
// nom de l'app, lu au lancement et non écrit ici.
import { dict } from "../i18n";

const fr = {
  about: (app: string) => `À propos de ${app}`,
  services: "Services",
  hide: (app: string) => `Masquer ${app}`,
  hideOthers: "Masquer les autres",
  quit: (app: string) => `Quitter ${app}`,
  file: "Fichier",
  closeWindow: "Fermer la fenêtre",
  edit: "Édition",
  undo: "Annuler",
  redo: "Rétablir",
  cut: "Couper",
  copy: "Copier",
  paste: "Coller",
  selectAll: "Tout sélectionner",
  view: "Présentation",
  fullscreen: "Passer en plein écran",
  window: "Fenêtre",
  minimize: "Placer dans le Dock",
  zoom: "Réduire/agrandir",
  help: "Aide",
};

const en: typeof fr = {
  about: (app) => `About ${app}`,
  services: "Services",
  hide: (app) => `Hide ${app}`,
  hideOthers: "Hide Others",
  quit: (app) => `Quit ${app}`,
  file: "File",
  closeWindow: "Close Window",
  edit: "Edit",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select All",
  view: "View",
  fullscreen: "Enter Full Screen",
  window: "Window",
  minimize: "Minimize",
  zoom: "Zoom",
  help: "Help",
};

export const D = { fr, en };
export const T = dict(D);
