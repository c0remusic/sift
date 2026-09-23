// La coquille d'`index.html` : rail, en-têtes de groupe, titre du document. Ces textes sont écrits
// en dur dans le HTML statique, qui s'affiche avant tout script ; `lang-boot.ts::applyShell` les
// remplace au démarrage en lisant les attributs `data-i18n` (texte) et `data-i18n-title` (infobulle).
//
// Les libellés du rail sont aussi les TITRES des écrans : `router.ts::syncNav` relit le `<span>`
// de l'entrée active pour le `<h1>` accessible et la barre unifiée. Les traduire ici suffit donc à
// traduire les deux. Vocabulaire : `docs/design-system/content.md` § Locale `en`.
import { dict } from "../i18n";

const fr = {
  docTitle: "Sift — prépa sons DJ",
  grpTraiter: "Traiter",
  grpBibliotheque: "Bibliothèque",
  grpExporter: "Exporter",
  revue: "Revue",
  journal: "Journal",
  journalTitle: "Journal des actions",
  ranges: "Rangés",
  rangesTitle: "Bibliothèque",
  resourcing: "À re-sourcer",
  resourcingTitle: "À re-sourcer — pistes fausses, tronquées ou douteuses",
  corbeille: "Corbeille",
  rekordbox: "Rekordbox",
  cle: "Clé USB",
  cleTitle: "Formater une clé USB",
  reglages: "Réglages",
  accueil: "Accueil",
  asideResize: "Redimensionner l'inspecteur",
};

const en: typeof fr = {
  docTitle: "Sift — DJ track prep",
  grpTraiter: "Process",
  grpBibliotheque: "Library",
  grpExporter: "Export",
  revue: "Review",
  journal: "Log",
  journalTitle: "Action log",
  ranges: "Filed",
  rangesTitle: "Library",
  resourcing: "To re-source",
  resourcingTitle: "To re-source — fake, truncated or doubtful tracks",
  corbeille: "Trash",
  rekordbox: "Rekordbox",
  cle: "USB drive",
  cleTitle: "Format a USB drive",
  reglages: "Settings",
  accueil: "Home",
  asideResize: "Resize the inspector",
};

export const D = { fr, en };
export const T = dict(D);
export type ShellKey = keyof typeof fr;
