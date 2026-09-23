// Dictionnaires du lot « Écartés + actions de Revue » : les fonctions à accord (pluriel, nom
// interpolé) que `i18n-dictionaries.test.ts` ne peut pas évaluer, dans les DEUX langues.
//
// Le français est figé sur les littéraux d'origine : la migration ne devait changer aucun octet
// affiché en français. L'anglais est figé sur son propre accord (1 track, 0 tracks), qui n'est pas
// celui du français (0 piste).
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { T as ecartes } from "../frontend/i18n/ecartes-view";
import { T as actions } from "../frontend/i18n/filing-actions";
import { T as toast } from "../frontend/i18n/filing-toast";

afterEach(() => setCurrentLang("fr"));

describe("Écartés — compte de pistes", () => {
  it("français : singulier jusqu'à 1, comme l'ancien gabarit", () => {
    expect([0, 1, 2, 12].map((n) => ecartes().tracks(n))).toEqual(["0 piste", "1 piste", "2 pistes", "12 pistes"]);
  });

  it("anglais : singulier pour 1 seulement", () => {
    setCurrentLang("en");
    expect([0, 1, 2, 12].map((n) => ecartes().tracks(n))).toEqual(["0 tracks", "1 track", "2 tracks", "12 tracks"]);
  });

  it("verdicts : FAUX et À VÉRIFIER deviennent FAKE et TO CHECK", () => {
    expect([ecartes().reasonFake, ecartes().reasonCheck]).toEqual(["FAUX", "À VÉRIFIER"]);
    setCurrentLang("en");
    expect([ecartes().reasonFake, ecartes().reasonCheck]).toEqual(["FAKE", "TO CHECK"]);
  });
});

describe("Revue — messages paramétrés", () => {
  it("refus RAIL_MISMATCH : le texte français d'origine, octet pour octet", () => {
    expect(actions().railMismatch("FLAC")).toBe(
      "Ce fichier est déclaré FLAC mais son contenu réel est compressé (lossy) — " +
        "le convertir créerait un faux fichier lossless.\n\nConvertir quand même ?",
    );
    setCurrentLang("en");
    expect(actions().railMismatch("FLAC")).toBe(
      "This file is declared FLAC but its real content is compressed (lossy) — " +
        "converting it would create a fake lossless file.\n\nConvert anyway?",
    );
  });

  it("échec d'une conversion de fond : le nom tel quel, dans les deux langues", () => {
    expect(actions().failedBackInQueue("a.aiff")).toBe("Conversion échouée — a.aiff est revenu dans la file");
    setCurrentLang("en");
    expect(actions().failedBackInQueue("a.aiff")).toBe("Conversion failed — a.aiff is back in the queue");
  });

  // Ne teste que la clé du dictionnaire : `toast()` demande un DOM, absent de l'env Node. Que son
  // `actionLabel` par défaut soit lu à l'appel ne se vérifie que dans la vraie fenêtre.
  it("dictionnaire du toast : la clé d'annulation, en français et en anglais", () => {
    expect(toast().undo).toBe("Annuler");
    setCurrentLang("en");
    expect(toast().undo).toBe("Undo");
  });
});
