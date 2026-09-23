// Une écriture à la fois, et jamais une demande perdue. Sans DOM ni IPC, donc testable en env Node
// (`test/coalesce-latest.test.ts`).
//
// POURQUOI, 2026-09-23. La gravure des tags de Revue (`filing-identify.ts::doApplyTags`) se gardait
// du double déclenchement (l'Entrée appelle `blur()`, donc deux appels) par un simple
// `if (enCours) return`. Cette garde jetait AUSSI la demande légitime qui arrivait pendant une
// écriture : taper l'artiste, Tab (le blur lance l'écriture), taper le titre, Tab avant la fin — le
// titre n'était jamais gravé, alors que le toast « Tags gravés » s'affichait pour la première.
// L'écriture est lente exprès (réécriture lofty du fichier, déchiffrement de `master.db` si
// Rekordbox est lié), donc la fenêtre n'était pas théorique.

/** Enveloppe `run` pour qu'une seule exécution soit en vol. Une demande faite pendant ce temps n'est
 *  pas jetée : la plus RÉCENTE est gardée (elle écrase les précédentes) et rejouée dès la fin. `same`
 *  évite de rejouer une valeur identique à celle qui vient de partir — c'est ce qui absorbe le double
 *  déclenchement.
 *
 *  `run` porte ses propres erreurs (toast, journal) : s'il lève quand même, l'exception remonte à
 *  l'appelant qui l'a lancé et la demande en attente est abandonnée — jamais avalée en silence. */
export function coalesceLatest<T>(
  run: (v: T) => Promise<void>,
  same: (a: T, b: T) => boolean,
): (v: T) => Promise<void> {
  let running = false;
  let pending: { v: T } | null = null;
  return async (v: T): Promise<void> => {
    if (running) {
      pending = { v };
      return;
    }
    running = true;
    try {
      let cur = v;
      for (;;) {
        await run(cur);
        const next: { v: T } | null = pending;
        pending = null;
        if (!next || same(next.v, cur)) break;
        cur = next.v;
      }
    } finally {
      running = false;
      pending = null;
    }
  };
}
