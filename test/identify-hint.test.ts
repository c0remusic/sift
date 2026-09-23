// `identify-shared.ts::identifyHint` — ce que Revue envoie à `identify` (issue #67, relecture).
import { describe, expect, it } from "vitest";
import { identifyHint } from "../frontend/identify-shared";
import type { Canonical } from "../shared/contracts";

const c = (confidence: "green" | "yellow"): Canonical => ({
  artist: "",
  title: "infunktuation - feel real good (club version)-idc",
  version: null,
  label: "Trax",
  confidence,
});

describe("identifyHint", () => {
  it("une supposition jaune jamais touchée n'est PAS envoyée : la cascade des noms sales décide", () => {
    expect(identifyHint(c("yellow"), false)).toBeNull();
  });

  it("une valeur verte est envoyée, sans le label", () => {
    expect(identifyHint(c("green"), false)).toEqual({ artist: "", title: c("green").title, version: null });
  });

  it("une valeur jaune TAPÉE est envoyée : la saisie est intentionnelle", () => {
    expect(identifyHint(c("yellow"), true)).not.toBeNull();
  });

  it("rien d'ouvert, rien d'envoyé", () => {
    expect(identifyHint(null, true)).toBeNull();
  });
});
