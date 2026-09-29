// La vue agrandie du spectrogramme (`spectro-enlarge.ts`, #72) : titre, compte de la grille
// mesurée, états de calcul et d'échec, et le bouton « Agrandir » du Diagnostic qui l'ouvre.
//
// Le message d'échec vient du backend (`analyze_path`) : posé par `textContent`, jamais rendu.
import { dict } from "../i18n";

const fr = {
  agrandir: "Agrandir",
  agrandirTitre: "Voir le spectrogramme en grand, à la résolution de l'écran",
  titre: "Spectrogramme",
  mesures: (cols: number, bandes: number) => `${cols} × ${bandes} mesurés`,
  fermer: "Fermer",
  calcul: "Calcul du spectrogramme…",
  echec: "Le spectrogramme n'a pas pu être calculé.",
  reessayer: "Réessayer",
  aria: "Spectrogramme agrandi : temps en abscisse, fréquence en ordonnée",
};

const en: typeof fr = {
  agrandir: "Enlarge",
  agrandirTitre: "See the spectrogram large, at the screen's resolution",
  titre: "Spectrogram",
  mesures: (cols, bandes) => `${cols} × ${bandes} measured`,
  fermer: "Close",
  calcul: "Computing the spectrogram…",
  echec: "The spectrogram couldn't be computed.",
  reessayer: "Try again",
  aria: "Enlarged spectrogram: time across, frequency up",
};

export const D = { fr, en };
export const T = dict(D);
