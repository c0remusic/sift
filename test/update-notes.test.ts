// #75 : la bannière de mise à jour résume les notes dans la langue de l'interface. Avant, elle
// prenait la première ligne utile de la section — donc la française, dans une interface anglaise.
import { describe, expect, it } from "vitest";
import { summariseNotes } from "../frontend/update-notes";
import { CHANGELOG_LANG_HEADINGS } from "../shared/contracts";
import { HEADING_EN, HEADING_FR } from "../scripts/changelog-lib.mjs";

it("les titres de langue sont les mêmes pour la release et pour la bannière", () => {
  // Deux copies du même protocole : si le script de release exigeait « ### Francais » et que la
  // bannière cherchait « ### Français », l'interface anglaise afficherait la moitié française.
  expect(CHANGELOG_LANG_HEADINGS).toEqual({ fr: HEADING_FR, en: HEADING_EN });
});

const BILINGUE = [
  "### Français",
  "",
  "#### Revue",
  "",
  "- Le spectrogramme s'agrandit.",
  "",
  "### English",
  "",
  "#### Review",
  "",
  "- The spectrogram opens large.",
  "",
  "---",
  "",
  "### Installation",
].join("\n");

describe("summariseNotes — le résumé de la bannière de mise à jour", () => {
  it("interface anglaise : la moitié anglaise, jamais la française", () => {
    expect(summariseNotes(BILINGUE, "en")).toBe("Review");
  });

  it("interface française : la moitié française", () => {
    expect(summariseNotes(BILINGUE, "fr")).toBe("Revue");
  });

  it("une moitié vide ne déborde pas sur l'autre langue", () => {
    const frVide = ["### Français", "", "### English", "", "#### Review"].join("\n");
    expect(summariseNotes(frVide, "fr")).toBe("");
  });

  it("section antérieure à #75, sans titres de langue : lue depuis le début, comme avant", () => {
    const ancienne = ["### Apparence", "", "- **Sift a son icône.**"].join("\n");
    expect(summariseNotes(ancienne, "en")).toBe("Apparence");
    expect(summariseNotes(ancienne, "fr")).toBe("Apparence");
  });

  it("s'arrête au pied de page d'installation", () => {
    expect(summariseNotes(["", "---", "", "### Installation"].join("\n"), "fr")).toBe("");
  });

  it("coupe une ligne trop longue pour la bannière", () => {
    const long = `### English\n\n- ${"x".repeat(200)}`;
    const r = summariseNotes(long, "en");
    expect(r.length).toBe(90);
    expect(r.endsWith("…")).toBe(true);
  });
});
