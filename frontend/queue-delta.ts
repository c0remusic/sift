// La file tenue en mémoire : lue une fois en entier, puis mise à jour par les seules lignes changées
// (#92). Sans DOM ni IPC, testable en env Node : `ipc.ts` y branche les deux commandes.

import type { QueueDelta, QueueItem } from "../shared/contracts";

/** La file après un delta, dans l'ordre de `list_queue` : par `id` croissant. */
export function appliquerDelta(file: QueueItem[], delta: QueueDelta): QueueItem[] {
  const parId = new Map(file.map((it) => [it.id, it]));
  for (const id of delta.removed) parId.delete(id);
  for (const it of delta.upserted) parId.set(it.id, it);
  return [...parId.values()].sort((a, b) => a.id - b.id);
}

/** Lecteur de file. Les appels passent un par un : le backend calcule chaque delta contre ce qu'il
 *  a livré juste avant, donc deux réponses appliquées dans le désordre perdraient une ligne. Après
 *  un échec, le lecteur ne sait plus ce que le backend croit livré : il relit tout. */
export function creerLecteurDeFile(
  lireTout: () => Promise<QueueItem[]>,
  lireDelta: () => Promise<QueueDelta>,
): () => Promise<QueueItem[]> {
  let tenue: QueueItem[] | null = null;
  let dernier: Promise<unknown> = Promise.resolve();

  async function lire(): Promise<QueueItem[]> {
    try {
      tenue = tenue ? appliquerDelta(tenue, await lireDelta()) : await lireTout();
      return tenue;
    } catch (e) {
      tenue = null;
      throw e;
    }
  }

  return () => {
    const r = dernier.then(lire, lire);
    dernier = r;
    return r;
  };
}
