import { describe, it, expect } from "vitest";
import {
  destPopoverPosition,
  clampToViewport,
  POPOVER_GAP,
  POPOVER_MARGIN,
} from "../frontend/popover-position";

// Périmètre : la géométrie seule. Le rendu est vérifié dans la vraie fenêtre (issue #27,
// mesures du 2026-08-13) — ce fichier tient les cas que cette fenêtre ne peut PAS produire.

/** Le bouton Destination tel que mesuré dans la vraie fenêtre à la taille minimale déclarée
 *  (920x640, `tauri.conf.json`), une piste ouverte, mode Détail. */
const BTN_MESURE = { top: 362, bottom: 394, left: 705 };
const POP_W = 288; // .sift-dest-popover, styles.css
const POP_H = 222; // hauteur mesurée avec la vraie liste de dossiers (max-height CSS : 340)

describe("destPopoverPosition", () => {
  it("laisse le popover collé au bouton quand la fenêtre est large", () => {
    const { top, left } = destPopoverPosition(BTN_MESURE, POP_W, POP_H, 1920, 1080);
    expect(left).toBe(BTN_MESURE.left); // aligné à gauche sur le bouton, aucun recalage
    expect(top).toBe(BTN_MESURE.top - POP_H - POPOVER_GAP); // 132, au-dessus
  });

  // Vecteur gelé du défaut d'origine : `left` valait 705 sans recalage, donc un bord droit à 993
  // pour une fenêtre de 920 — 73 px hors écran, champ de filtre et rangs de dossiers inatteignables.
  it("ramène le popover dans la fenêtre à la largeur minimale (issue #27)", () => {
    const vw = 920;
    const { left, top } = destPopoverPosition(BTN_MESURE, POP_W, POP_H, vw, 640);
    expect(left).toBe(vw - POP_W - POPOVER_MARGIN); // 624
    expect(left + POP_W).toBeLessThanOrEqual(vw - POPOVER_MARGIN); // bord droit dedans
    expect(top).toBe(132); // la verticale, elle, tenait déjà
  });

  it("recale aussi contre le bord gauche", () => {
    const { left } = destPopoverPosition({ ...BTN_MESURE, left: 2 }, POP_W, POP_H, 920, 640);
    expect(left).toBe(POPOVER_MARGIN);
  });

  // Inatteignable dans la vraie fenêtre : le bouton vit dans la barre d'action ancrée en bas, donc
  // il y a toujours plus de place au-dessus. C'est précisément pour ça que le cas est ici.
  it("bascule sous le bouton quand la place manque au-dessus et qu'il y en a plus en dessous", () => {
    const btn = { top: 100, bottom: 132, left: 100 };
    const { top } = destPopoverPosition(btn, POP_W, POP_H, 920, 640);
    expect(top).toBe(btn.bottom + POPOVER_GAP); // 140
    expect(top).toBeGreaterThan(btn.bottom); // vraiment en dessous
  });

  it("garde le côté le plus large quand aucun des deux ne suffit", () => {
    const btn = { top: 400, bottom: 432, left: 100 };
    const popH = 500; // au-dessus : 384 dispo, en dessous : 192 — aucun ne contient 500
    const { top } = destPopoverPosition(btn, POP_W, popH, 920, 640);
    expect(top).toBeLessThan(btn.top); // resté au-dessus, pas basculé vers le côté étroit
    expect(top).toBe(POPOVER_MARGIN); // recalé au bord haut plutôt que sorti par le haut
  });

  it("colle au bord haut plutôt que de sortir, si le popover dépasse la fenêtre", () => {
    const { top } = destPopoverPosition({ top: 400, bottom: 432, left: 100 }, POP_W, 700, 920, 640);
    expect(top).toBe(POPOVER_MARGIN);
    expect(top).toBeGreaterThanOrEqual(0); // jamais négatif : c'est le défaut d'origine
  });
});

describe("clampToViewport", () => {
  it("ne touche pas un segment déjà dedans", () => {
    expect(clampToViewport(100, 288, 920)).toBe(100);
  });

  it("applique la borne haute puis la borne basse, dans cet ordre", () => {
    // Segment plus long que l'axe : la borne haute donnerait -68, la borne basse la reprend.
    expect(clampToViewport(0, 700, 640)).toBe(POPOVER_MARGIN);
    expect(clampToViewport(900, 288, 920)).toBe(920 - 288 - POPOVER_MARGIN);
    expect(clampToViewport(-50, 288, 920)).toBe(POPOVER_MARGIN);
  });
});
