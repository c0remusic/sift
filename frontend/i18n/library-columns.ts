// Colonnes de la table Rangés (`library-columns.ts`) : le libellé d'en-tête de chaque colonne,
// indexé par son champ. Lu à l'appel par `columnLabel()` — jamais recopié dans `DEFAULT_COLUMNS`,
// qui se construit au chargement du module et figerait la langue d'avant `initLang()`.
//
// Les clés de `cols` sont exactement les valeurs de `LibraryColumnField` : un champ ajouté sans son
// libellé casse `tsc` à l'indexation, dans `columnLabel`.
import { dict } from "../i18n";

const fr = {
  cols: {
    artist: "Artiste",
    title: "Titre",
    duration: "Durée",
    genre: "Genre",
    year: "Année",
  },
};

const en: typeof fr = {
  cols: {
    artist: "Artist",
    title: "Title",
    duration: "Duration",
    genre: "Genre",
    year: "Year",
  },
};

export const D = { fr, en };
export const T = dict(D);
