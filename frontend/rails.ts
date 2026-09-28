// Rail lossless / lossy déduit de la SEULE extension — la copie frontend unique de la table Rust.
//
// Module feuille, ZÉRO import (même précédent que `popover-position.ts`) : c'est ce qui lui permet
// d'être lu par `filing.ts`, chaîné à `./ipc` et donc jamais chargeable en environnement Node,
// aussi bien que par `library-views.ts`, sans rapprocher deux modules qui n'ont rien à se dire.
//
// Recopie volontaire, et bornée, de `analysis::tags::rail_from_ext` (src-tauri/src/analysis/tags.rs ;
// cité par son nom, pas par ses lignes, qui ont bougé). Elle a divergé DEUX fois, toujours de la même façon — une table écrite de mémoire
// à côté d'une autre :
//   · la version qui vivait dans `filing.ts` ignorait `opus` ;
//   · `library-views.ts` portait sa PROPRE table (`LOSSLESS_EXT`) qui ignorait `aif`, si bien qu'un
//     `.aif` authentique lisait AUTHENTIQUE au lieu de LOSSLESS dans la colonne Verdict (constaté et
//     corrigé le 2026-08-20 en ramenant les deux ici).
// Toute correction ici doit d'abord être vérifiée là-bas — c'est le backend qui fait autorité.

/** Mêmes trois valeurs que `declared_rail` / `QueueItem.rail` dans `shared/contracts.ts`. */
export type Rail = "lossless" | "lossy" | "unknown";

const LOSSLESS_EXT = new Set(["flac", "wav", "aif", "aiff", "alac"]);
const LOSSY_EXT = new Set(["mp3", "aac", "m4a", "ogg", "opus"]);

/** Rail d'une EXTENSION nue (« aiff », « MP3 ») — la forme que porte `LibraryTrack.format`, écrite
 *  par Sift au rangement (`library.rs`, `target_format` → `Target::ext()`), donc sans point. */
function railFromExt(ext: string): Rail {
  const e = ext.toLowerCase();
  if (LOSSLESS_EXT.has(e)) return "lossless";
  if (LOSSY_EXT.has(e)) return "lossy";
  return "unknown";
}

/** Le débit sous lequel un fichier lossy est « trop bas pour le club » (issue #69, décision
 *  d'Antoine du 2026-09-28). Déclaré une seule fois : le verdict, le bandeau de Revue, la facette de
 *  la file et la proposition du mode Lot passent tous par `belowClubBitrate`. */
const CLUB_MIN_KBPS = 320;

/** Un fichier lossy dont le débit DÉCLARÉ est sous `CLUB_MIN_KBPS`. Axe SÉPARÉ du verdict : un MP3
 *  128 honnête reste VRAI, puisque Sift mesure l'authenticité, et « sous 320 » est une politique
 *  d'usage. Un débit inconnu ne déclenche rien (« non mesuré » n'est pas un grief), et un lossless
 *  n'est jamais visé, quel que soit son débit. */
export function belowClubBitrate(rail: string | null, kbps: number | null): boolean {
  return rail === "lossy" && kbps != null && kbps > 0 && kbps < CLUB_MIN_KBPS;
}

/** Revue propose-t-elle d'écarter cette piste parce qu'elle est sous 320 ? Pas pour un FAUX : son
 *  pied propose déjà « Re-sourcer », et le bandeau nommerait « Écarter », un bouton absent de
 *  l'écran (relecture de #69, 2026-09-28). Le débit reste teinté dans le verdict : c'est un fait. */
export function offerBelowClubSetAside(verdict: string | null, rail: string | null, kbps: number | null): boolean {
  return verdict !== "fake" && belowClubBitrate(rail, kbps);
}

/** Rail d'un CHEMIN — enveloppe `railFromExt` sur ce qui suit le dernier point. Un chemin sans
 *  point rend `unknown` par le même chemin qu'une extension inconnue. */
export function railFromExtension(path: string): Rail {
  return railFromExt(path.split(".").pop() || "");
}
