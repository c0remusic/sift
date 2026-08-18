// Mise en forme des deux mesures spectrales du Diagnostic, sans DOM.
//
// Module séparé de `report-view.ts` pour une raison de test, pas d'esthétique — même motif que
// `popover-position.ts` : `report-view.ts` importe `./ipc`, `@tauri-apps/api/core` et
// `wavesurfer.js` au niveau module, et la suite Vitest tourne en environnement Node sans Tauri
// (voir `vitest.config.ts`). Ici il n'y a que des nombres et des chaînes, donc la logique qui
// décide CE QUI EST DIT à l'utilisateur est couverte par un test — alors qu'elle porte
// précisément le risque : une mesure mal formulée devient un jugement.

/** Bornes des masters authentiques mesurés, en dB de platitude spectrale 16–20 kHz.
 *
 *  Ce ne sont PAS des seuils : rien ne branche dessus, aucun verdict ne les lit. Elles s'affichent
 *  à côté de la valeur pour que le lecteur situe ce qu'il voit — une mesure sans échelle ne dit
 *  rien à personne.
 *
 *  Et surtout : **pas de jauge à trois crans**, qui mentirait. La marge entre le plus bas
 *  authentique et le suivant est de **0,12 dB** (corpus étiqueté, voir
 *  `docs/superpowers/changes/2026-08-17-detecteur-corpus/review.md`). Un fichier juste sous la
 *  borne n'est pas « suspect » : il est juste sous la borne, et c'est tout ce qu'on peut en dire.
 *
 *  20 fichiers de deux provenances, une seule famille musicale. Ces bornes bougeront. */
export const HF_REF_LO = -5.4;
export const HF_REF_HI = -2.6;

/** Écart au-delà duquel la durée décodée s'affiche à côté de la durée déclarée, en secondes.
 *
 *  Un décodeur rend rarement EXACTEMENT ce que l'en-tête annonce — bourrage d'encodeur, arrondi de
 *  trame. Afficher les deux systématiquement noierait le seul cas qui informe sous du bruit
 *  permanent. Une seconde est très au-delà de ces écarts, tout en attrapant le cas réel : un
 *  fichier tronqué dont l'en-tête annonce encore la durée complète.
 *
 *  ⚠️ Choisie par raisonnement, **pas calibrée sur un corpus**, contrairement à `HF_REF_LO`. Le
 *  seul point mesuré est que les fichiers produits par ffmpeg rendent des durées identiques au
 *  centième. */
export const DURATION_MISMATCH_SEC = 1.0;

/** La densité de l'aigu telle qu'elle s'affiche : la mesure, puis sa référence.
 *
 *  Formulée comme un FAIT sur le fichier, jamais comme un verdict. « Ça a été du lossy » ne se
 *  déduit pas de cette mesure — un master volontairement sombre donne la même valeur. Le mot
 *  « densité » décrit ce qui est mesuré (à quel point la bande haute est remplie) là où
 *  « platitude » est du jargon et « clairsemé » est déjà un jugement. */
export function hfDensityText(db: number, fmt: (v: number, d: number) => string): string {
  const situe = db >= HF_REF_LO ? "dans" : "sous";
  return `${fmt(db, 1)} dB — ${situe} la plage des masters mesurés (${fmt(HF_REF_LO, 1)} à ${fmt(HF_REF_HI, 1)})`;
}

/** La durée : celle de l'en-tête, et celle réellement décodée QUAND ELLES DIVERGENT.
 *
 *  Le désaccord est l'information ; l'accord n'en est pas une. C'est aussi la seule mesure que
 *  Fakin' The Funk fait et que Sift ne faisait pas — sa classe CORROMPU en sort.
 *
 *  `decodedSec <= 0` = pas mesuré (rapport antérieur à la mise en place, `#[serde(default)]` côté
 *  Rust) : on n'affiche alors que la durée déclarée, jamais « 0 s réellement décodée ». */
export function durationText(
  declaredSec: number,
  decodedSec: number,
  fmt: (v: number, d: number) => string,
): string {
  const declared = `${fmt(declaredSec, 1)} s`;
  if (!(decodedSec > 0) || Math.abs(declaredSec - decodedSec) <= DURATION_MISMATCH_SEC) {
    return declared;
  }
  return `${declared} annoncée — ${fmt(decodedSec, 1)} s réellement décodée`;
}
