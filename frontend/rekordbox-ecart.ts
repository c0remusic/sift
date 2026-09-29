// Les rangées de candidats de l'écran Rekordbox et l'écart d'une rangée Métadonnées — module pur,
// sans IPC, testable en env Node (modèle `rekordbox-plan.ts`). Sortis de `rekordbox-view.ts` pour
// #81 : la rangée dit désormais aussi ce que la synchro NE vide PAS, et un rendu que rien ne gèle
// se laisse dériver ; la story exécute ces fonctions au lieu d'en recopier le markup.
import type { PendingMetadataSync } from "../shared/contracts";
import { esc } from "./dom";
import { T } from "./i18n/rekordbox-view";

type EcartFields = Pick<
  PendingMetadataSync,
  "new_artist" | "new_title" | "new_genre" | "new_year" | "new_label" | "cleared"
>;

/** Les valeurs qui partent vers Rekordbox, dans l'ordre Artiste · Titre · Genre · Année · Label.
 *
 *  #81 : quand la release choisie a retiré du fichier un label, une année, un genre ou une
 *  pochette, la synchro ne les vide pas (encore) dans Rekordbox, qui garde les siens. La rangée le
 *  dit EN TÊTE : l'écart est une seule ligne tronquée à droite, et la fin serait coupée la
 *  première. Rendu HTML — chaque valeur passe par `esc`. */
export function metadataEcartHtml(r: EcartFields): string {
  const L = T();
  const parts: string[] = [];
  if (r.new_artist) parts.push(`${L.artist} ${esc(r.new_artist)}`);
  if (r.new_title) parts.push(`${L.title} ${esc(r.new_title)}`);
  if (r.new_genre) parts.push(`${L.genre} ${esc(r.new_genre)}`);
  if (r.new_year != null) parts.push(`${L.year} ${r.new_year}`);
  if (r.new_label) parts.push(`${L.label} ${esc(r.new_label)}`);
  const body = parts.join(" · ") || L.tags;
  if (!r.cleared.length) return body;
  const names = r.cleared.map((f) => L.clearedField[f]).join(", ");
  return `<span class="rkb-cand-cleared">${L.clearedNotice(names)}</span> · ${body}`;
}

/** Une rangée cochable. `pick` est le `data-sift` du toggle (mdbpick / mdspick / maspick /
 *  dedpick), `ref` l'attribut d'identité (`data-id` numérique, ou `data-key` pour un doublon). */
export function candidateRowHtml(
  pick: string,
  ref: string,
  checked: boolean,
  piste: string,
  ecart: string,
  error: string | undefined,
): string {
  return (
    `<div class="rkb-cand${checked ? " sel" : ""}" data-sift="${pick}" ${ref} tabindex="0" role="checkbox" aria-checked="${checked}">` +
    `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
    `<span class="rkb-cand-piste">${piste}</span>` +
    `<span class="rkb-cand-ecart">${ecart}</span>` +
    (error ? `<span class="rkb-cand-err">${esc(error)}</span>` : "") +
    `</div>`
  );
}
