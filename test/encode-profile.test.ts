// Réglages › Conversion (issue #71) : `frontend/encode-profile.ts`, le module pur qui décide ce que
// chaque rangée PROPOSE, comment elle l'écrit, et quel profil part au backend.
//
// Ce qui est tenu ici est ce qu'aucune compilation ne voit : une valeur de trop dans une liste est
// proposée à l'utilisateur puis refusée par le backend (`ENCODE_PROFILE_INVALID`) ; un 96 kHz en MP3
// serait refusé par l'encodeur lui-même ; un libellé « 44.1 kHz » en français, ou « 48,0 kHz »,
// dirait la valeur autrement que le reste de l'app ; une option allumée sur une valeur que le profil
// ne porte pas afficherait ce que la conversion ne fera pas.
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentLang } from "../frontend/i18n";
import type { EncodeProfile } from "../shared/contracts";
import { encodeRows, lossyFormatLabel, mp3FormatLabel, parseEncodeOption, withEncodeValue } from "../frontend/encode-profile";

/** Les défauts de la spec — ceux que le backend rend tant que rien n'est réglé. Ici seulement comme
 *  donnée d'essai : le module ne les connaît pas, et c'est voulu. */
const DEFAUTS: EncodeProfile = {
  mp3_kbps: 320,
  mp3_rate: 44100,
  aiff_bits: 16,
  aiff_rate: 44100,
  wav_bits: 16,
  wav_rate: 44100,
};

afterEach(() => setCurrentLang("fr"));

describe("rangées de Conversion", () => {
  it("six rangées, dans l'ordre de la spec, libellées « FORMAT · Grandeur »", () => {
    expect(encodeRows(DEFAUTS).map((r) => [r.field, r.label])).toEqual([
      ["mp3_kbps", "MP3 · Débit"],
      ["mp3_rate", "MP3 · Fréquence"],
      ["aiff_bits", "AIFF · Profondeur"],
      ["aiff_rate", "AIFF · Fréquence"],
      ["wav_bits", "WAV · Profondeur"],
      ["wav_rate", "WAV · Fréquence"],
    ]);
  });

  it("les valeurs proposées sont exactement celles de la spec — ni plus, ni moins", () => {
    const vals = Object.fromEntries(encodeRows(DEFAUTS).map((r) => [r.field, r.options.map((o) => o.value)]));
    expect(vals).toEqual({
      mp3_kbps: [256, 320],
      mp3_rate: [44100, 48000],
      aiff_bits: [16, 24],
      aiff_rate: [44100, 48000, 96000],
      wav_bits: [16, 24],
      wav_rate: [44100, 48000, 96000],
    });
  });

  it("jamais 96 kHz en MP3 : l'encodeur MP3 embarqué le refuse (mesuré)", () => {
    const mp3Rate = encodeRows(DEFAUTS).find((r) => r.field === "mp3_rate");
    expect(mp3Rate?.options.map((o) => o.value)).not.toContain(96000);
  });

  it("libellés en français : « 44,1 kHz », « 48 kHz » sans décimale inutile, « 16 bits »", () => {
    const labels = Object.fromEntries(encodeRows(DEFAUTS).map((r) => [r.field, r.options.map((o) => o.label)]));
    expect(labels).toEqual({
      mp3_kbps: ["256 kbps", "320 kbps"],
      mp3_rate: ["44,1 kHz", "48 kHz"],
      aiff_bits: ["16 bits", "24 bits"],
      aiff_rate: ["44,1 kHz", "48 kHz", "96 kHz"],
      wav_bits: ["16 bits", "24 bits"],
      wav_rate: ["44,1 kHz", "48 kHz", "96 kHz"],
    });
  });

  it("libellés en anglais : point décimal, « 24-bit », rangées traduites", () => {
    setCurrentLang("en");
    const rows = encodeRows(DEFAUTS);
    expect(rows.map((r) => r.label)).toEqual([
      "MP3 · Bitrate",
      "MP3 · Sample rate",
      "AIFF · Bit depth",
      "AIFF · Sample rate",
      "WAV · Bit depth",
      "WAV · Sample rate",
    ]);
    expect(rows.find((r) => r.field === "aiff_rate")?.options.map((o) => o.label)).toEqual([
      "44.1 kHz",
      "48 kHz",
      "96 kHz",
    ]);
    expect(rows.find((r) => r.field === "wav_bits")?.options.map((o) => o.label)).toEqual(["16-bit", "24-bit"]);
  });

  it("la phrase des 96 kHz se pose sur les rangées qui les proposent, et seulement elles", () => {
    const notes = Object.fromEntries(encodeRows(DEFAUTS).map((r) => [r.field, r.note]));
    expect(notes.aiff_rate).toContain("96 kHz");
    expect(notes.aiff_rate).toContain("2016");
    expect(notes.wav_rate).toBe(notes.aiff_rate);
    for (const f of ["mp3_kbps", "mp3_rate", "aiff_bits", "wav_bits"]) expect(notes[f], f).toBeNull();
  });

  it("une seule option allumée par rangée : celle du profil", () => {
    const p: EncodeProfile = { mp3_kbps: 256, mp3_rate: 48000, aiff_bits: 24, aiff_rate: 96000, wav_bits: 16, wav_rate: 48000 };
    const on = Object.fromEntries(
      encodeRows(p).map((r) => [r.field, r.options.filter((o) => o.on).map((o) => o.value)]),
    );
    expect(on).toEqual({
      mp3_kbps: [256],
      mp3_rate: [48000],
      aiff_bits: [24],
      aiff_rate: [96000],
      wav_bits: [16],
      wav_rate: [48000],
    });
  });

  it("une valeur du profil hors liste n'allume RIEN — pas la plus proche", () => {
    const p: EncodeProfile = { ...DEFAUTS, mp3_kbps: 192, aiff_rate: 88200 };
    const rows = encodeRows(p);
    expect(rows.find((r) => r.field === "mp3_kbps")?.options.some((o) => o.on)).toBe(false);
    expect(rows.find((r) => r.field === "aiff_rate")?.options.some((o) => o.on)).toBe(false);
    // Les autres rangées ne sont pas touchées par l'écart d'une seule.
    expect(rows.find((r) => r.field === "wav_rate")?.options.filter((o) => o.on).map((o) => o.value)).toEqual([44100]);
  });
});

