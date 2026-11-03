// Écran Doublons (`duplicates-view.ts`, spec `docs/ui-specs/doublons.md`, option B du 2026-10-30) :
// barre, file de groupes, grille de comparaison et rangée Issue, phrase de conséquence, pied, menu
// contextuel, mode Lot et son résumé, confirmation, feuille de progression, toasts, états vide et
// d'échec.
//
// Vocabulaire : `docs/design-system/content.md` § Locale `en`. Les verdicts suivent la table des
// verdicts (VRAI → GENUINE, FAUX → FAKE, À VÉRIFIER → TO CHECK). « Doublon » devient « duplicate » ;
// les noms de touches (SPACE, ENTER, BKSP, G, N) restent au site, comme dans Revue : ils n'ont pas
// de langue.
import { dict } from "../i18n";
import type { RekordboxDoubt } from "../../shared/contracts";

const plFr = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;
const plEn = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** « la copie 2 », « les copies 1 et 3 », « les copies 1, 2 et 4 ». */
const copiesFr = (ns: readonly number[]): string =>
  ns.length === 1 ? `la copie ${ns[0]}` : `les copies ${ns.slice(0, -1).join(", ")} et ${ns[ns.length - 1]}`;
const copiesEn = (ns: readonly number[]): string =>
  ns.length === 1 ? `copy ${ns[0]}` : `copies ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;

const fr = {
  groups: (n: number) => plFr(n, "groupe"),
  filterAll: "Tous",
  filterIdentical: "Identiques",
  filterSameSound: "Même son",
  filterSameName: "Même nom",
  filterToCheck: "À vérifier",
  filterRekordbox: "Avec Rekordbox",
  search: "Rechercher",
  listAria: "Groupes de doublons",
  gridAria: "Copies du groupe",
  select: "Sélectionner",
  selectDone: "Terminé",
  selected: (n: number) => (n > 1 ? `${n} sélectionnés` : `${n} sélectionné`),
  proofIdentical: "Identiques",
  proofSameSound: "Même son",
  proofSameName: "Même nom",
  proofPrint: (s: string) => `Même son · empreinte ${s}`,
  durationsDiffer: "durées différentes",
  verdictOk: "VRAI",
  verdictFake: "FAUX",
  verdictGrey: "À VÉRIFIER",
  copies: (n: number) => plFr(n, "copie"),
  artistCopies: (artist: string, n: number) => (artist ? `${artist} · ${plFr(n, "copie")}` : plFr(n, "copie")),
  playlists: (n: number) => plFr(n, "playlist"),
  differBy: (what: string) => `Différent par : ${what}`,
  differNothing: "Rien ne diffère, sinon l'emplacement",
  diffVerdict: "verdict",
  diffFormat: "format",
  diffBitrate: "débit",
  diffDuration: "durée",
  diffFolder: "emplacement",
  diffFile: "nom de fichier",
  // Tête de colonne.
  stateFiled: "Rangée",
  statePending: "En file",
  recommended: "Recommandée",
  whyShortLossless: "lossless",
  whyShortBitrate: "meilleur débit",
  whyShortRate: "meilleure fréquence",
  whyShortWhole: "entière",
  whyShortOldest: "la plus ancienne",
  whyShortRekordbox: "dans Rekordbox",
  // Rangées de la grille.
  rowVerdict: "Verdict",
  rowCutoff: "Coupure",
  rowFormat: "Format",
  rowDuration: "Durée",
  rowSize: "Taille",
  rowIdent: "Identification",
  rowRekordbox: "Rekordbox",
  rowIssue: "Issue",
  identified: (year: number | null) => (year ? `Discogs · ${year}` : "Discogs"),
  rekordboxUnverifiedShort: "non vérifiée",
  issueKept: "Gardée",
  issueTrash: "Corbeille",
  issueMissing: "Introuvable",
  issueTruncated: "Tronquée",
  // Phrase de conséquence et boutons du pied.
  consequence: (kept: readonly number[], trashed: readonly number[], size: string) =>
    `Entrée : garder ${copiesFr(kept)} — ${copiesFr(trashed)} ${trashed.length > 1 ? "partent" : "part"} à la Corbeille (${size}). Annulable.`,
  consequenceKeepAll: "Entrée : garder toutes les copies — rien ne part.",
  consequenceToCheck: (d: string) => `Durées écartées de ${d} — deux versions ? Entrée : ce ne sont pas des doublons.`,
  consequenceRekordbox: (list: readonly { n: number; playlists: number }[]) =>
    list.map((r) => `La copie ${r.n} est dans Rekordbox (${plFr(r.playlists, "playlist")})`).join(" ; ") +
    " : ces entrées perdront leur fichier. Sift n'écrit rien dans Rekordbox.",
  keepButton: (kept: readonly number[]) =>
    kept.length === 1 ? `Garder la copie ${kept[0]}` : `Garder les copies ${kept.slice(0, -1).join(", ")} et ${kept[kept.length - 1]}`,
  keepAllButton: "Garder toutes les copies",
  notDupsButton: "Pas des doublons",
  // Légende clavier.
  kbdListen: "écouter",
  kbdLeftRight: "GAUCHE/DROITE",
  kbdCopy: "copie",
  kbdToggle: "garder / corbeille",
  kbdKeep: "garder",
  kbdTrashNow: "corbeille",
  kbdNotDups: "pas des doublons",
  kbdUpDown: "HAUT/BAS",
  kbdGroup: "groupe",
  // Menu contextuel.
  keepOnly: "Garder seulement celle-ci",
  keepAlso: "Garder aussi",
  preferFolder: "Préférer ce dossier",
  preferred: (folder: string, n: number) => `Préféré : ${folder} — ${plFr(n, "groupe")} recoché${n > 1 ? "s" : ""}`,
  listen: "Écouter",
  reveal: "Ouvrir l'emplacement",
  revealFailed: "Impossible d'ouvrir l'emplacement",
  notDuplicates: "Ce ne sont pas des doublons",
  notDuplicatesFailed: "Le groupe n'a pas pu être mis de côté",
  // Mode Lot : le résumé.
  lotTitle: (n: number) => (n > 1 ? `${n} groupes sélectionnés` : `${n} groupe sélectionné`),
  lotTrash: "Copies à la Corbeille",
  lotTies: "Égalités tranchées par la règle",
  lotRekordbox: "Copies Rekordbox gardées d'office",
  lotExcluded: "Groupes exclus (À vérifier)",
  lotResolve: (n: number) => (n === 1 ? "Résoudre 1 groupe…" : `Résoudre ${n} groupes…`),
  lotEmpty: "Coche des groupes dans la file.",
  // États.
  emptyTitle: "Aucun doublon à trier",
  emptyNote: "Les groupes marqués « Ce ne sont pas des doublons » ne reviennent pas.",
  loadFailed: "Le calcul des groupes a échoué :",
  retry: "Réessayer",
  // Confirmation du Lot (spec § États).
  confirmUnverified: (n: number, reason: RekordboxDoubt) =>
    (reason === "rekordbox_open"
      ? "Rekordbox est ouvert : ses derniers imports ne sont pas lus. "
      : "Rekordbox n'est lu que dans son XML exporté : une piste importée depuis n'y figure pas. ") +
    (n > 1 ? `${n} copies envoyées n'ont pas pu être vérifiées` : "Une copie envoyée n'a pas pu être vérifiée") +
    (reason === "rekordbox_open" ? " — ferme Rekordbox et rouvre Doublons pour les vérifier." : "."),
  confirmTitle: (g: number) => (g === 1 ? "Résoudre 1 groupe ?" : `Résoudre ${g} groupes ?`),
  confirmRecap: (n: number, size: string) => `${plFr(n, "copie")} ${n > 1 ? "vont" : "va"} à la Corbeille (${size}).`,
  confirmNote: "Dans les égalités, la règle garde la copie recommandée. Un seul Ctrl+Z annule tout le lot.",
  keepRekordbox: (n: number) => `Garder aussi ${n > 1 ? `les ${n} copies` : "la copie"} que Rekordbox joue`,
  confirmButton: (g: number) => (g === 1 ? "Résoudre 1 groupe" : `Résoudre ${g} groupes`),
  // Application.
  sheetTitle: (n: number) => `Envoi de ${plFr(n, "copie")} à la corbeille`,
  sheetStep: (i: number, n: number, file: string) => `Copie ${i} sur ${n} · ${file}`,
  stop: "Arrêter",
  resolved: (n: number) => `Groupe résolu — ${plFr(n, "copie")} à la Corbeille`,
  lotDone: (g: number, n: number) => `${plFr(g, "groupe")} résolu${g > 1 ? "s" : ""} — ${plFr(n, "copie")} à la Corbeille`,
  trashedOne: "Copie envoyée à la Corbeille",
  partial: (n: number, failed: number) => `${plFr(n, "copie")} dans la corbeille, ${failed} en échec`,
  applyFailed: "L'envoi à la corbeille a échoué",
  undo: "Annuler",
  undoFailed: "L'annulation a échoué",
  reportFailed: (n: number) => (n > 1 ? `${n} copies n'ont pas pu partir` : "Une copie n'a pas pu partir"),
  close: "Fermer",
  // Tailles : séparateur décimal et unité ici, comme `usage-chart.ts::formatGo`.
  decimalSep: ",",
  unitMo: "Mo",
  unitKHz: "kHz",
  unitKbps: "kbps",
};

