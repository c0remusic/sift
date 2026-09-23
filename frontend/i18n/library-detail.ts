// Fiche Métadonnées de Rangés (`library-detail.ts`), dans la zone D : titre de la fiche, bouton
// d'identification Discogs, libellés et noms accessibles des champs, filtre du sélecteur de
// pochette, et les toasts de gravure, d'identification et de changement de pochette.
//
// Vocabulaire : `docs/design-system/content.md` § Locale `en` — « Métadonnées » → Metadata,
// « Ouvrir Réglages » → Open Settings.
import { dict } from "../i18n";

const fr = {
  metadata: "Métadonnées",
  identifyTitle: "Rechercher les métadonnées sur Discogs (pochette, label, année, genres)",
  identify: "Identifier",
  reidentify: "Ré-identifier",
  artist: "Artiste",
  title: "Titre",
  label: "Label",
  year: "Année",
  genres: "Genres",
  genresAria: "Genres, séparés par une virgule",
  imageFilter: "Image",
  titleEmpty: "Le titre ne peut pas être vide.",
  coverChanged: "Pochette changée",
  coverFailed: "Impossible de changer la pochette — réessaie",
  searching: "Recherche…",
  openSettings: "Ouvrir Réglages",
  applyFailed: "Impossible d'appliquer cette release — réessaie",
  identified: "Identifié — métadonnées appliquées",
  yearOutOfRange: "Année hors limites (1900-2100).",
  saved: "Enregistré",
  undoFailed: "Annulation impossible — réessaie",
  saveFailed: "Échec de l'enregistrement — réessaie",
};

const en: typeof fr = {
  metadata: "Metadata",
  identifyTitle: "Search Discogs for metadata (cover, label, year, genres)",
  identify: "Identify",
  reidentify: "Re-identify",
  artist: "Artist",
  title: "Title",
  label: "Label",
  year: "Year",
  genres: "Genres",
  genresAria: "Genres, comma-separated",
  imageFilter: "Image",
  titleEmpty: "The title can't be empty.",
  coverChanged: "Cover changed",
  coverFailed: "Couldn't change the cover — try again",
  searching: "Searching…",
  openSettings: "Open Settings",
  applyFailed: "Couldn't apply this release — try again",
  identified: "Identified — metadata applied",
  yearOutOfRange: "Year out of range (1900-2100).",
  saved: "Saved",
  undoFailed: "Couldn't undo — try again",
  saveFailed: "Couldn't save — try again",
};

export const D = { fr, en };
export const T = dict(D);
