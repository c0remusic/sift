import { describe, expect, it } from "vitest";
import { pickNextAfter } from "../frontend/queue-next";

// Gate de cran 1 du « passe au suivant » de Revue. Le défaut qu'elle tient : après Convertir ou
// Écarter, la file rouvrait sa PREMIÈRE piste (`items[0]`) au lieu de celle qui suivait la piste
// traitée — signalé par Antoine le 2026-10-30 (« revient au tout début »). Une régression ici est
// silencieuse : une piste s'ouvre quand même, juste pas la bonne.
const live = (...ids: number[]) => ids.map((id) => ({ id }));

describe("pickNextAfter", () => {
  it("ouvre la piste qui SUIVAIT la piste traitée, pas la première", () => {
    expect(pickNextAfter([1, 2, 3, 4], 2, live(1, 3, 4))?.id).toBe(3);
  });

  it("saute un voisin parti entre-temps (conversion en cours, autre action)", () => {
    expect(pickNextAfter([1, 2, 3, 4], 2, live(1, 4))?.id).toBe(4);
  });

  it("à la fin de la liste, ouvre celle qui la PRÉCÉDAIT", () => {
    expect(pickNextAfter([1, 2, 3], 3, live(1, 2))?.id).toBe(2);
  });

  it("ne rouvre jamais la piste traitée, même revenue dans la file (échec immédiat)", () => {
    expect(pickNextAfter([1, 2, 3], 2, live(1, 2, 3))?.id).toBe(3);
    expect(pickNextAfter([2], 2, live(2))).toBeNull();
  });

  it("suit l'ordre AFFICHÉ, pas celui de la file (filtre, recherche, facettes)", () => {
    // Liste visible filtrée 10, 30, 50 ; la file complète contient aussi 20 et 40.
    expect(pickNextAfter([10, 30, 50], 30, live(10, 20, 40, 50))?.id).toBe(50);
  });

  it("piste traitée absente de l'ordre affiché : première restante", () => {
    expect(pickNextAfter([5, 6], 9, live(5, 6))?.id).toBe(5);
    expect(pickNextAfter([], 9, live(7, 8))?.id).toBe(7);
  });

  it("plus rien d'affiché ne reste : première de la file, sinon rien", () => {
    expect(pickNextAfter([1, 2], 2, live(8, 9))?.id).toBe(8);
    expect(pickNextAfter([1, 2], 2, [])).toBeNull();
  });
});
