// Le sidecar d'encodage manquant, reconnu partout où arrive l'échec d'une conversion. Sans DOM ni
// IPC, donc testable en env Node (`test/conversion-error.test.ts`).
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
// Le littéral testé vient de notre propre code (`encode.rs`, `EncodeError::Ffmpeg` : « spawn
// failed: <erreur d'E/S> »), pas d'un message système : c'est ce qui le rend stable. L'erreur d'E/S
// qui suit est traduite par Windows (« … introuvable »), d'où l'ordre qui comptait dans l'ancien
// `catch` : un test générique de fichier introuvable l'aurait attrapée d'abord et accusé le MORCEAU.
import { T } from "./i18n/filing-actions";

/** Le message à montrer quand la conversion a échoué faute de FFmpeg, sinon `null` : l'appelant
 *  garde alors son propre texte. */
export function ffmpegMissingText(raw: string): string | null {
  return raw.includes("spawn failed") ? T().ffmpegMissing : null;
}
