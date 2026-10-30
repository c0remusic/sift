// Les causes d'échec d'une conversion que l'utilisateur peut comprendre, reconnues partout où arrive
// l'échec. Sans DOM ni IPC, donc testable en env Node (`test/conversion-error.test.ts`).
//
// POURQUOI UN MODULE, 2026-09-23. La reconnaissance vivait dans le `catch` de `doRanger`
// (`filing-actions.ts`), où elle ne pouvait JAMAIS s'exécuter : `file_track` rend la main dès le
// plan posé, et l'encodage tourne sur un fil d'arrière-plan dont l'échec revient par l'événement
// `file:track:done`. L'utilisateur sans FFmpeg lisait « Conversion échouée — X est de retour dans la
// file », réessayait, relisait la même chose : une condition qui ne peut jamais aboutir, sans un mot
// de sa cause. Le lot montrait, lui, l'erreur Rust brute. L'échec arrive par TROIS portes :
//   - le toast de fin de conversion unitaire (`filing-actions.ts::settleFilingBanner`) ;
//   - l'infobulle du marqueur d'échec de la rangée de file (`queue-panel.ts`) ;
//   - la feuille de rapport du lot (`batch-sheet.ts`).
//
// Les littéraux testés viennent de notre propre code, pas d'un message système : c'est ce qui les
// rend stables. FFmpeg manquant : `encode.rs`, `EncodeError::Ffmpeg` (« spawn failed: <erreur
// d'E/S> ») — l'erreur d'E/S qui suit est traduite par Windows (« … introuvable »), d'où l'ordre
// qui comptait dans l'ancien `catch` : un test générique de fichier introuvable l'aurait attrapée
// d'abord et accusé le MORCEAU. Tags illisibles (2026-10-30) : `tagging.rs` préfixe ses échecs
// `lofty` de « read tags: » et « save tags: ».
import { T } from "./i18n/filing-actions";

/** FFmpeg manquant, sinon `null`. */
function ffmpegMissingText(raw: string): string | null {
  return raw.includes("spawn failed") ? T().ffmpegMissing : null;
}

/** Tags que même la lecture tolérante de `tagging.rs::read_tagged` ne lit pas, sinon `null`.
 *  Mesuré le 2026-10-30 : 11 fichiers sur 8 364 en attente chez Antoine (texte UTF-16 tronqué,
 *  UTF-8 invalide…). Sans ce texte, il lisait « est revenu dans la file » et réessayait en vain. */
function tagsUnreadableText(raw: string): string | null {
  return raw.includes("read tags:") || raw.includes("save tags:") ? T().tagsUnreadable : null;
}

/** La cause lisible d'un échec de conversion, sinon `null` : l'appelant garde alors son propre
 *  texte (et la chaîne brute part en infobulle ou en console). */
export function conversionFailureText(raw: string): string | null {
  return ffmpegMissingText(raw) ?? tagsUnreadableText(raw);
}