describe("relecture d'un clic", () => {
  it("rend le champ et la valeur quand les deux sont dans la liste", () => {
    expect(parseEncodeOption("mp3_kbps", "256")).toEqual({ field: "mp3_kbps", value: 256 });
    expect(parseEncodeOption("wav_rate", "96000")).toEqual({ field: "wav_rate", value: 96000 });
  });

  it("refuse une valeur hors liste — jamais corrigée vers la plus proche", () => {
    expect(parseEncodeOption("mp3_kbps", "128")).toBeNull();
    expect(parseEncodeOption("mp3_rate", "96000")).toBeNull();
    expect(parseEncodeOption("aiff_bits", "32")).toBeNull();
  });

  it("refuse ce qui n'est pas écrit en chiffres seuls", () => {
    for (const raw of ["", " 320", "320 ", "320.0", "3.2e2", "0x140", "-320", undefined]) {
      expect(parseEncodeOption("mp3_kbps", raw), String(raw)).toBeNull();
    }
  });

  it("refuse un champ inconnu ou absent", () => {
    expect(parseEncodeOption("flac_bits", "16")).toBeNull();
    expect(parseEncodeOption(undefined, "320")).toBeNull();
    expect(parseEncodeOption("toString", "320")).toBeNull();
  });
});

describe("profil envoyé", () => {
  it("change le seul champ cliqué et garde les cinq autres", () => {
    expect(withEncodeValue(DEFAUTS, "aiff_rate", 48000)).toEqual({ ...DEFAUTS, aiff_rate: 48000 });
  });

  it("ne touche pas le profil confirmé — c'est lui qu'on retrouve si l'écriture échoue", () => {
    const confirme = { ...DEFAUTS };
    withEncodeValue(confirme, "mp3_kbps", 256);
    expect(confirme).toEqual(DEFAUTS);
  });
});

describe("format lossy du mode Lot", () => {
  it("dit le débit réglé", () => {
    expect(mp3FormatLabel(320)).toBe("MP3 320");
    expect(mp3FormatLabel(256)).toBe("MP3 256");
  });

  it("sans profil lu, « MP3 » sans débit — jamais un 320 supposé", () => {
    expect(mp3FormatLabel(null)).toBe("MP3");
  });
});

// Relecture de #71 : un MP3 source est déplacé tel quel (par l'extension, comme
// `encode::is_conformant`) ; seuls AAC / OGG / Opus prennent le débit réglé.
describe("lossyFormatLabel — ce que le Lot annonce pour ses lossy", () => {
  afterEach(() => setCurrentLang("fr"));

  it("des MP3 seuls : « tel quel », jamais le débit réglé", () => {
    expect(lossyFormatLabel(["/a/x.mp3", "/a/y.MP3"], 256)).toBe("MP3 tel quel");
  });

  it("des AAC / OGG seuls : le débit réglé", () => {
    expect(lossyFormatLabel(["/a/x.m4a", "/a/y.ogg"], 256)).toBe("MP3 256");
  });

  it("mélange : les deux, et un profil pas lu ne suppose aucun débit", () => {
    expect(lossyFormatLabel(["/a/x.mp3", "/a/y.opus"], 320)).toBe("MP3 tel quel + MP3 320");
    expect(lossyFormatLabel(["/a/y.aac"], null)).toBe("MP3");
  });

  it("anglais", () => {
    setCurrentLang("en");
    expect(lossyFormatLabel(["/a/x.mp3"], 256)).toBe("MP3 as is");
  });
});
