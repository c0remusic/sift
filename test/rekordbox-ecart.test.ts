// L'écart d'une rangée Métadonnées de l'écran Rekordbox (#81) : ce qui part, et ce qui ne part pas.
import { describe, expect, it } from "vitest";
import { clearedCount, metadataEcartHtml } from "../frontend/rekordbox-ecart";
import { SYNC_CLEARED_FIELDS } from "../shared/contracts";

const row = (over: Partial<Parameters<typeof metadataEcartHtml>[0]> = {}) => ({
  new_artist: "Fingers Inc.",
  new_title: "Mystery Of Love (Club Mix)",
  new_genre: null,
  new_year: null,
  new_label: null,
  cleared: [],
  ...over,
});

describe("écart d'une synchro de métadonnées", () => {
  it("sans champ vidé : les valeurs seules, dans l'ordre", () => {
    expect(metadataEcartHtml(row({ new_year: 1986, new_label: "Trax" }))).toBe(
      "Artiste Fingers Inc. · Titre Mystery Of Love (Club Mix) · Année 1986 · Label Trax",
    );
  });

  it("les champs vidés passent EN TÊTE, en signal, avant les valeurs", () => {
    const html = metadataEcartHtml(row({ cleared: ["label", "year"] }));
    expect(html.startsWith('<span class="rkb-cand-cleared">À vider : label, année</span> · ')).toBe(true);
    expect(html).toContain("Artiste Fingers Inc.");
  });

  it("chaque champ du protocole a son nom affiché", () => {
    const html = metadataEcartHtml(row({ cleared: [...SYNC_CLEARED_FIELDS] }));
    expect(html).toContain("À vider : label, année, genre, pochette");
  });

  it("les valeurs sont échappées", () => {
    expect(metadataEcartHtml(row({ new_label: "<b>x</b>" }))).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("la confirmation compte les champs vidés des seules rangées synchronisées", () => {
    const rows = [
      { id: 1, cleared: ["label", "year"] as ("label" | "year")[] },
      { id: 2, cleared: [] },
      { id: 3, cleared: ["cover"] as "cover"[] },
    ];
    expect(clearedCount(rows, [1, 2, 3])).toBe(3);
    expect(clearedCount(rows, [2, 3])).toBe(1);
    expect(clearedCount(rows, [])).toBe(0);
  });

  it("rien du tout : le repli « Tags »", () => {
    expect(metadataEcartHtml(row({ new_artist: null, new_title: null }))).toBe("Tags");
  });
});
