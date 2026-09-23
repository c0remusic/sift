// La résolution de langue et l'accesseur de dictionnaire (`frontend/i18n.ts`).
//
// Ce que ces vecteurs tiennent : `auto` suit l'OS, et TOUTE langue autre que le français donne
// l'anglais ; une valeur persistée inconnue retombe sur `auto` au lieu de casser le démarrage ; et
// un accesseur lit la langue AU MOMENT de l'appel — la propriété dont dépend toute la couche, puisque
// les modules s'évaluent avant que `initLang()` ait tranché.
import { afterEach, describe, expect, it } from "vitest";
import { dict, lang, numLocale, parseLangChoice, resolveLang, setCurrentLang } from "../frontend/i18n";

afterEach(() => setCurrentLang("fr"));

describe("resolveLang", () => {
  it("un choix explicite l'emporte sur le système", () => {
    expect(resolveLang("en", "fr-FR")).toBe("en");
    expect(resolveLang("fr", "en-US")).toBe("fr");
  });

  it("auto suit le système : français pour toute variante fr", () => {
    for (const s of ["fr", "fr-FR", "fr-CA", "FR-be", " fr-CH "]) expect(resolveLang("auto", s)).toBe("fr");
  });

  it("auto donne l'anglais pour toute autre langue, et pour une langue inconnue", () => {
    for (const s of ["en-US", "de-DE", "ja", "", null, undefined]) expect(resolveLang("auto", s)).toBe("en");
  });
});

describe("parseLangChoice", () => {
  it("seuls fr et en sont des choix explicites, tout le reste vaut auto", () => {
    expect(parseLangChoice("fr")).toBe("fr");
    expect(parseLangChoice("en")).toBe("en");
    for (const v of ["auto", "", "EN", "de", null, undefined]) expect(parseLangChoice(v)).toBe("auto");
  });
});

describe("dict", () => {
  it("lit la langue à l'appel, pas à la création de l'accesseur", () => {
    const T = dict({ fr: { ok: "Oui" }, en: { ok: "Yes" } });
    expect(T().ok).toBe("Oui");
    setCurrentLang("en");
    expect(lang()).toBe("en");
    expect(T().ok).toBe("Yes");
  });

  it("la locale des nombres suit la langue", () => {
    expect(numLocale()).toBe("fr-FR");
    setCurrentLang("en");
    expect(numLocale()).toBe("en-US");
    expect((44100).toLocaleString(numLocale())).toBe("44,100");
  });
});
