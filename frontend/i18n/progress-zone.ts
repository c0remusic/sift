// Zone de progression du rail (`progress-zone.ts`) : nom de chaque tâche de fond, libellé
// « Arrêt… » pendant une annulation, infobulle et nom accessible du bouton d'arrêt.
//
// Ces textes sont interpolés SANS `esc()` dans le markup d'une ligne, attributs compris
// (`aria-label`) : aucun ne doit porter de guillemet droit ni de chevron.
import { dict } from "../i18n";

const fr = {
  tasks: {
    analyze: "Analyse",
    identify: "Identification",
    file: "Conversion",
    export: "Export",
  },
  stopping: "Arrêt…",
  stopTitle: "Stop",
  stopAria: (task: string) => `Arrêter — ${task}`,
};

const en: typeof fr = {
  tasks: {
    analyze: "Analysis",
    identify: "Identification",
    file: "Conversion",
    export: "Export",
  },
  stopping: "Stopping…",
  stopTitle: "Stop",
  stopAria: (task) => `Stop — ${task}`,
};

export const D = { fr, en };
export const T = dict(D);
