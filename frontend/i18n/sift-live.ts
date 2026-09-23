// Le câblage live (`sift-live.ts`) : les toasts et confirmations des actions qu'il dispatche
// lui-même — export et liaison du XML Rekordbox, purge de la corbeille, doublons envoyés à la
// corbeille depuis Rangés, ouverture d'un emplacement, échec de scan d'un dossier surveillé.
//
// ⚠️ Le `includes("aucun XML")` de `runNavExport` n'est PAS ici : il reconnaît un message du
// backend, c'est un protocole (design.md § Le piège). Seul le texte AFFICHÉ quand il répond oui
// (`noXmlLinked`) se traduit.
import { dict } from "../i18n";

/** Pluriel anglais : 1 seul est singulier, 0 compris est pluriel (« 0 tracks »). */
const s = (n: number): string => (n === 1 ? "" : "s");

const fr = {
  exportDone: (tracks: number, playlists: number) =>
    `${tracks} pistes dans ${playlists} playlists Rekordbox — réimporte le XML dans Rekordbox pour resynchroniser.`,
  noXmlLinked: "Aucun XML Rekordbox lié — relie un fichier depuis l'écran Rekordbox",
  exportFailed: (msg: string) => `Export Rekordbox échoué : ${msg}`,
  searchCopied: "Recherche copiée",
  purgeConfirm: "Purger définitivement la corbeille ? Cette action est irréversible.",
  purgeConfirmBtn: "Purger",
  purgePartial: (purged: number, failed: number) => {
    const pl = failed > 1 ? "s" : "";
    return `${purged} supprimé${purged > 1 ? "s" : ""} — ${failed} fichier${pl} impossible${pl} à supprimer (ouvert dans un autre programme ?)`;
  },
  purgeFailed: "Échec : purge de la corbeille impossible",
  xmlLinked: (tracks: number, playlists: number) => `XML Rekordbox lié : ${tracks} pistes, ${playlists} playlists`,
  linkFailed: (err: string) => `Liaison du XML Rekordbox échouée : ${err}`,
  dupConfirm: (n: number) =>
    `Envoyer ${n} doublon${n > 1 ? "s" : ""} à la corbeille ? Le morceau recommandé est conservé.`,
  dupConfirmBtn: "Envoyer à la corbeille",
  dupNoneTrashed: "Aucun doublon n'a pu être envoyé à la corbeille",
  dupPartial: (done: number, failed: number) =>
    `${done} doublon${done > 1 ? "s" : ""} envoyé${done > 1 ? "s" : ""} à la corbeille, ${failed} en échec`,
  refreshFailed: "Échec : impossible de rafraîchir la liste",
  revealFailed: "Impossible d'ouvrir l'emplacement",
  scanFailed: (reason: string) => `Le scan du dossier surveillé a échoué : ${reason}`,
};

const en: typeof fr = {
  exportDone: (tracks, playlists) =>
    `${tracks} track${s(tracks)} in ${playlists} Rekordbox playlist${s(playlists)} — reimport the XML into Rekordbox to resync.`,
  noXmlLinked: "No Rekordbox XML linked — link a file from the Rekordbox screen",
  exportFailed: (msg) => `Rekordbox export failed: ${msg}`,
  searchCopied: "Search copied",
  purgeConfirm: "Permanently empty Trash? This can't be undone.",
  purgeConfirmBtn: "Empty trash",
  purgePartial: (purged, failed) =>
    `${purged} deleted — couldn't delete ${failed} file${s(failed)} (open in another program?)`,
  purgeFailed: "Failed: couldn't empty Trash",
  xmlLinked: (tracks, playlists) =>
    `Rekordbox XML linked: ${tracks} track${s(tracks)}, ${playlists} playlist${s(playlists)}`,
  linkFailed: (err) => `Couldn't link the Rekordbox XML: ${err}`,
  dupConfirm: (n) => `Move ${n} duplicate${s(n)} to Trash? The recommended track stays.`,
  dupConfirmBtn: "Move to Trash",
  dupNoneTrashed: "Couldn't move any duplicate to Trash",
  dupPartial: (done, failed) => `${done} duplicate${s(done)} moved to Trash, ${failed} failed`,
  refreshFailed: "Failed: couldn't refresh the list",
  revealFailed: "Couldn't open the location",
  scanFailed: (reason) => `Watched folder scan failed: ${reason}`,
};

export const D = { fr, en };
export const T = dict(D);
