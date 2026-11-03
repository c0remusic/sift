// Seconde ligne de la rangée de file (`.qi-sub`) — module PUR (aucun import `./ipc`, aucun DOM),
// même motif que `queue-verdict-dot.ts` : la story et un test env Node exécutent le vrai rendu.
// `queue-panel.ts` (queueRowHtml) reste l'unique appelant de prod.
//
// L'échec de CONVERSION vit ici depuis l'issue #86 (décision d'Antoine, 2026-11-03). Il était un
// troisième enfant `flex:none` de la rangée, au bord droit : à la largeur par défaut de la colonne,
// il comprimait le nom du fichier jusqu'à une lettre. Sur la seconde ligne, devant l'artiste, le
// titre garde toute sa largeur, la hauteur de rangée ne bouge pas (46 px, `queue-row-height.test.ts`)
// et le libellé reste lisible sans survol — la cause, elle, est en infobulle.
import { esc } from "./dom";
import { T } from "./i18n/queue-panel";

/** `artist` brut (échappé ici), `failureTitle` = la cause lisible de l'échec, ou `null` sans échec. */
export function queueSubHtml(artist: string, failureTitle: string | null): string {
  const a = artist ? esc(artist) : "";
  if (failureTitle == null) return `<div class="qi-sub">${a || "&nbsp;"}</div>`;
  return (
    `<div class="qi-sub">` +
    `<span class="qi-fail" title="${esc(failureTitle)}"><i class="ti ti-alert-triangle"></i> ${T().conversionFailed}</span>` +
    (a ? ` · ${a}` : "") +
    `</div>`
  );
}
