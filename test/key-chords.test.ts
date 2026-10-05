import { describe, expect, it } from "vitest";
import { isBareKey, isInspectorToggleChord, isUndoChord, selectionChord, type Chord } from "../frontend/key-chords";

const chord = (key: string, mods: Partial<Omit<Chord, "key">> = {}): Chord => ({
  key,
  code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("isUndoChord — ⌘/Ctrl+Z annule, ⇧ ne rétablit pas et n'annule pas", () => {
  it("Ctrl+Z et ⌘+Z annulent", () => {
    expect(isUndoChord(chord("z", { ctrlKey: true }))).toBe(true);
    expect(isUndoChord(chord("z", { metaKey: true }))).toBe(true);
  });
  it("Ctrl+Maj+Z et ⇧⌘Z n'annulent PAS une seconde action", () => {
    expect(isUndoChord(chord("Z", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoChord(chord("Z", { metaKey: true, shiftKey: true }))).toBe(false);
  });
  it("Z majuscule sans Maj (verrouillage) reste une annulation", () => {
    expect(isUndoChord(chord("Z", { ctrlKey: true }))).toBe(true);
  });
  it("AltGr (Ctrl+Alt) et Z nu ne sont pas des annulations", () => {
    expect(isUndoChord(chord("z", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUndoChord(chord("z"))).toBe(false);
    expect(isUndoChord(chord("y", { ctrlKey: true }))).toBe(false);
  });
});

describe("selectionChord — ⌘/Ctrl+A tout, ⇧ rien", () => {
  it("Ctrl+A et ⌘+A sélectionnent tout", () => {
    expect(selectionChord(chord("a", { ctrlKey: true }))).toBe("all");
    expect(selectionChord(chord("a", { metaKey: true }))).toBe("all");
  });
  it("Ctrl+Maj+A et ⇧⌘A désélectionnent", () => {
    expect(selectionChord(chord("A", { ctrlKey: true, shiftKey: true }))).toBe("none");
    expect(selectionChord(chord("A", { metaKey: true, shiftKey: true }))).toBe("none");
  });
  it("sans modificateur de commande, ou avec Alt, ou une autre touche : rien", () => {
    expect(selectionChord(chord("a"))).toBeNull();
    expect(selectionChord(chord("A", { shiftKey: true }))).toBeNull();
    expect(selectionChord(chord("a", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(selectionChord(chord("b", { ctrlKey: true }))).toBeNull();
  });
});

describe("isBareKey — la couche 3 de Revue ne prend que des touches nues", () => {
  it("X, Entrée, Espace nus, et Maj+I, sont des touches nues", () => {
    expect(isBareKey(chord("x"))).toBe(true);
    expect(isBareKey(chord("Enter", { code: "Enter" }))).toBe(true);
    expect(isBareKey(chord(" ", { code: "Space" }))).toBe(true);
    expect(isBareKey(chord("I", { shiftKey: true }))).toBe(true);
  });
  it("Ctrl+X (couper) n'écarte pas, ⌘+Entrée ne range pas, Alt+I n'identifie pas", () => {
    expect(isBareKey(chord("x", { ctrlKey: true }))).toBe(false);
    expect(isBareKey(chord("Enter", { code: "Enter", metaKey: true }))).toBe(false);
    expect(isBareKey(chord("i", { altKey: true }))).toBe(false);
  });
});

describe("isInspectorToggleChord — ⌥⌘I / Ctrl+Alt+I, lu sur la touche physique", () => {
  it("⌥⌘I sur Mac, même quand Option produit la touche morte « ˆ »", () => {
    expect(isInspectorToggleChord(chord("ˆ", { code: "KeyI", metaKey: true, altKey: true }))).toBe(true);
    expect(isInspectorToggleChord(chord("Dead", { code: "KeyI", metaKey: true, altKey: true }))).toBe(true);
  });
  it("Ctrl+Alt+I sous Windows", () => {
    expect(isInspectorToggleChord(chord("i", { ctrlKey: true, altKey: true }))).toBe(true);
  });
  it("sans Alt, avec Maj, sans commande, ou une autre touche : non", () => {
    expect(isInspectorToggleChord(chord("i", { ctrlKey: true }))).toBe(false);
    expect(isInspectorToggleChord(chord("I", { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(isInspectorToggleChord(chord("i", { altKey: true }))).toBe(false);
    expect(isInspectorToggleChord(chord("o", { ctrlKey: true, altKey: true }))).toBe(false);
  });
});
