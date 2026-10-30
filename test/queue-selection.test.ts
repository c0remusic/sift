import { describe, expect, it } from "vitest";
import { clickedSelection } from "../frontend/queue-selection";

// Gate de cran 1 de la sélection du mode Lot (retour d'Antoine du 2026-10-30 : « difficile de les
// sélectionner, les cases cliquent mal »). Toute la ligne coche, Maj+clic coche une plage.
const order = [10, 20, 30, 40, 50];
const ids = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe("clickedSelection", () => {
  it("un clic simple bascule la piste et la prend pour ancre", () => {
    const a = clickedSelection(new Set(), { id: 30, range: false }, order, null);
    expect(ids(a.sel)).toEqual([30]);
    expect(a.anchor).toBe(30);
    const b = clickedSelection(a.sel, { id: 30, range: false }, order, a.anchor);
    expect(ids(b.sel)).toEqual([]);
  });

  it("Maj+clic coche la plage vers le bas, bornes comprises", () => {
    const r = clickedSelection(new Set([20]), { id: 40, range: true }, order, 20);
    expect(ids(r.sel)).toEqual([20, 30, 40]);
  });

  it("Maj+clic coche la plage vers le haut", () => {
    const r = clickedSelection(new Set([50]), { id: 20, range: true }, order, 50);
    expect(ids(r.sel)).toEqual([20, 30, 40, 50]);
  });

  it("la plage S'AJOUTE à la sélection et garde l'ancre", () => {
    const r = clickedSelection(new Set([10, 20]), { id: 40, range: true }, order, 20);
    expect(ids(r.sel)).toEqual([10, 20, 30, 40]);
    expect(r.anchor).toBe(20);
  });

  it("la plage suit l'ordre AFFICHÉ, pas les ids", () => {
    const affiche = [50, 10, 40, 20];
    const r = clickedSelection(new Set(), { id: 40, range: true }, affiche, 50);
    expect(ids(r.sel)).toEqual([10, 40, 50]);
  });

  it("sans ancre visible, Maj+clic bascule la seule piste", () => {
    expect(ids(clickedSelection(new Set(), { id: 30, range: true }, order, null).sel)).toEqual([30]);
    const r = clickedSelection(new Set(), { id: 30, range: true }, order, 99);
    expect(ids(r.sel)).toEqual([30]);
    expect(r.anchor).toBe(30);
  });

  it("ne modifie jamais la sélection reçue", () => {
    const sel = new Set([10]);
    clickedSelection(sel, { id: 30, range: true }, order, 10);
    clickedSelection(sel, { id: 10, range: false }, order, 10);
    expect(ids(sel)).toEqual([10]);
  });
});
