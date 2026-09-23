// Graphique d'occupation par format (`usage-chart.ts`), commun à Clé USB et à l'inspecteur de
// Rangés : l'unité de taille (`formatGo`, aussi appelée par `usb-view.ts` et `usb-row.ts`), les
// libellés accessibles des segments, l'infobulle, la légende « Libre », le dépliage du détail, ses
// groupes de formats, et les trois motifs d'un refus d'éjection (`humanizeEject`).
//
// ⚠️ PROTOCOLE — ne se traduit pas ici : `humanizeEject` reconnaît les sentinelles `EJECT_BUSY` et
// `DRIVE_VANISHED` de `shared/contracts.ts` dans le message brut du backend. Elles restent au site ;
// seules les phrases affichées en retour vivent dans ce dictionnaire.
//
// Le séparateur décimal et l'unité sont ici, pas dans un `Intl` : `formatGo` doit rendre en français
// exactement ce qu'il rendait (`1234,5 Go`, sans espace de groupement), et `Intl` en ajouterait une.
import { dict } from "../i18n";

/** Accord anglais : le singulier à 1 seulement, donc « 0 files ». */
const plEn = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const fr = {
  decimalSep: ",",
  unitGo: "Go",
  // Le compte de fichiers n'est pas accordé en français — « 1 fichiers » —, et ce dictionnaire
  // reproduit le texte d'origine tel quel.
  segAria: (ext: string, size: string, count: number, pct: string) =>
    `${ext}, ${size}, ${count} fichiers, ${pct} % du disque`,
  tipMeta: (count: number, pct: string) => `${count} fichiers · ${pct} %`,
  freeAria: (size: string) => `Libre, ${size}`,
  free: "Libre",
  showDetail: "Voir le détail complet",
  hideDetail: "Masquer le détail",
  groupLossless: "Audio sans perte",
  groupCompressed: "Audio compressé",
  groupRekordbox: "Données Rekordbox",
  groupOther: "Autres fichiers",
  ejectBusy:
    "Windows refuse de démonter ce disque : un programme le tient encore ouvert. " +
    "Ferme Rekordbox et les fenêtres de l'explorateur, puis réessaie. Rien n'a été démonté — " +
    "ne le débranche pas en l'état.",
  ejectGone: "Ce disque n'est déjà plus branché.",
  ejectFailed: "Éjection impossible.",
  noExtension: "(sans extension)",
};

const en: typeof fr = {
  decimalSep: ".",
  unitGo: "GB",
  segAria: (ext, size, count, pct) => `${ext}, ${size}, ${plEn(count, "file")}, ${pct}% of the disk`,
  tipMeta: (count, pct) => `${plEn(count, "file")} · ${pct}%`,
  freeAria: (size) => `Free, ${size}`,
  free: "Free",
  showDetail: "Show full details",
  hideDetail: "Hide details",
  groupLossless: "Lossless audio",
  groupCompressed: "Compressed audio",
  groupRekordbox: "Rekordbox data",
  groupOther: "Other files",
  ejectBusy:
    "Windows won't unmount this drive: a program still holds it open. " +
    "Close Rekordbox and any File Explorer windows, then try again. The drive is still mounted — " +
    "don't unplug it yet.",
  ejectGone: "This drive is already unplugged.",
  ejectFailed: "Eject failed.",
  noExtension: "(no extension)",
};

export const D = { fr, en };
export const T = dict(D);
