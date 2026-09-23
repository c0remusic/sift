// Le Journal (`journal.ts`) : libellés d'action et d'état de la table, en-têtes de colonnes, barre
// (segmenté de portée, recherche), états vides et d'erreur, inspecteur, annulation — confirmation,
// toasts, motifs d'échec — et menu contextuel.
//
// Vocabulaire : `docs/design-system/content.md` § Locale `en`. « Journal » y devient « Log », et
// « Annuler » une entrée se dit « Undo » : c'est un retour arrière sur une action faite, pas
// l'abandon d'une boîte de dialogue. « Écarté » suit « Écarter » → « Set aside », jamais
// « Discarded ».
//
// Les pluriels sont écrits par langue : le français met le singulier à 0 et 1 (`plural()` de
// `dom.ts`, que les gabarits d'origine appelaient), l'anglais seulement à 1.
import { dict } from "../i18n";

/** Accord français, à l'identique de `dom.ts::plural` : singulier à 0 et 1. */
const plFr = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
/** Accord anglais : singulier à 1 seulement (« 0 actions »). */
const plEn = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fr = {
  action: { filed: "Rangé", purged: "Purgé", setAside: "Écarté" },
  status: { pending: "Annulation…", reverted: "Annulé", failed: "Échec", applied: "Appliqué" },
  col: { time: "Heure", action: "Action", track: "Piste", dest: "Destination", state: "État" },
  unknownDate: "Date inconnue",
  /** Date courte d'une plage qui traverse des jours. */
  dayShort: (dd: string, mm: string) => `${dd}/${mm}`,
  actions: (n: number) => plFr(n, "action"),
  /** Suffixe de l'`aria-label` d'une ligne de lot — posé seulement au-delà d'un morceau. */
  batchCount: (n: number) => ` (${n} morceaux)`,
  noDest: "sans destination",
  readError: "Impossible de lire le journal. Vérifie la connexion à la base et réessaie.",
  retry: "Réessayer",
  emptyAll: {
    title: "Aucune action enregistrée",
    note: "L'historique complet des rangements, écarts et purges apparaîtra ici, prêt à être annulé.",
  },
  emptySession: {
    title: "Rien dans cette session",
    note: "Les actions de cette session apparaissent ici au fur et à mesure. L'historique complet reste accessible depuis la barre.",
  },
  /** `q` arrive déjà échappé du site. */
  noResult: (q: string) => `Aucune action ne correspond à « ${q} ».`,
  scopeAria: "Portée du journal",
  session: "Session",
  allHistory: "Tout l'historique",
  searchPlaceholder: "Rechercher…",
  searchAria: "Filtrer le journal par nom de fichier ou destination",
  failures: "Échecs",
  timeRange: "Plage horaire",
  currentSession: "Session courante",
  failNote: "Sélectionne une ligne en échec pour lire son motif.",
  timestamp: "Horodatage",
  batchTracks: "Morceaux du lot",
  outputFormat: "Format produit",
  source: "Source",
  revertOne: "Annuler cette action",
  tracksAffected: "Morceaux concernés",
  alreadyUndone: "Déjà annulées",
  selection: "Sélection",
  revertSelection: (n: number) => `Annuler la sélection (${n})`,
  revertError: {
    generic: "Annulation impossible — réessaie.",
    occupied: "Fichier déjà à l'emplacement d'origine — doublon probable (sync cloud ?).",
    gone: "Fichier introuvable à destination — déplacé ou supprimé manuellement ?",
    newer: "Action plus récente à annuler d'abord.",
  },
  confirmRevert: (actions: number, tracks: number) =>
    `Annuler ${plFr(actions, "action")} du journal (${plFr(tracks, "morceau", "morceaux")}) ?`,
  confirmRevertBtn: "Annuler ces actions",
  reverted: (n: number) => `${plFr(n, "action")} annulée${n > 1 ? "s" : ""}`,
  revertedPartial: (ok: number, failed: number) =>
    `${plFr(ok, "action")} annulée${ok > 1 ? "s" : ""}, ${failed} en échec`,
  noLocation: "Emplacement inconnu — cette entrée n'est plus liée à une piste en base.",
  openLocationError: "Impossible d'ouvrir l'emplacement",
  menu: {
    /** `suffix` : « (N) » quand plusieurs entrées sont annulables, sinon vide. */
    revert: (suffix: string) => `Annuler cette action${suffix}`,
    openLocation: "Ouvrir l'emplacement",
    copyPath: "Copier le chemin",
    pathCopied: "Chemin copié",
    showInLibrary: "Voir la piste dans Bibliothèque",
  },
};

const en: typeof fr = {
  action: { filed: "Filed", purged: "Purged", setAside: "Set aside" },
  status: { pending: "Undoing…", reverted: "Undone", failed: "Failed", applied: "Applied" },
  col: { time: "Time", action: "Action", track: "Track", dest: "Destination", state: "Status" },
  unknownDate: "Unknown date",
  dayShort: (dd, mm) => `${mm}/${dd}`,
  actions: (n) => plEn(n, "action"),
  batchCount: (n) => ` (${n} tracks)`,
  noDest: "no destination",
  readError: "Can't read the log. Check the database connection and try again.",
  retry: "Try again",
  emptyAll: {
    title: "No actions recorded",
    note: "The full history of filings, set-asides and purges will appear here, ready to undo.",
  },
  emptySession: {
    title: "Nothing in this session",
    note: "Actions from this session appear here as they happen. The full history stays available from the toolbar.",
  },
  noResult: (q) => `No action matches “${q}”.`,
  scopeAria: "Log scope",
  session: "Session",
  allHistory: "All history",
  searchPlaceholder: "Search…",
  searchAria: "Filter the log by file name or destination",
  failures: "Failures",
  timeRange: "Time range",
  currentSession: "Current session",
  failNote: "Select a failed row to read its reason.",
  timestamp: "Timestamp",
  batchTracks: "Tracks in batch",
  outputFormat: "Output format",
  source: "Source",
  revertOne: "Undo this action",
  tracksAffected: "Tracks affected",
  alreadyUndone: "Already undone",
  selection: "Selection",
  revertSelection: (n) => `Undo selection (${n})`,
  revertError: {
    generic: "Can't undo — try again.",
    occupied: "A file is already at the original location — likely a duplicate (cloud sync?).",
    gone: "File not found at the destination — moved or deleted by hand?",
    newer: "Undo the more recent action first.",
  },
  confirmRevert: (actions, tracks) =>
    `Undo ${plEn(actions, "action")} from the log (${plEn(tracks, "track")})?`,
  confirmRevertBtn: "Undo these actions",
  reverted: (n) => `${plEn(n, "action")} undone`,
  revertedPartial: (ok, failed) => `${plEn(ok, "action")} undone, ${failed} failed`,
  noLocation: "Unknown location — this entry is no longer linked to a track in the database.",
  openLocationError: "Couldn't open the location",
  menu: {
    revert: (suffix) => `Undo this action${suffix}`,
    openLocation: "Open location",
    copyPath: "Copy path",
    pathCopied: "Path copied",
    showInLibrary: "Show track in Library",
  },
};

export const D = { fr, en };
export const T = dict(D);
