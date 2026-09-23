// Rendu d'une ligne et d'une tuile de Rangés (`library-views.ts`) : l'en-tête de la colonne Format,
// le nom accessible du bouton de lecture, et les replis du nom accessible d'une ligne quand un champ
// manque. Les libellés des colonnes triables vivent avec leurs colonnes (`i18n/library-columns.ts`).
//
// Le tiret « — » d'une cellule vide n'est PAS ici : un signe typographique n'a pas de langue.
import { dict } from "../i18n";

const fr = {
  colFormat: "Format",
  play: "Écouter",
  unknownArtist: "Artiste inconnu",
  unknownTitle: "Titre inconnu",
  unknownGenre: "genre inconnu",
  unknownYear: "année inconnue",
};

const en: typeof fr = {
  colFormat: "Format",
  play: "Play",
  unknownArtist: "Unknown artist",
  unknownTitle: "Unknown title",
  unknownGenre: "unknown genre",
  unknownYear: "unknown year",
};

export const D = { fr, en };
export const T = dict(D);
