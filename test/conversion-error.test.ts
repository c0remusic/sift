// `conversion-error.ts` — FFmpeg manquant, reconnu à la chaîne que `encode.rs` produit elle-même.
// La forme réelle de l'erreur est citée telle que le backend la rend : `EncodeError::Ffmpeg`
// (« ffmpeg: spawn failed: … »), suivie d'un message d'E/S que Windows traduit.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { conversionFailureText, failedBannerLabel } from "../frontend/conversion-error";

afterEach(() => setCurrentLang("fr"));

const WINDOWS_FR = "ffmpeg: spawn failed: Le fichier spécifié est introuvable. (os error 2)";
const WINDOWS_EN = "ffmpeg: spawn failed: The system cannot find the file specified. (os error 2)";

describe("conversionFailureText", () => {
  it("reconnaît le sidecar manquant, quelle que soit la langue du système", () => {
    expect(conversionFailureText(WINDOWS_FR)).toMatch(/^FFmpeg est introuvable/);
    expect(conversionFailureText(WINDOWS_EN)).toMatch(/^FFmpeg est introuvable/);
  });

  it("parle la langue de l'interface", () => {
    setCurrentLang("en");
    expect(conversionFailureText(WINDOWS_FR)).toMatch(/^FFmpeg can't be found/);
  });

  // Les deux formes que `tagging.rs` produit (`FilingError::Tag` les préfixe de « tag: »). Mesuré le
  // 2026-10-30 : 11 fichiers d'Antoine aux tags illisibles même en lecture tolérante échouaient sur
  // un « est revenu dans la file » qui ne disait rien de la cause.
  it("reconnaît des tags illisibles, à la lecture comme à l'écriture", () => {
    expect(conversionFailureText("tag: read tags: Text decoding: UTF-16 string has an odd length")).toMatch(
      /^Tags illisibles/,
    );
    expect(conversionFailureText("tag: save tags: invalid frame")).toMatch(/^Tags illisibles/);
  });

  it("toute autre erreur rend null : l'appelant garde son message", () => {
    expect(conversionFailureText("ffmpeg: exited with status 1")).toBeNull();
    expect(conversionFailureText("Fichier source introuvable")).toBeNull();
    expect(conversionFailureText("")).toBeNull();
  });
});

// Issue #85 : le bandeau persistant d'une conversion échouée disait « Conversion échouée » sans la
// cause, alors que le toast la donnait et disparaît au bout de quelques secondes.
describe("failedBannerLabel", () => {
  it("nomme la cause quand elle est connue", () => {
    expect(failedBannerLabel(WINDOWS_FR)).toBe(
      "Conversion échouée — FFmpeg est introuvable — Sift ne peut convertir aucun fichier tant qu'il manque. Réinstaller l'app le rétablit.",
    );
  });

  it("garde le libellé nu pour une erreur sans cause lisible", () => {
    expect(failedBannerLabel("ffmpeg: exited with status 1")).toBe("Conversion échouée");
  });

  it("parle la langue de l'interface", () => {
    setCurrentLang("en");
    expect(failedBannerLabel(WINDOWS_EN)).toMatch(/^Conversion failed — FFmpeg can't be found/);
  });
});
