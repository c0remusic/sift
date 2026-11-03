// Ce qu'une section de l'écran Rekordbox affiche — module PUR (aucun import `./ipc`, aucun DOM),
// même motif que `rekordbox-ecart.ts` : un test env Node exécute la vraie règle.
// `rekordbox-view.ts` (renderRekordboxLive) en est l'unique appelant.
//
// Issue #84 (2026-11-03). Une section n'était en erreur que si SON appel IPC tombait. Or quand
// `master.db` manque, les listes d'attente Fichiers, Métadonnées et Pochettes lisent la base de Sift
// et réussissent : elles rendaient `[]`, et la colonne B′ disait « 0 », c'est-à-dire « rien à
// faire », quand aucun détecteur ne pouvait rien détecter. La spec le demandait déjà
// (`docs/ui-specs/rekordbox.md` § États : « Aucune section n'est affichée comme vide »).
// Décision d'Antoine du même jour : des rangées d'avant la disparition de `master.db` restent
// MASQUÉES — elles ne pourraient pas s'appliquer, la section ne montre que le message.

/** `callFailed` : l'appel de la section a échoué ; `unavailable` : la synchronisation est
 *  indisponible pour tout l'écran (`syncUnavailable()`) ; `count` : rangées en attente reçues. */
export function sectionView(s: { callFailed: boolean; unavailable: boolean; count: number }): {
  error: boolean;
  count: string;
} {
  const error = s.callFailed || s.unavailable;
  return { error, count: error ? "—" : String(s.count) };
}
