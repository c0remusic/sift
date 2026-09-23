// `usb-format-error.ts` — le motif d'un formatage refusé. Deux choses gelées :
//   - le nom du disque sort BRUT : `usb-format-modal.ts` échappe `lastError` au rendu, et l'ancien
//     `esc(displayName)` en amont affichait « Clé d&#39;Antoine » (double échappement) ;
//   - les deux sentinelles du garde anti-course sont FATALES (pas de reprise), les autres non.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { humanizeFormatError } from "../frontend/usb-format-error";

afterEach(() => setCurrentLang("fr"));

const NOM = `Clé d'Antoine <USB> & "co"`;

describe("humanizeFormatError", () => {
  it("le nom du disque sort tel quel : l'échappement se fait une fois, au rendu", () => {
    const { text } = humanizeFormatError("format refused: IDENTITY_MISMATCH", NOM);
    expect(text).toContain(NOM);
    expect(text).not.toContain("&#39;");
    expect(text).not.toContain("&amp;");
  });

  it("les deux sentinelles du garde anti-course coupent la reprise", () => {
    expect(humanizeFormatError("IDENTITY_MISMATCH", NOM).fatal).toBe(true);
    expect(humanizeFormatError("DRIVE_VANISHED", NOM).fatal).toBe(true);
    expect(humanizeFormatError("ELEVATION_DECLINED", NOM).fatal).toBe(false);
    expect(humanizeFormatError("Access is denied.", NOM).fatal).toBe(false);
    expect(humanizeFormatError("n'importe quoi", NOM).fatal).toBe(false);
  });

  it("jamais une sentinelle à l'écran, dans les deux langues", () => {
    for (const lang of ["fr", "en"] as const) {
      setCurrentLang(lang);
      for (const raw of ["IDENTITY_MISMATCH", "DRIVE_VANISHED", "ELEVATION_DECLINED"]) {
        expect(humanizeFormatError(raw, "E:").text).not.toContain(raw);
      }
    }
  });

  it("anglais : le motif d'identité nomme le disque", () => {
    setCurrentLang("en");
    expect(humanizeFormatError("IDENTITY_MISMATCH", NOM).text).toBe(
      `This is no longer the same drive: another volume is now at ${NOM}. ` +
        "Nothing was formatted. Close this window and select the drive again in the list.",
    );
  });
});
