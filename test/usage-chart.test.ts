// `usage-chart.ts` — les fonctions exportées qui rendent du texte sans DOM : `formatGo` (l'unité de
// taille, appelée aussi par `usb-view.ts` et `usb-row.ts`), `humanizeEject` (le motif d'un refus
// d'éjection) et `humanizeUsageError` (la cause d'une occupation illisible). Gelé : le rendu français
// d'origine à l'octet près, sa version anglaise, et la reconnaissance des sentinelles `EJECT_BUSY` /
// `DRIVE_VANISHED`, qui ne dépend pas de la langue.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { formatGo, humanizeEject, humanizeUsageError } from "../frontend/usage-chart";

afterEach(() => setCurrentLang("fr"));

describe("formatGo", () => {
  it("français : virgule décimale, « Go », aucun séparateur de milliers", () => {
    expect(formatGo(1_500_000_000)).toBe("1,5 Go");
    expect(formatGo(1_234_500_000_000)).toBe("1234,5 Go");
  });

  it("anglais : point décimal, « GB »", () => {
    setCurrentLang("en");
    expect(formatGo(1_500_000_000)).toBe("1.5 GB");
    expect(formatGo(1_234_500_000_000)).toBe("1234.5 GB");
  });
});

describe("humanizeEject — la sentinelle décide, la langue ne fait que dire", () => {
  const busy = "eject failed: EJECT_BUSY (volume locked)";
  const gone = "DRIVE_VANISHED";

  it("français, texte d'origine", () => {
    expect(humanizeEject(busy)).toBe(
      "Windows refuse de démonter ce disque : un programme le tient encore ouvert. " +
        "Ferme Rekordbox et les fenêtres de l'explorateur, puis réessaie. Rien n'a été démonté — " +
        "ne le débranche pas en l'état.",
    );
    expect(humanizeEject(gone)).toBe("Ce disque n'est déjà plus branché.");
    expect(humanizeEject("autre chose")).toBe("Éjection impossible.");
  });

  it("anglais : les mêmes sentinelles mènent aux mêmes trois motifs", () => {
    setCurrentLang("en");
    expect(humanizeEject(busy)).toMatch(/^Windows won't unmount this drive/);
    expect(humanizeEject(gone)).toBe("This drive is already unplugged.");
    expect(humanizeEject("something else")).toBe("Eject failed.");
  });
});

// Le disque débranché entre la liste et le parcours : `drive_usage` rejette avec la sentinelle nue,
// qui s'affichait telle quelle sous « Occupation indisponible. » avant le 2026-09-23.
describe("humanizeUsageError — jamais la sentinelle à l'écran", () => {
  it("français", () => {
    expect(humanizeUsageError("DRIVE_VANISHED")).toBe("Ce disque n'est plus branché.");
  });

  it("anglais", () => {
    setCurrentLang("en");
    expect(humanizeUsageError("DRIVE_VANISHED")).toBe("This drive is no longer plugged in.");
  });

  it("une autre cause passe telle quelle : c'est déjà un message du backend, traduit", () => {
    expect(humanizeUsageError("Accès refusé au volume E:")).toBe("Accès refusé au volume E:");
  });
});
