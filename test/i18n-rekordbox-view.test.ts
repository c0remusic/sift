// Dictionnaire de l'écran Rekordbox (`frontend/i18n/rekordbox-view.ts`) — les fonctions à compte,
// que `test/i18n-dictionaries.test.ts` ne peut pas évaluer. Gelé : le français rendu à l'octet près
// comme le faisait `dom.ts::plural` avant la migration (accord à partir de 2, donc « 0 entrée »), et
// l'accord anglais (singulier à 1 seulement, donc « 0 entries »).
import { describe, expect, it } from "vitest";
import { D } from "../frontend/i18n/rekordbox-view";

describe("rekordbox-view — français d'origine", () => {
  const fr = D.fr;

  it("rapport de synchronisation", () => {
    expect(fr.syncReportFailed(1, 1)).toBe("1 entrée synchronisée, 1 échouée");
    expect(fr.syncReportFailed(3, 2)).toBe("3 entrées synchronisées, 2 échouées");
    expect(fr.syncReportOk(0)).toBe("0 entrée synchronisée — réimporte le XML dans Rekordbox si tu as réexporté.");
  });

  it("confirmation, état en cours, tête", () => {
    expect(fr.confirmSync(2)).toBe("Synchroniser 2 entrées avec Rekordbox ? Ferme Rekordbox avant de continuer.");
    expect(fr.syncing(1)).toBe("Synchronisation de 1 entrée…");
    expect(fr.xmlLinked(1, 2, "à jour")).toBe("XML Rekordbox lié · 1 playlist · 2 pistes · à jour");
    expect(fr.sectionsNoReply(2)).toBe("2 sections sans réponse");
    expect(fr.duplicatesToRemove(1)).toBe("1 doublon à retirer");
  });
});

describe("rekordbox-view — anglais", () => {
  const en = D.en;

  it("accord anglais : singulier à 1, pluriel à 0 et au-delà", () => {
    expect(en.syncReportFailed(1, 1)).toBe("1 entry synced, 1 failed");
    expect(en.syncReportOk(0)).toBe("0 entries synced — reimport the XML into Rekordbox if you re-exported.");
    expect(en.confirmSync(1)).toBe("Sync 1 entry with Rekordbox? Close Rekordbox before you continue.");
    expect(en.xmlLinked(0, 1, "up to date")).toBe("Rekordbox XML linked · 0 playlists · 1 track · up to date");
    expect(en.duplicatesToRemove(2)).toBe("2 duplicates to remove");
  });
});
