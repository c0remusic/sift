import { afterEach, describe, expect, it } from "vitest";
import { scanDoneText } from "../frontend/scan-report";
import { setCurrentLang } from "../frontend/i18n";

// Le toast de fin de scan (2026-10-30). Ce que ces vecteurs tiennent : le scan de rattrapage du
// lancement se TAIT quand il ne trouve rien (il tourne à chaque ouverture), un rescan demandé
// répond toujours, et les accords suivent les comptes.
afterEach(() => setCurrentLang("fr"));
const scan = (added: number, updated: number, removed: number, startup: boolean) => ({
  source_id: 1,
  added,
  updated,
  removed,
  startup,
});

describe("scanDoneText", () => {
  it("un rescan demandé dit ce qu'il a trouvé", () => {
    expect(scanDoneText(scan(3, 0, 1, false))).toBe("Rescan terminé : 3 nouveaux, 1 disparu");
    expect(scanDoneText(scan(1, 2, 0, false))).toBe("Rescan terminé : 1 nouveau, 2 modifiés");
  });

  it("un rescan demandé répond même quand rien n'a changé", () => {
    expect(scanDoneText(scan(0, 0, 0, false))).toBe("Rescan terminé : rien de nouveau");
  });

  it("le scan du lancement se tait sans trouvaille, et parle sinon", () => {
    expect(scanDoneText(scan(0, 0, 0, true))).toBeNull();
    expect(scanDoneText(scan(4, 0, 0, true))).toBe("Arrivés pendant la fermeture : 4 nouveaux");
  });

  it("en anglais", () => {
    setCurrentLang("en");
    expect(scanDoneText(scan(2, 0, 1, true))).toBe("Arrived while Sift was closed: 2 new, 1 gone");
  });
});
