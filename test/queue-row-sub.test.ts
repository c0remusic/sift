// La seconde ligne de la rangée de file (`queue-row-sub.ts`), qui porte l'échec de conversion depuis
// l'issue #86. Avant, le marqueur « conversion échouée » était un troisième enfant `flex:none` de la
// rangée : à la largeur par défaut de la colonne (rangée de 237 px mesurée le 2026-11-03), il
// comprimait le nom du fichier jusqu'à « L ». La rangée disait qu'une piste avait échoué sans dire
// laquelle.
import { afterEach, describe, expect, it } from "vitest";
import { queueSubHtml } from "../frontend/queue-row-sub";
import { setCurrentLang } from "../frontend/i18n";

afterEach(() => setCurrentLang("fr"));

/** Le texte visible, balises retirées. */
const texte = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

describe("queueSubHtml", () => {
  it("sans échec : l'artiste seul, ou une espace insécable pour garder la hauteur", () => {
    expect(queueSubHtml("Larry Heard", null)).toBe(`<div class="qi-sub">Larry Heard</div>`);
    expect(queueSubHtml("", null)).toBe(`<div class="qi-sub">&nbsp;</div>`);
  });

  it("échec : le marqueur passe sur la seconde ligne, devant l'artiste", () => {
    const html = queueSubHtml("Larry Heard", "FFmpeg est introuvable");
    expect(html.startsWith(`<div class="qi-sub">`)).toBe(true);
    expect(texte(html)).toBe("conversion échouée · Larry Heard");
    expect(html).toContain(`title="FFmpeg est introuvable"`);
  });

  it("échec sans artiste : le marqueur seul, sans séparateur orphelin", () => {
    expect(texte(queueSubHtml("", "x"))).toBe("conversion échouée");
  });

  it("échappe l'artiste et la cause", () => {
    const html = queueSubHtml("<b>A</b>", `"cause"`);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;A&lt;/b&gt;");
    expect(html).not.toContain(`title=""cause""`);
  });

  it("parle la langue de l'interface", () => {
    setCurrentLang("en");
    expect(texte(queueSubHtml("A", "x"))).toBe("conversion failed · A");
  });
});
