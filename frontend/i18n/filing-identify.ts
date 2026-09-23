// La carte Métadonnées de Revue (`filing-identify.ts`) : en-tête, bouton Identifier /
// Ré-identifier et son état de recherche, libellés des attributs éditables, bandeau « tags pas
// encore gravés », lien de rachat Beatport, et les toasts d'écriture des tags.
//
// `tagWarn` porte deux `<strong>` : balises statiques, aucune donnée interpolée. « Convertir » y est
// le libellé de l'action principale (`content.md` § Vocabulaire Canonique), donc « Convert ».
import { dict } from "../i18n";

const fr = {
  identify: "Identifier",
  reidentify: "Ré-identifier",
  identifyTitle: "Rechercher les métadonnées sur Discogs (pochette, label, année, genres)",
  searching: "Recherche…",
  applyFailed: "Impossible d'appliquer cette release — réessaie",
  openSettings: "Ouvrir Réglages",
  metadata: "Métadonnées",
  artist: "Artiste",
  title: "Titre",
  version: "Version",
  label: "Label",
  genres: "Genres",
  tagWarn:
    "Artiste et Titre pas encore gravés dans le fichier (seulement identifiés ci-dessus) — un CDJ ne peut pas les lire tant que ce n'est pas fait. <strong>Choisir un match</strong> ci-dessus, ou <strong>Convertir</strong>, pour les graver.",
  rebuyTitle: "Ce fichier est un faux — chercher une version authentique sur Beatport",
  rebuy: "Chercher sur Beatport",
  tagsWritten: "Tags gravés dans le fichier",
  tagsFailed: "Échec de l'écriture des tags",
};

const en: typeof fr = {
  identify: "Identify",
  reidentify: "Re-identify",
  identifyTitle: "Search Discogs for metadata (cover, label, year, genres)",
  searching: "Searching…",
  applyFailed: "Couldn't apply this release — try again",
  openSettings: "Open Settings",
  metadata: "Metadata",
  artist: "Artist",
  title: "Title",
  version: "Version",
  label: "Label",
  genres: "Genres",
  tagWarn:
    "Artist and Title aren't written to the file yet (only identified above) — a CDJ can't read them until they are. <strong>Choose a match</strong> above, or <strong>Convert</strong>, to write them.",
  rebuyTitle: "This file is a fake — search Beatport for a genuine version",
  rebuy: "Search Beatport",
  tagsWritten: "Tags written to the file",
  tagsFailed: "Couldn't write the tags",
};

export const D = { fr, en };
export const T = dict(D);
