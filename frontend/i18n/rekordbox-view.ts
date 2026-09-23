// Écran Rekordbox (`rekordbox-view.ts`) : la tête et sa ligne de faits, les rangées « Fichier : »,
// « master.db : » et « En attente : », la colonne des sections, les groupes et rangées de candidats,
// la barre (« Synchroniser la sélection » · « Tout synchroniser »), la confirmation, l'état « en
// cours », le rapport de synchronisation, le menu contextuel et l'état vide.
//
// ⚠️ PROTOCOLE. `rekordbox-view.ts` reconnaît deux sentinelles du backend, `AMBIGUITY_STALE` et
// `AMBIGUITY_BAD_CHOICE` (`shared/contracts.ts`) ; leurs textes affichés vivent ici. Jusqu'au
// 2026-09-23 c'étaient deux phrases françaises reconnues par `includes`, qui auraient cessé de
// correspondre une fois traduites. Les autres messages du backend (`masterdb_error`, erreur par
// rangée) arrivent tels quels, traduits côté Rust.
//
// Vocabulaire : `docs/design-system/content.md` § Locale `en`. « Synchroniser » devient « Sync »,
// comme le manuel anglais (`docs/manuel.en.html` : « sync the selection », « sync everything »).
import { dict } from "../i18n";

/** Accord français de `dom.ts::plural` — le pluriel à partir de 2, donc « 0 piste ». */
const plFr = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;
/** Accord anglais : le singulier à 1 seulement, donc « 0 tracks ». */
const plEn = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const fr = {
  // Groupes — les quatre sections, en tête de groupe et dans la colonne.
  grpFiles: "Fichiers",
  grpMeta: "Métadonnées",
  grpArt: "Pochettes",
  grpPlaylists: "Playlists",
  // Rangées de candidats.
  toChoose: "à choisir",
  choose: (target: string) => `Choisir — ${target}`,
  groupAmbiguous: (n: number) => ` · ${n} à choisir`,
  pathFixed: "Chemin corrigé :",
  newArtwork: "Nouvelle pochette :",
  artist: "Artiste",
  title: "Titre",
  genre: "Genre",
  year: "Année",
  label: "Label",
  tags: "Tags",
  playlistN: (id: string) => `Playlist ${id}`,
  trackN: (id: string) => `Piste ${id}`,
  duplicatesToRemove: (n: number) => `${plFr(n, "doublon")} à retirer`,
  // Erreur de section.
  sectionUnavailable: (known: string) => `${known} — la synchronisation Rekordbox reste indisponible tant qu'il manque.`,
  sectionLoadFailed: "Impossible de charger — réessaie plus tard.",
  // Barre.
  syncSelection: "Synchroniser la sélection",
  syncAll: "Tout synchroniser",
  // Tête.
  xmlFallback: "XML Rekordbox",
  syncUnavailable: "synchronisation indisponible",
  sectionsNoReply: (n: number) => `${plFr(n, "section")} sans réponse`,
  pendingSync: (n: number) => `${n} en attente de synchronisation`,
  upToDate: "à jour",
  xmlUnreadable: "XML Rekordbox illisible — relie un fichier.",
  xmlLinked: (playlists: number, tracks: number, state: string) =>
    `XML Rekordbox lié · ${plFr(playlists, "playlist")} · ${plFr(tracks, "piste")} · ${state}`,
  statusUnavailable: "Statut Rekordbox indisponible.",
  // État vide.
  emptyTitle: "Aucun XML Rekordbox lié",
  emptyNote: "Relie le fichier XML exporté depuis Rekordbox pour commencer à synchroniser tes conversions.",
  emptyAction: "Lier un fichier XML Rekordbox",
  // Colonne des sections.
  sideAria: "Sections de synchronisation",
  sideHeader: "Synchroniser",
  sideAll: "Tout",
  // Rangées de faits.
  factFile: "Fichier :",
  reexportNow: "Réexporter maintenant",
  changeXml: "Changer de XML lié…",
  factMasterdb: "master.db :",
  readable: "Lisible",
  driftFailed:
    "Dérive : une correction de chemin a échoué — ferme Rekordbox, vérifie la piste, puis relie à nouveau le fichier XML pour confirmer.",
  driftNone: "Dérive : aucune",
  factPending: "En attente :",
  nothingPending: (all: boolean) => `Rien — ${all ? "le XML lié est à jour" : "cette section est à jour"}.`,
  // Menu contextuel et toasts.
  ignore: "Ignorer",
  actionFailed: "Action impossible — réessaie",
  choiceFailed: "Choix impossible — réessaie",
  /** Sentinelle `AMBIGUITY_STALE` du backend. Même texte que la phrase qu'elle remplace. */
  ambiguityStale: "cette ligne n'est plus ambiguë — rechargement nécessaire",
  /** Sentinelle `AMBIGUITY_BAD_CHOICE` du backend. Même texte que la phrase qu'elle remplace. */
  ambiguityBadChoice: "piste choisie invalide pour cette ambiguïté",
  // Synchronisation.
  confirmSync: (n: number) => `Synchroniser ${plFr(n, "entrée")} avec Rekordbox ? Ferme Rekordbox avant de continuer.`,
  confirmSyncButton: "Synchroniser",
  syncing: (n: number) => `Synchronisation de ${plFr(n, "entrée")}…`,
  unknownFailure: "échec inconnu",
  syncReportFailed: (ok: number, failed: number) =>
    `${plFr(ok, "entrée synchronisée", "entrées synchronisées")}, ${plFr(failed, "échouée")}`,
  syncReportOk: (ok: number) =>
    `${plFr(ok, "entrée synchronisée", "entrées synchronisées")} — réimporte le XML dans Rekordbox si tu as réexporté.`,
};

