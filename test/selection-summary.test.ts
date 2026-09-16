import { describe, expect, it } from "vitest";
import type { QueueItem } from "../shared/contracts";
import { estRangeableEnLot, selectionSummaryHtml } from "../frontend/selection-summary";

// Le résumé de sélection est le seul endroit où l'utilisateur lit COMBIEN de pistes une action de
// lot va toucher. Il a menti jusqu'au 2026-09-16 : le bouton comptait `ok + grey`, l'action
// rangeait `verdict !== "fake"`. Ces tests gèlent l'accord entre les deux.

function piste(id: number, verdict: QueueItem["verdict"]): QueueItem {
  return {
    id,
    path: `/musique/${id}.flac`,
    filename: `${id}.flac`,
    source_id: 1,
    verdict,
    rail: verdict === null ? null : "lossless",
    artist: null,
    title: null,
    dup: false,
    needs_analysis: verdict === null,
    analysis_attempts: 0,
    duration: null,
    bitrate: null,
    declared_fmt: null,
  };
}

/** Le nombre que le bouton Ranger affiche, lu dans le HTML rendu. `null` s'il est désactivé. */
function compteAffiche(html: string): number | null {
  if (/<button class="sift-baction sift-baction--primary" disabled>/.test(html)) return null;
  const m = html.match(/data-sift="batchqueuefile">Ranger (\d+) piste/);
  return m ? Number(m[1]) : null;
}

describe("le compte du bouton Ranger est celui de l'action", () => {
  // LE VECTEUR DE LA RÉGRESSION. Avec `ok + grey`, cette sélection donnait 0, donc un bouton
  // DÉSACTIVÉ — alors que `handleBatchQueueAction("file")` l'aurait rangée en entier, et que le
  // clic droit de la file proposait « Ranger 2 » sur la même sélection.
  it("une sélection de pistes NON ANALYSÉES reste rangeable", () => {
    const html = selectionSummaryHtml([piste(1, null), piste(2, null)]);
    expect(compteAffiche(html)).toBe(2);
  });

  it("le verdict nul compte avec ok et à vérifier, et seul « faux » en est retiré", () => {
    const sel = [piste(1, "ok"), piste(2, "grey"), piste(3, null), piste(4, "fake")];
    expect(compteAffiche(selectionSummaryHtml(sel))).toBe(3);
  });

  // L'invariant lui-même, indépendamment des populations choisies : ce que le bouton annonce est
  // exactement ce que le discriminant partagé retient. C'est lui qui tombe si un futur compte
  // recommence à énumérer les verdicts à la main.
  it("le compte affiché égale toujours le discriminant partagé", () => {
    const populations: QueueItem["verdict"][][] = [
      ["ok"],
      [null],
      ["fake"],
      ["ok", "fake"],
      [null, "fake", "grey"],
      ["ok", "ok", null, "grey", "fake", null],
    ];
    for (const verdicts of populations) {
      const sel = verdicts.map((v, i) => piste(i + 1, v));
      const attendu = sel.filter(estRangeableEnLot).length;
      expect(compteAffiche(selectionSummaryHtml(sel))).toBe(attendu === 0 ? null : attendu);
    }
  });

  // Le côté Écarter n'a jamais dérivé. Le geler ici empêche qu'une correction du côté Ranger le
  // casse par symétrie mal comprise : « faux » est le seul verdict qu'on écarte, et un verdict nul
  // n'est PAS un faux.
  it("Écarter ne compte que les faux, jamais un verdict nul", () => {
    const html = selectionSummaryHtml([piste(1, "fake"), piste(2, null), piste(3, "ok")]);
    expect(html).toContain('data-sift="batchqueuediscard">Écarter 1 faux');
  });

  it("une sélection sans aucun faux désactive Écarter, pas Ranger", () => {
    const html = selectionSummaryHtml([piste(1, null), piste(2, "ok")]);
    expect(compteAffiche(html)).toBe(2);
    expect(html).toContain('class="sift-baction sift-baction--quiet" disabled>Écarter</button>');
  });
});
