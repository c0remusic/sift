// Le format `PCT:<n>|<texte>` est écrit par Rust (`privileged::progress_line`, tenu par
// `la_ligne_de_progression_porte_un_pourcentage_entier_borne`) et découpé ici.
import { describe, expect, it } from "vitest";
import { parseFormatStep } from "../frontend/usb-format-step";

describe("parseFormatStep", () => {
  it("une étape sans pourcentage reste du texte", () => {
    expect(parseFormatStep("Partitionnement du disque…")).toEqual({ text: "Partitionnement du disque…", pct: null });
  });
  it("une étape d'écriture rend son pourcentage et son texte", () => {
    expect(parseFormatStep("PCT:42|Écriture… 51 Mo écrits")).toEqual({ text: "Écriture… 51 Mo écrits", pct: 42 });
  });
  it("coupe au premier séparateur", () => {
    expect(parseFormatStep("PCT:7|a|b")).toEqual({ text: "a|b", pct: 7 });
  });
  it("bornes 0 et 100 acceptées", () => {
    expect(parseFormatStep("PCT:0|x").pct).toBe(0);
    expect(parseFormatStep("PCT:100|x").pct).toBe(100);
  });
  it("un nombre illisible ou hors bornes n'invente pas de pourcentage", () => {
    for (const raw of ["PCT:abc|x", "PCT:101|x", "PCT:-1|x", "PCT:4.5|x", "PCT:12", "PCT:|x"]) {
      expect(parseFormatStep(raw)).toEqual({ text: raw, pct: null });
    }
  });
});
