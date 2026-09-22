import { describe, expect, it } from "vitest";
import { MAX_ANALYSIS_ATTEMPTS, type QueueItem } from "../shared/contracts";
import { estRangeableEnLot, selectionSummaryHtml } from "../frontend/selection-summary";

// Le résumé de sélection est le seul endroit où l'utilisateur lit COMBIEN de pistes une action de
// lot va toucher. Il a menti jusqu'au 2026-09-16 : le bouton comptait `ok + grey`, l'action
// rangeait `verdict !== "fake"`. Ces tests gèlent l'accord entre les deux.

function piste(id: number, verdict: QueueItem["verdict"], analysis_attempts = 0): QueueItem {
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
    analysis_attempts,
    duration: null,
    bitrate: null,
    declared_fmt: null,
  };
}

/** Une piste dont le décodage a échoué autant de fois que le backend l'autorise : terminalement
 *  cassée, ce que `queue-verdict-dot.ts` peint en rouge « analyse abandonnée » sur sa ligne. */
function abandonnee(id: number): QueueItem {
  return piste(id, null, MAX_ANALYSIS_ATTEMPTS);
}

/** Le nombre que le bouton d'action principale affiche, lu dans le HTML rendu. `null` s'il
 *  est désactivé. Le VERBE est épinglé séparément ci-dessous : cette aide le consommait sans le
 *  garder, donc elle a suivi « Ranger » jusqu'au 2026-09-22 sans que rien ne tombe. */
function compteAffiche(html: string): number | null {
  if (/<button class="sift-baction sift-baction--primary" disabled>/.test(html)) return null;
  const m = html.match(/data-sift="batchqueuefile">Convertir (\d+) piste/);
  return m ? Number(m[1]) : null;
}

describe("le verbe d'action principale est celui que content.md déclare", () => {
  // `docs/design-system/content.md:27` : « Action principale | Convertir », et « Ranger » a
  // quitté ses « verbes préférés » le 2026-07-10. Le bouton d'UNE piste a suivi (`filing.ts`),
  // sept sites non — dont ce bouton primaire du mode Lot, et la modale de confirmation, qui
  // demandait « Ranger la sélection ? » tout en affichant « → Convertir » dans son propre récap.
  //
  // Pourquoi ce test n'existait pas : l'aide `compteAffiche` LISAIT déjà le libellé, sans le
  // garder. Un test qui CONSOMME une chaîne ne l'épingle pas — il la suit, et reste vert.
  //
  // Les deux bras comptent, l'actif et le désactivé : le libellé vit en double dans le markup.
  it("le bouton actif dit Convertir, jamais Ranger", () => {
    const html = selectionSummaryHtml([piste(1, "ok"), piste(2, "ok")]);
    expect(html).toContain(">Convertir 2 pistes</button>");
    expect(html).not.toMatch(/>Ranger/);
  });

  it("le bouton désactivé dit Convertir, jamais Ranger", () => {
    const html = selectionSummaryHtml([piste(1, "fake")]);
    expect(html).toContain(' disabled>Convertir</button>');
    expect(html).not.toMatch(/>Ranger/);
  });

  // « ranger » reste canonique comme ÉTAT (`content.md:28`, « État prêt | Prêt à ranger ») et
  // comme concept produit (« déplacer = encoder + ranger », CLAUDE.md). Ce test BORNE la règle au
  // verbe : il tomberait si quelqu'un élargissait la correction en interdiction du mot, ce qui
  // casserait l'état.
  it("seul le verbe est visé — l'identifiant partagé ne bouge pas", () => {
    expect(estRangeableEnLot(piste(1, "ok"))).toBe(true);
    expect(estRangeableEnLot(piste(2, "fake"))).toBe(false);
  });
});

describe("le compte du bouton d'action principale est celui de l'action", () => {
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

  // Le verdict nul recouvrait DEUX populations sous une seule pilule « en cours » : l'analyse en
  // attente et l'analyse abandonnée. La file les distingue depuis toujours — anneau neutre contre
  // pastille rouge titrée « analyse abandonnée » (`queue-verdict-dot.ts`). Scindé le 2026-09-16.
  it("une analyse abandonnée ne se compte pas comme une piste non analysée", () => {
    const html = selectionSummaryHtml([piste(1, null), abandonnee(2), abandonnee(3)]);
    expect(html).toContain("1 piste non analysée");
    expect(html).toContain("2 analyses abandonnées");
  });

  it("sans aucune abandonnée, la seconde pilule ne paraît pas", () => {
    const html = selectionSummaryHtml([piste(1, null), piste(2, null)]);
    expect(html).toContain("2 pistes non analysées");
    expect(html).not.toContain("abandonnée");
  });

  it("une abandonnée reste RANGEABLE — son verdict n'est pas « faux »", () => {
    const html = selectionSummaryHtml([abandonnee(1), abandonnee(2)]);
    expect(compteAffiche(html)).toBe(2);
    expect(html).toContain("2 analyses abandonnées");
  });

  it("une sélection sans aucun faux désactive Écarter, pas Ranger", () => {
    const html = selectionSummaryHtml([piste(1, null), piste(2, "ok")]);
    expect(compteAffiche(html)).toBe(2);
    expect(html).toContain('class="sift-baction sift-baction--quiet" disabled>Écarter</button>');
  });
});
