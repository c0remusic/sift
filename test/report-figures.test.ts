import { describe, expect, it } from "vitest";
import {
  DURATION_MISMATCH_SEC,
  HF_REF_HI,
  HF_REF_LO,
  durationText,
  hfDensityText,
} from "../frontend/report-figures";

// `fmt` est injecté par report-view (virgule décimale française). Ici on en passe une version
// minimale : ce qui est testé est CE QUI EST DIT, pas le formatage des nombres.
const fmt = (v: number, d: number) => v.toFixed(d);

describe("densité de l'aigu", () => {
  it("dit la mesure ET sa référence — une valeur seule ne situe rien", () => {
    const t = hfDensityText(-3.2, fmt);
    expect(t).toContain("-3.2 dB");
    expect(t).toContain(String(HF_REF_LO));
    expect(t).toContain(String(HF_REF_HI));
  });

  it("situe sans juger : « dans » / « sous » la plage, jamais un verdict", () => {
    expect(hfDensityText(-3.2, fmt)).toContain("dans la plage");
    expect(hfDensityText(-12.4, fmt)).toContain("sous la plage");
  });

  // Le risque réel de cette ligne n'est pas un mauvais chiffre, c'est un mot qui transforme une
  // mesure en accusation. Un master volontairement sombre donne la même valeur qu'un transcodage :
  // le texte ne doit donc RIEN affirmer sur l'histoire du fichier.
  it("n'accuse jamais, même très en dessous de la plage", () => {
    const t = hfDensityText(-43.8, fmt).toLowerCase();
    for (const mot of ["fake", "faux", "suspect", "transcod", "mp3", "lossy"]) {
      expect(t).not.toContain(mot);
    }
  });

  it("la borne basse elle-même compte comme DANS la plage", () => {
    // Elle est le minimum OBSERVÉ chez les authentiques, donc un fichier qui l'atteint exactement
    // est encore un cas connu — l'exclure inventerait une sévérité que la mesure ne porte pas.
    expect(hfDensityText(HF_REF_LO, fmt)).toContain("dans la plage");
  });
});

describe("durée", () => {
  it("ne montre que la durée déclarée quand les deux s'accordent", () => {
    expect(durationText(212.4, 212.4, fmt)).toBe("212.4 s");
  });

  it("tolère l'écart de bourrage d'encodeur sans le montrer", () => {
    const justeEnDessous = 212.4 - DURATION_MISMATCH_SEC + 0.01;
    expect(durationText(212.4, justeEnDessous, fmt)).toBe("212.4 s");
  });

  it("montre les deux quand elles divergent — c'est le désaccord qui informe", () => {
    const t = durationText(400.0, 40.0, fmt);
    expect(t).toContain("400.0 s annoncée");
    expect(t).toContain("40.0 s réellement décodée");
  });

  // Un rapport écrit avant que la mesure existe porte 0 (le `#[serde(default)]` côté Rust).
  // L'afficher dirait « 0 s réellement décodée » sur un fichier parfaitement sain : une absence
  // de mesure présentée comme une mesure, exactement le défaut que ce dépôt corrige partout.
  it("traite 0 comme « pas mesuré », jamais comme une durée nulle", () => {
    expect(durationText(212.4, 0, fmt)).toBe("212.4 s");
  });
});
