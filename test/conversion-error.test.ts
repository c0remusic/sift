// `conversion-error.ts` — FFmpeg manquant, reconnu à la chaîne que `encode.rs` produit elle-même.
// La forme réelle de l'erreur est citée telle que le backend la rend : `EncodeError::Ffmpeg`
// (« ffmpeg: spawn failed: … »), suivie d'un message d'E/S que Windows traduit.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { ffmpegMissingText } from "../frontend/conversion-error";

afterEach(() => setCurrentLang("fr"));

const WINDOWS_FR = "ffmpeg: spawn failed: Le fichier spécifié est introuvable. (os error 2)";
const WINDOWS_EN = "ffmpeg: spawn failed: The system cannot find the file specified. (os error 2)";

describe("ffmpegMissingText", () => {
  it("reconnaît le sidecar manquant, quelle que soit la langue du système", () => {
    expect(ffmpegMissingText(WINDOWS_FR)).toMatch(/^FFmpeg est introuvable/);
    expect(ffmpegMissingText(WINDOWS_EN)).toMatch(/^FFmpeg est introuvable/);
  });

  it("parle la langue de l'interface", () => {
    setCurrentLang("en");
    expect(ffmpegMissingText(WINDOWS_FR)).toMatch(/^FFmpeg can't be found/);
  });

  it("toute autre erreur rend null : l'appelant garde son message", () => {
    expect(ffmpegMissingText("ffmpeg: exited with status 1")).toBeNull();
    expect(ffmpegMissingText("Fichier source introuvable")).toBeNull();
    expect(ffmpegMissingText("")).toBeNull();
  });
});
