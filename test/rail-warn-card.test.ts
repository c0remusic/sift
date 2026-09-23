import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import { ROOT_WARN_ID, rootWarningHtml } from "../frontend/rail-warn-card";

afterEach(() => setCurrentLang("fr"));

// Carte « racine non définie » du rail (issue #54 du 2026-09-02, direction A2). Elle remplace le
// bandeau `#sift-gate` supprimé le même jour.
//
// Ce qui est gelé ici, c'est ce qu'une inspection visuelle ne verrait PAS tomber : un attribut de
// navigation perdu (la carte devient décorative et le seul chemin vers Réglages hors du rail
// disparaît), une classe `.nv` prise au passage (la carte se lirait comme un huitième écran de
// navigation), un id instable (`paintRootWarning` s'appuie dessus pour rester idempotent — deux
// cartes empilées sinon, à chaque reconstruction de la section Sources).
//
// Le markup vit dans un module SANS import (`rail-warn-card.ts`) exactement pour être exécutable
// ici : la suite tourne en env Node, qui ne peut pas charger un module important `./ipc`.

describe("carte de racine manquante du rail", () => {
  it("navigue vers Réglages par data-view — le délégué de router.ts est le seul chemin", () => {
    expect(rootWarningHtml()).toContain('data-view="reglages"');
  });

  it("n'est PAS une entrée de navigation : aucune classe .nv", () => {
    const html = rootWarningHtml();
    // Test de la CLASSE, pas d'une sous-chaîne : « .sift-railwarn » ne contient pas « nv », mais un
    // futur `class="nv sift-railwarn"` doit tomber ici.
    const classAttr = /class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(classAttr.split(/\s+/)).toContain("sift-railwarn");
    expect(classAttr.split(/\s+/)).not.toContain("nv");
  });

  it("porte l'id stable dont le montage idempotent dépend", () => {
    expect(ROOT_WARN_ID).toBe("sift-railwarn");
    expect(rootWarningHtml()).toContain(`id="${ROOT_WARN_ID}"`);
  });

  it("est un vrai bouton nommé — type explicite et aria-label en une phrase", () => {
    const html = rootWarningHtml();
    expect(html.startsWith("<button ")).toBe(true);
    expect(html).toContain('type="button"');
    expect(/aria-label="[^"]{20,}"/.test(html)).toBe(true);
  });

  // Le texte vient du dictionnaire `frontend/i18n/rail-warn-card.ts`, lu À L'APPEL : la même
  // fonction rend le français par défaut et l'anglais une fois la langue posée. Épinglé dans les deux
  // langues, avec les mêmes contraintes de forme — un `"` dans la valeur anglaise fermerait
  // l'attribut `aria-label` en plein milieu.
  it("rend le libellé français par défaut", () => {
    const html = rootWarningHtml();
    expect(html).toContain(
      'aria-label="Racine de bibliothèque non définie — ouvrir les Réglages pour la choisir"',
    );
    expect(html).toContain("<strong>Racine non définie</strong>");
    expect(html).toContain("<span>Choisir dans Réglages ›</span>");
  });

  it("rend le libellé anglais quand la langue est en, sans changer la structure", () => {
    setCurrentLang("en");
    const html = rootWarningHtml();
    expect(html).toContain('aria-label="Library root not set — open Settings to choose one"');
    expect(html).toContain("<strong>Root not set</strong>");
    expect(html).toContain("<span>Choose in Settings ›</span>");
    expect(html).toContain('data-view="reglages"');
    expect(html).toContain(`id="${ROOT_WARN_ID}"`);
    expect(/aria-label="[^"<>]{20,}"/.test(html)).toBe(true);
  });
});
