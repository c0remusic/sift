// Quelle piste ouvrir quand celle qu'on vient de traiter (convertie, écartée) quitte la file.
//
// Module SANS DOM, comme `queue-count-label.ts` : `filing-actions.ts` importe `./ipc`, qui ne se
// charge pas en env Node — la règle vit donc ici pour être gelée par Vitest
// (`test/queue-next.test.ts`).
//
// Le défaut corrigé (2026-10-30) : `doRanger` ouvrait `items[0]`, la PREMIÈRE piste en attente,
// quelle que soit la position de la piste traitée — « ça revient au tout début ». La règle est
// celle d'une liste du Finder quand on supprime l'élément sélectionné : la sélection passe à
// l'élément suivant, ou au précédent quand on était au bout.

/** Le prochain élément à ouvrir après `doneId`.
 *
 *  `order` : les ids dans l'ordre AFFICHÉ juste avant l'action (après filtre de source, recherche
 *  et facettes), pris avant que la piste traitée ne disparaisse de la liste. `live` : la file
 *  fraîche, déjà privée des conversions en cours.
 *
 *  Ordre de préférence : le premier id qui SUIVAIT `doneId` dans `order` et qui est encore dans
 *  `live` ; sinon le plus proche qui le PRÉCÉDAIT ; sinon `null` — la liste AFFICHÉE est épuisée,
 *  et ouvrir une piste hors du filtre (une autre source) laisserait la zone C sur une piste que la
 *  file ne montre pas. Le premier de `live` ne sert que si `doneId` n'était pas affiché du tout.
 *  Jamais `doneId` lui-même — une conversion échouée à l'instant le remet dans la file, et le
 *  rouvrir serait justement le « retour en arrière » qu'on corrige. */
export function pickNextAfter<T extends { id: number }>(
  order: readonly number[],
  doneId: number,
  live: readonly T[],
): T | null {
  // Les deux boucles partent d'un cran de part et d'autre de `doneId` : elles ne le revisitent
  // jamais, seul le repli final a besoin de l'écarter.
  const byId = new Map<number, T>(live.map((it) => [it.id, it]));
  const at = order.indexOf(doneId);
  if (at >= 0) {
    for (let i = at + 1; i < order.length; i++) {
      const it = byId.get(order[i]);
      if (it) return it;
    }
    for (let i = at - 1; i >= 0; i--) {
      const it = byId.get(order[i]);
      if (it) return it;
    }
    return null;
  }
  return live.find((it) => it.id !== doneId) ?? null;
}
