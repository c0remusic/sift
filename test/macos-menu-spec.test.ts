import { describe, expect, it } from "vitest";
import { D } from "../frontend/i18n/macos-menu";
import { HELP_MENU_ID, WINDOW_MENU_ID, macosMenuSpec } from "../frontend/macos-menu-spec";

// Squelette du menu que Tauri 2.11.5 pose de lui-même sur macOS (`Menu::default`, menu.rs:141-238).
// La barre de Sift doit le reproduire article pour article : la remplacer par moins retirerait au
// Mac un geste système — Coller dans un champ, Quitter, Placer dans le Dock — sans que rien d'autre
// ne le signale, puisqu'aucun test ne tourne sur un Mac.
const TAURI_DEFAULT = [
  ["About", "Separator", "Services", "Separator", "Hide", "HideOthers", "Separator", "Quit"],
  ["CloseWindow"],
  ["Undo", "Redo", "Separator", "Cut", "Copy", "Paste", "SelectAll"],
  ["Fullscreen"],
  ["Minimize", "Maximize", "Separator", "CloseWindow"],
  [],
];

describe("barre de menus macOS (#58)", () => {
  for (const lang of ["fr", "en"] as const) {
    const spec = macosMenuSpec(D[lang], "Sift");

    it(`${lang} : mêmes articles natifs, dans le même ordre, que le menu par défaut de Tauri`, () => {
      expect(spec.map((s) => s.items.map((i) => i.item))).toEqual(TAURI_DEFAULT);
    });

    it(`${lang} : Fenêtre et Aide portent les identifiants que Tauri relie à NSApp`, () => {
      expect(spec.map((s) => s.id)).toEqual([undefined, undefined, undefined, undefined, WINDOW_MENU_ID, HELP_MENU_ID]);
    });

    it(`${lang} : chaque article visible a un intitulé`, () => {
      for (const s of spec) {
        expect(s.text).not.toBe("");
        for (const i of s.items) if (i.item !== "Separator") expect(i.text).toBeTruthy();
      }
    });
  }

  it("le premier menu porte le nom de l'app, comme sur tout Mac", () => {
    expect(macosMenuSpec(D.fr, "Sift")[0].text).toBe("Sift");
    expect(macosMenuSpec(D.fr, "Sift")[0].items[7].text).toBe("Quitter Sift");
  });
});
