import { describe, expect, it } from "vitest";
import { actionsSecondairesHtml, gesteDeTouche, suiteCorbeille } from "../frontend/revue-gestes";

describe("gestes secondaires de Revue", () => {
  it("⌫ et X mettent à la corbeille, jamais en liste d'achat", () => {
    for (const k of ["Backspace", "x", "X"]) expect(gesteDeTouche(k)).toBe("trash");
  });

  it("R re-source", () => {
    for (const k of ["r", "R"]) expect(gesteDeTouche(k)).toBe("resource");
  });

  it("les autres touches ne portent aucun geste", () => {
    for (const k of ["Enter", " ", "i", "Delete"]) expect(gesteDeTouche(k)).toBeNull();
  });

  it("une piste que Rekordbox joue se confirme, un doute se dit, une absence passe", () => {
    expect(suiteCorbeille({ state: "present", playlists: 0 })).toBe("confirmer");
    expect(suiteCorbeille({ state: "present", playlists: 3 })).toBe("confirmer");
    expect(suiteCorbeille({ state: "absent" })).toBe("direct");
    expect(suiteCorbeille({ state: "unknown" })).toBe("noter");
    expect(suiteCorbeille({ state: "unverified", reason: "rekordbox_open" })).toBe("noter");
    expect(suiteCorbeille({ state: "unverified", reason: "xml_snapshot" })).toBe("noter");
  });

  it("les deux boutons sont là, Re-source avant Corbeille", () => {
    const html = actionsSecondairesHtml({
      resource: "Re-source",
      resourceTitle: "titre 1",
      trash: "Corbeille",
      trashTitle: "titre 2",
    });
    const r = html.indexOf('data-fil="resource"');
    const t = html.indexOf('data-fil="trash"');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(t).toBeGreaterThan(r);
  });
});