const en: typeof fr = {
  grpFiles: "Files",
  grpMeta: "Metadata",
  grpArt: "Covers",
  grpPlaylists: "Playlists",
  toChoose: "to choose",
  choose: (target) => `Choose — ${target}`,
  groupAmbiguous: (n) => ` · ${n} to choose`,
  pathFixed: "Corrected path:",
  newArtwork: "New cover:",
  artist: "Artist",
  title: "Title",
  genre: "Genre",
  year: "Year",
  label: "Label",
  tags: "Tags",
  playlistN: (id) => `Playlist ${id}`,
  trackN: (id) => `Track ${id}`,
  duplicatesToRemove: (n) => `${plEn(n, "duplicate")} to remove`,
  sectionUnavailable: (known) => `${known} — Rekordbox sync stays unavailable while master.db is missing.`,
  sectionLoadFailed: "Couldn't load — try again later.",
  syncSelection: "Sync selection",
  syncAll: "Sync all",
  xmlFallback: "Rekordbox XML",
  syncUnavailable: "sync unavailable",
  sectionsNoReply: (n) => `${plEn(n, "section")} not responding`,
  pendingSync: (n) => `${n} waiting to sync`,
  upToDate: "up to date",
  xmlUnreadable: "Rekordbox XML unreadable — link a file again.",
  xmlLinked: (playlists, tracks, state) =>
    `Rekordbox XML linked · ${plEn(playlists, "playlist")} · ${plEn(tracks, "track")} · ${state}`,
  statusUnavailable: "Rekordbox status unavailable.",
  emptyTitle: "No Rekordbox XML linked",
  emptyNote: "Link the XML file exported from Rekordbox to start syncing your conversions.",
  emptyAction: "Link a Rekordbox XML file",
  sideAria: "Sync sections",
  sideHeader: "Sync",
  sideAll: "All",
  factFile: "File:",
  reexportNow: "Re-export now",
  changeXml: "Change linked XML…",
  factMasterdb: "master.db:",
  readable: "Readable",
  driftFailed:
    "Drift: a path correction failed — close Rekordbox, check the track, then link the XML file again to confirm.",
  driftNone: "Drift: none",
  factPending: "Pending:",
  nothingPending: (all) => `Nothing — ${all ? "the linked XML is up to date" : "this section is up to date"}.`,
  ignore: "Ignore",
  actionFailed: "Action failed — try again",
  choiceFailed: "Choice failed — try again",
  ambiguityStale: "This row is no longer ambiguous — reload needed",
  ambiguityBadChoice: "The chosen track isn't one of this ambiguity's candidates",
  confirmSync: (n) => `Sync ${plEn(n, "entry", "entries")} with Rekordbox? Close Rekordbox before you continue.`,
  confirmSyncButton: "Sync",
  syncing: (n) => `Syncing ${plEn(n, "entry", "entries")}…`,
  unknownFailure: "unknown failure",
  syncReportFailed: (ok, failed) => `${plEn(ok, "entry", "entries")} synced, ${failed} failed`,
  syncReportOk: (ok) => `${plEn(ok, "entry", "entries")} synced — reimport the XML into Rekordbox if you re-exported.`,
};

export const D = { fr, en };
export const T = dict(D);
