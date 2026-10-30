// Ce que devient la sélection du mode Lot après un clic sur une ligne de la file.
//
// Module SANS DOM, comme `queue-next.ts` : `queue-panel.ts` importe `./ipc`, qui ne se charge pas
// en env Node — la règle vit donc ici, gelée par `test/queue-selection.test.ts`.
//
// Le défaut corrigé (2026-10-30, Antoine) : en mode Lot, seule la case de 16 px cochait ; un clic
// « un peu à côté » ouvrait la piste, faisait sortir du mode et VIDAIT la sélection. Désormais toute
// la ligne coche, comme une liste de Photos ou de Finder en mode sélection, et Maj+clic coche une
// plage — le geste qui manquait pour viser cinq pistes d'affilée.

type BatchClick = {
  /** La piste cliquée (case ou ligne entière). */
  id: number;
  /** Maj enfoncée : coche la plage depuis l'ancre au lieu de basculer la seule piste. */
  range: boolean;
};

/** La sélection après `click`, et la nouvelle ancre.
 *
 *  Clic simple : bascule la piste, qui devient l'ancre. Maj+clic : coche toute la plage, dans
 *  l'ordre AFFICHÉ (`order`, après filtre et recherche), entre l'ancre et la piste cliquée — la
 *  plage s'AJOUTE, comme Maj+clic dans une liste du Finder, et l'ancre ne bouge pas, pour qu'un
 *  second Maj+clic redimensionne depuis le même point. Sans ancre visible (jamais posée, ou
 *  filtrée depuis), Maj+clic se comporte comme un clic simple.
 *
 *  La plage ne coche que les pistes `eligible` (celles qui ont un verdict) : même règle que
 *  « Tout » et l'entrée dans le mode — sinon un Maj+clic sur vingt lignes embarquait des pistes
 *  en cours d'analyse. Un clic simple, lui, coche ce qu'on vise, une ligne à la fois. */
export function clickedSelection(
  sel: ReadonlySet<number>,
  click: BatchClick,
  order: readonly number[],
  anchor: number | null,
  eligible: ReadonlySet<number>,
): { sel: Set<number>; anchor: number | null } {
  const next = new Set(sel);
  const from = anchor == null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(click.id);
  if (click.range && from >= 0 && to >= 0) {
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (eligible.has(order[i])) next.add(order[i]);
    }
    return { sel: next, anchor };
  }
  if (next.has(click.id)) next.delete(click.id);
  else next.add(click.id);
  return { sel: next, anchor: click.id };
}
