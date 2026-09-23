// Section « Sources » du rail (`rail-sources.ts`) : en-tête, message d'échec ou de liste vide,
// bouton d'ajout, menu contextuel d'une source (surveillance, rescan, couleur, retrait), ses
// toasts de succès et d'échec, et les noms des teintes affichés en infobulle des pastilles.
//
// Les noms de teinte sont indexés par les clés TECHNIQUES du cycle (`source-color.ts`), qui ne se
// traduisent pas : elles sont écrites en base (`set_source_color`) et dans les classes CSS.
import { dict } from "../i18n";

const fr = {
  addFailed: (name: string) => `« ${name} » n'a pas pu être ajouté.`,
  sources: "Sources",
  listUnavailable: "Liste indisponible",
  noSources: "Aucun dossier surveillé",
  addFolder: "Ajouter un dossier",
  pauseWatch: "Suspendre la surveillance",
  resumeWatch: "Reprendre la surveillance",
  watchPaused: "Surveillance suspendue",
  watchResumed: "Surveillance reprise",
  watchFailed: "Impossible de changer la surveillance",
  rescan: "Rescanner",
  rescanStarted: "Rescan lancé",
  rescanFailed: "Rescan impossible",
  color: "Couleur",
  colorFailed: "Impossible de changer la couleur",
  colorAuto: "Couleur automatique",
  colorAutoFailed: "Impossible de rétablir la couleur automatique",
  openLocation: "Ouvrir l'emplacement",
  unwatch: "Retirer de la surveillance",
  unwatchConfirm: (name: string) =>
    `Retirer « ${name} » des dossiers surveillés ? Les fichiers ne sont pas touchés.`,
  unwatchBtn: "Retirer",
  unwatched: "Dossier retiré",
  unwatchFailed: "Retrait impossible",
  hues: {
    indigo: "Indigo",
    purple: "Violet",
    pink: "Rose",
    teal: "Turquoise",
    yellow: "Jaune",
  },
};

const en: typeof fr = {
  addFailed: (name) => `Couldn't add “${name}”.`,
  sources: "Sources",
  listUnavailable: "List unavailable",
  noSources: "No watched folders",
  addFolder: "Add a folder",
  pauseWatch: "Pause watching",
  resumeWatch: "Resume watching",
  watchPaused: "Watching paused",
  watchResumed: "Watching resumed",
  watchFailed: "Couldn't change the watch state",
  rescan: "Rescan",
  rescanStarted: "Rescan started",
  rescanFailed: "Couldn't rescan",
  color: "Color",
  colorFailed: "Couldn't change the color",
  colorAuto: "Automatic color",
  colorAutoFailed: "Couldn't restore the automatic color",
  openLocation: "Open location",
  unwatch: "Remove from watched folders",
  unwatchConfirm: (name) => `Remove “${name}” from watched folders? Your files stay untouched.`,
  unwatchBtn: "Remove",
  unwatched: "Folder removed",
  unwatchFailed: "Couldn't remove the folder",
  hues: {
    indigo: "Indigo",
    purple: "Purple",
    pink: "Pink",
    teal: "Teal",
    yellow: "Yellow",
  },
};

export const D = { fr, en };
export const T = dict(D);
