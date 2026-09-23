// La coquille de bureau (`chrome.ts`) : indications des zones de dépôt pendant un glisser, compte
// rendu d'un dépôt importé, boutons de fenêtre de la barre unifiée, bouton de repli du rail.
//
// Les indications de dépôt partent dans `data-dz` (lu par `content: attr(data-dz)` en CSS) : aucune
// ne doit porter de guillemet droit. La raison `blocked_by` d'un dépôt refusé vient du backend et
// s'affiche telle quelle — elle n'est pas ici.
import { dict } from "../i18n";

const fr = {
  dropDest: "Dépose un dossier ici — nouvelle destination",
  dropAudio: "Dépose des fichiers audio ici",
  dropWatch: "Dépose un dossier à surveiller",
  dropAny: "Dépose des fichiers (→ file d'attente) ou des dossiers (→ surveillés)",
  nothingImportable: "Rien d'importable dans ce dépôt",
  imported: (files: number, folders: number) => {
    const parts: string[] = [];
    if (files) parts.push(`${files} morceau${files > 1 ? "x" : ""}`);
    if (folders) parts.push(`${folders} dossier${folders > 1 ? "s" : ""}`);
    const plural = files + folders > 1 ? "s" : "";
    return `${parts.join(" et ")} ajouté${plural}`;
  },
  importFailed: "Échec de l'import",
  minimize: "Réduire",
  maximize: "Agrandir",
  restore: "Restaurer",
  close: "Fermer",
  railCollapse: "Replier le rail",
  railExpand: "Déplier le rail",
};

const en: typeof fr = {
  dropDest: "Drop a folder here — new destination",
  dropAudio: "Drop audio files here",
  dropWatch: "Drop a folder to watch",
  dropAny: "Drop files (→ queue) or folders (→ watched)",
  nothingImportable: "Nothing importable in this drop",
  imported: (files, folders) => {
    const parts: string[] = [];
    if (files) parts.push(`${files} track${files === 1 ? "" : "s"}`);
    if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
    return `${parts.join(" and ")} added`;
  },
  importFailed: "Import failed",
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  close: "Close",
  railCollapse: "Collapse the rail",
  railExpand: "Expand the rail",
};

export const D = { fr, en };
export const T = dict(D);
