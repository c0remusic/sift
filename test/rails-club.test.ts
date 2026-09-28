// `rails.ts::belowClubBitrate` — la seule définition de « sous 320 » (issue #69).
import { describe, expect, it } from "vitest";
import { belowClubBitrate, offerBelowClubSetAside } from "../frontend/rails";

describe("belowClubBitrate", () => {
  it("un lossy sous 320 est visé", () => {
    expect(belowClubBitrate("lossy", 128)).toBe(true);
    expect(belowClubBitrate("lossy", 256)).toBe(true);
    expect(belowClubBitrate("lossy", 319)).toBe(true);
  });

  it("320 pile ne l'est pas", () => {
    expect(belowClubBitrate("lossy", 320)).toBe(false);
  });

  it("un débit inconnu ne déclenche rien", () => {
    expect(belowClubBitrate("lossy", null)).toBe(false);
    expect(belowClubBitrate("lossy", 0)).toBe(false);
  });

  it("un lossless n'est jamais visé, même à bas débit (un AIFF mono 8 kHz fait 128 kbps)", () => {
    expect(belowClubBitrate("lossless", 128)).toBe(false);
    expect(belowClubBitrate("unknown", 128)).toBe(false);
    expect(belowClubBitrate(null, 128)).toBe(false);
  });
});

describe("offerBelowClubSetAside — le bandeau de Revue", () => {
  it("propose pour un sous-320 VRAI ou à vérifier, et pas pour un FAUX (son pied dit Re-sourcer)", () => {
    expect(offerBelowClubSetAside("ok", "lossy", 128)).toBe(true);
    expect(offerBelowClubSetAside("grey", "lossy", 128)).toBe(true);
    expect(offerBelowClubSetAside(null, "lossy", 128)).toBe(true);
    expect(offerBelowClubSetAside("fake", "lossy", 192)).toBe(false);
    expect(offerBelowClubSetAside("ok", "lossy", 320)).toBe(false);
  });
});
