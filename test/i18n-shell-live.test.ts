// Dictionnaires du lot « coquille et câblage live » : les entrées PARAMÉTRÉES, que
// `i18n-dictionaries.test.ts` ne peut pas évaluer (une fonction ne se lit pas sans ses arguments).
//
// Deux choses gelées :
// 1. la moitié française rend, octet pour octet, ce que le gabarit d'origine rendait — accords
//    compris (« 2 morceaux et 1 dossier ajoutés ») : la migration ne devait reformuler aucun texte ;
// 2. la moitié anglaise accorde son pluriel à l'anglaise — 1 au singulier, 0 et plus au pluriel —
//    et non avec la règle française `n > 1`, qui donnerait « 0 track ».
import { describe, expect, it } from "vitest";
import { D as chrome } from "../frontend/i18n/chrome";
import { D as live } from "../frontend/i18n/sift-live";
import { D as sources } from "../frontend/i18n/rail-sources";
import { D as zone } from "../frontend/i18n/progress-zone";

describe("chrome — compte rendu d'un dépôt", () => {
  it("français inchangé : morceau(x), dossier(s), accord de « ajouté » sur le total", () => {
    expect(chrome.fr.imported(1, 0)).toBe("1 morceau ajouté");
    expect(chrome.fr.imported(3, 0)).toBe("3 morceaux ajoutés");
    expect(chrome.fr.imported(0, 1)).toBe("1 dossier ajouté");
    expect(chrome.fr.imported(1, 1)).toBe("1 morceau et 1 dossier ajoutés");
    expect(chrome.fr.imported(2, 3)).toBe("2 morceaux et 3 dossiers ajoutés");
  });

  it("anglais : track(s), folder(s), « and »", () => {
    expect(chrome.en.imported(1, 0)).toBe("1 track added");
    expect(chrome.en.imported(3, 0)).toBe("3 tracks added");
    expect(chrome.en.imported(1, 2)).toBe("1 track and 2 folders added");
  });
});

describe("sift-live — toasts paramétrés", () => {
  it("français inchangé : purge partielle, doublons, export", () => {
    expect(live.fr.purgePartial(1, 1)).toBe(
      "1 supprimé — 1 fichier impossible à supprimer (ouvert dans un autre programme ?)",
    );
    expect(live.fr.purgePartial(4, 2)).toBe(
      "4 supprimés — 2 fichiers impossibles à supprimer (ouvert dans un autre programme ?)",
    );
    expect(live.fr.dupConfirm(1)).toBe(
      "Envoyer 1 doublon à la corbeille ? Le morceau recommandé est conservé.",
    );
    expect(live.fr.dupPartial(2, 1)).toBe("2 doublons envoyés à la corbeille, 1 en échec");
    expect(live.fr.exportDone(12, 3)).toBe(
      "12 pistes dans 3 playlists Rekordbox — réimporte le XML dans Rekordbox pour resynchroniser.",
    );
  });

  it("anglais : pluriel à l'anglaise, 0 compris", () => {
    expect(live.en.xmlLinked(1, 1)).toBe("Rekordbox XML linked: 1 track, 1 playlist");
    expect(live.en.xmlLinked(0, 2)).toBe("Rekordbox XML linked: 0 tracks, 2 playlists");
    expect(live.en.dupConfirm(1)).toBe("Move 1 duplicate to Trash? The recommended track stays.");
    expect(live.en.dupPartial(3, 1)).toBe("3 duplicates moved to Trash, 1 failed");
    expect(live.en.purgePartial(2, 1)).toBe("2 deleted — couldn't delete 1 file (open in another program?)");
  });
});

describe("rail-sources et progress-zone — gabarits à nom", () => {
  it("le nom de dossier passe tel quel, entre guillemets typographiques en anglais", () => {
    expect(sources.fr.unwatchConfirm("promos")).toBe(
      "Retirer « promos » des dossiers surveillés ? Les fichiers ne sont pas touchés.",
    );
    expect(sources.en.addFailed("promos")).toBe("Couldn't add “promos”.");
  });

  it("nom accessible du bouton d'arrêt : verbe puis tâche, dans chaque langue", () => {
    expect(zone.fr.stopAria(zone.fr.tasks.file)).toBe("Arrêter — Conversion");
    expect(zone.en.stopAria(zone.en.tasks.analyze)).toBe("Stop — Analysis");
  });
});
