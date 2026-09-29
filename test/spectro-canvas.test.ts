// #72 : les graduations des axes de la vue agrandie. Une graduation fausse ment sur la mesure :
// « 16 kHz » posé à la hauteur de 18 kHz ferait lire une coupure au mauvais endroit.
import { describe, expect, it } from "vitest";
import { axisTicks, cellOf, gridSeconds } from "../frontend/spectro-canvas";

describe("cellOf — la cellule de grille sous un pixel", () => {
  it("à la taille de la grille, un pixel par cellule, pour TOUTES les tailles de la vue agrandie", () => {
    // Relecture de #72 : en flottant, (x / n) × n rend parfois x − 1. 55 colonnes sur 1 200 étaient
    // peintes avec la donnée de leur voisine, et autant de colonnes mesurées n'étaient jamais peintes.
    for (let n = 1; n <= 4096; n++) {
      for (let i = 0; i < n; i++) {
        if (cellOf(i, n, n) !== i) throw new Error(`n=${n} : pixel ${i} → cellule ${cellOf(i, n, n)}`);
      }
    }
  });

  it("réduit et agrandit sans sortir de la grille", () => {
    expect([0, 1, 2, 3].map((i) => cellOf(i, 4, 8))).toEqual([0, 2, 4, 6]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => cellOf(i, 8, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(cellOf(-3, 10, 5)).toBe(0);
    expect(cellOf(99, 10, 5)).toBe(4);
  });
});

describe("gridSeconds — la durée que la grille couvre", () => {
  it("se lit sur la grille, pas sur l'en-tête", () => {
    // Un fichier tronqué : l'en-tête dit 6 min, la grille couvre 40 s.
    expect(gridSeconds({ frames: 430, bins: 1, hz_per_bin: 1, sec_per_frame: 40 / 430, mag_db: new Uint8Array(430) })).toBeCloseTo(40);
  });
});

const HZ = [1000, 2000, 4000, 5000, 10000];
const SEC = [5, 10, 15, 30, 60, 120, 300];

describe("axisTicks — graduations des axes du spectrogramme agrandi", () => {
  it("prend le plus petit pas qui laisse l'écart demandé", () => {
    // 1 kHz tomberait à 27 px sur 600 px pour 22,05 kHz : trop serré. 2 kHz : 54 px.
    expect(axisTicks(22050, 600, 32, HZ)).toEqual([0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000]);
    // 312 s sur 1600 px : 10 s font 51 px, 15 s font 77 px.
    expect(axisTicks(312, 1600, 64, SEC).slice(0, 3)).toEqual([0, 15, 30]);
  });

  it("n'étiquette jamais au-delà de la donnée", () => {
    for (const v of axisTicks(312, 1600, 64, SEC)) expect(v).toBeLessThanOrEqual(312);
    expect(axisTicks(20000, 400, 32, HZ).at(-1)).toBe(20000);
  });

  it("garde le pas le plus large quand aucun n'est assez espacé", () => {
    expect(axisTicks(22050, 50, 32, HZ)).toEqual([0, 10000, 20000]);
  });

  it("rien sur un axe vide", () => {
    expect(axisTicks(0, 600, 32, HZ)).toEqual([]);
    expect(axisTicks(22050, 0, 32, HZ)).toEqual([]);
    expect(axisTicks(Number.NaN, 600, 32, HZ)).toEqual([]);
  });
});