const en: typeof fr = {
  groups: (n: number) => plEn(n, "group"),
  filterAll: "All",
  filterIdentical: "Identical",
  filterSameSound: "Same sound",
  filterSameName: "Same name",
  filterToCheck: "To check",
  filterRekordbox: "With Rekordbox",
  search: "Search",
  listAria: "Duplicate groups",
  gridAria: "Copies in the group",
  select: "Select",
  selectDone: "Done",
  selected: (n: number) => `${n} selected`,
  proofIdentical: "Identical",
  proofSameSound: "Same sound",
  proofSameName: "Same name",
  proofPrint: (s: string) => `Same sound · fingerprint ${s}`,
  durationsDiffer: "different lengths",
  verdictOk: "GENUINE",
  verdictFake: "FAKE",
  verdictGrey: "TO CHECK",
  copies: (n: number) => plEn(n, "copy", "copies"),
  artistCopies: (artist: string, n: number) =>
    artist ? `${artist} · ${plEn(n, "copy", "copies")}` : plEn(n, "copy", "copies"),
  playlists: (n: number) => plEn(n, "playlist"),
  differBy: (what: string) => `Differs by: ${what}`,
  differNothing: "Nothing differs but the location",
  diffVerdict: "verdict",
  diffFormat: "format",
  diffBitrate: "bitrate",
  diffDuration: "length",
  diffFolder: "location",
  diffFile: "file name",
  stateFiled: "Filed",
  statePending: "In queue",
  recommended: "Recommended",
  whyShortLossless: "lossless",
  whyShortBitrate: "higher bitrate",
  whyShortRate: "higher sample rate",
  whyShortWhole: "complete",
  whyShortOldest: "the oldest",
  whyShortRekordbox: "in Rekordbox",
  rowVerdict: "Verdict",
  rowCutoff: "Cutoff",
  rowFormat: "Format",
  rowDuration: "Length",
  rowSize: "Size",
  rowIdent: "Identification",
  rowRekordbox: "Rekordbox",
  rowIssue: "Outcome",
  identified: (year: number | null) => (year ? `Discogs · ${year}` : "Discogs"),
  rekordboxUnverifiedShort: "not checked",
  issueKept: "Kept",
  issueTrash: "Trash",
  issueMissing: "Missing",
  issueTruncated: "Truncated",
  consequence: (kept: readonly number[], trashed: readonly number[], size: string) =>
    `Enter: keep ${copiesEn(kept)} — ${copiesEn(trashed)} ${trashed.length > 1 ? "go" : "goes"} to the Trash (${size}). Undoable.`,
  consequenceKeepAll: "Enter: keep every copy — nothing goes.",
  consequenceToCheck: (d: string) => `Lengths ${d} apart — two versions? Enter: these aren't duplicates.`,
  consequenceRekordbox: (list: readonly { n: number; playlists: number }[]) =>
    list.map((r) => `Copy ${r.n} is in Rekordbox (${plEn(r.playlists, "playlist")})`).join("; ") +
    ": those entries will lose their file. Sift writes nothing to Rekordbox.",
  keepButton: (kept: readonly number[]) =>
    kept.length === 1 ? `Keep copy ${kept[0]}` : `Keep copies ${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`,
  keepAllButton: "Keep every copy",
  notDupsButton: "Not duplicates",
  kbdListen: "listen",
  kbdLeftRight: "LEFT/RIGHT",
  kbdCopy: "copy",
  kbdToggle: "keep / trash",
  kbdKeep: "keep",
  kbdTrashNow: "trash",
  kbdNotDups: "not duplicates",
  kbdUpDown: "UP/DOWN",
  kbdGroup: "group",
  keepOnly: "Keep only this one",
  keepAlso: "Keep as well",
  preferFolder: "Prefer this folder",
  preferred: (folder: string, n: number) => `Preferred: ${folder} — ${plEn(n, "group")} rechecked`,
  listen: "Listen",
  reveal: "Show in folder",
  revealFailed: "Couldn't open the location",
  notDuplicates: "These aren't duplicates",
  notDuplicatesFailed: "The group couldn't be set aside",
  lotTitle: (n: number) => `${plEn(n, "group")} selected`,
  lotTrash: "Copies to the Trash",
  lotTies: "Ties settled by the rule",
  lotRekordbox: "Rekordbox copies kept anyway",
  lotExcluded: "Groups left out (To check)",
  lotResolve: (n: number) => (n === 1 ? "Resolve 1 group…" : `Resolve ${n} groups…`),
  lotEmpty: "Check groups in the queue.",
  emptyTitle: "No duplicates to sort",
  emptyNote: "Groups marked “These aren't duplicates” don't come back.",
  loadFailed: "Computing the groups failed:",
  retry: "Try again",
  confirmUnverified: (n: number, reason: RekordboxDoubt) =>
    (reason === "rekordbox_open"
      ? "Rekordbox is open: its latest imports aren't read. "
      : "Rekordbox is only read from its exported XML: a track imported since isn't in it. ") +
    (n > 1 ? `${n} copies being moved couldn't be checked` : "One copy being moved couldn't be checked") +
    (reason === "rekordbox_open" ? " — quit Rekordbox and reopen Duplicates to check them." : "."),
  confirmTitle: (g: number) => (g === 1 ? "Resolve 1 group?" : `Resolve ${g} groups?`),
  confirmRecap: (n: number, size: string) => `${plEn(n, "copy", "copies")} ${n === 1 ? "goes" : "go"} to the Trash (${size}).`,
  confirmNote: "On a tie, the rule keeps the recommended copy. A single Ctrl+Z undoes the whole batch.",
  keepRekordbox: (n: number) => `Also keep ${n > 1 ? `the ${n} copies` : "the copy"} Rekordbox plays`,
  confirmButton: (g: number) => (g === 1 ? "Resolve 1 group" : `Resolve ${g} groups`),
  sheetTitle: (n: number) => `Moving ${plEn(n, "copy", "copies")} to Trash`,
  sheetStep: (i: number, n: number, file: string) => `Copy ${i} of ${n} · ${file}`,
  stop: "Stop",
  resolved: (n: number) => `Group resolved — ${plEn(n, "copy", "copies")} to the Trash`,
  lotDone: (g: number, n: number) => `${plEn(g, "group")} resolved — ${plEn(n, "copy", "copies")} to the Trash`,
  trashedOne: "Copy moved to the Trash",
  partial: (n: number, failed: number) => `${plEn(n, "copy", "copies")} in the Trash, ${failed} failed`,
  applyFailed: "Moving to the Trash failed",
  undo: "Undo",
  undoFailed: "Undo failed",
  reportFailed: (n: number) => (n > 1 ? `${n} copies couldn't be moved` : "One copy couldn't be moved"),
  close: "Close",
  decimalSep: ".",
  unitMo: "MB",
  unitKHz: "kHz",
  unitKbps: "kbps",
};

export const D = { fr, en };
export const T = dict(D);
