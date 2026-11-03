// Le modèle de l'écran Doublons (`frontend/duplicates-model.ts`) : le plan, l'encre de différence,
// « Préférer ce dossier », les filtres, et l'option B — Issue, conséquence d'un groupe, Lot.
import { describe, expect, it } from "vitest";
import {
  copyIssue,
  differingFields,
  filterCounts,
  groupFormats,
  groupOutcome,
  initialPlan,
  isKept,
  lotSummary,
  preferFolder,
  rebasePlan,
  recommendedCopy,
  ruleReason,
  toggleIssue,
  unverifiedRekordbox,
  visibleGroups,
} from "../frontend/duplicates-model";
import type { DupScreenCopy, DupScreenGroup } from "../shared/contracts";

const copy = (id: number, path: string, over: Partial<DupScreenCopy> = {}): DupScreenCopy => ({
  id,
  path,
  status: "pending",
  source_id: 1,
  verdict: "ok",
  cutoff_hz: 20_000,
  format: path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
  bitrate: 1411,
  sample_rate: 44_100,
  duration: 300,
  size_bytes: 50_000_000,
  truncated: false,
  missing: false,
  // Ce que le backend calcule pour une copie isolée ; le cas « toutes tronquées » se pose à la main.
  keepable: !over.missing && !over.truncated,
  discogs_release_id: null,
  year: null,
  rekordbox: { state: "absent" },
  keep: false,
  tied_with_best: false,
  name_key: "a b",
  ...over,
});

const group = (id: number, copies: DupScreenCopy[], over: Partial<DupScreenGroup> = {}): DupScreenGroup => ({
  id,
  artist: "Aldo Ostrova",
  title: "Subzero",
  version: "Original Mix",
  proof: "same_name",
  to_check: false,
  duration_spread: 0,
  copies,
  links: [],
  ...over,
});


describe("plan et effet d'un groupe", () => {
  it("le plan initial reprend les cases de la règle", () => {
    const g = group(1, [copy(1, "C:/a/x.mp3", { keep: true }), copy(2, "C:/b/x.wav")]);
    const plan = initialPlan([g]);
    expect(plan.get(1)).toBe(true);
    expect(plan.get(2)).toBe(false);
  });

  it("une copie absente ou tronquée n'est jamais gardée, même cochée dans le plan", () => {
    const absente = copy(1, "C:/a/x.mp3", { missing: true });
    const tronquee = copy(2, "C:/a/y.mp3", { truncated: true });
    const plan = new Map([
      [1, true],
      [2, true],
    ]);
    expect(isKept(plan, absente)).toBe(false);
    expect(isKept(plan, tronquee)).toBe(false);
  });

  it("une tronquée que le backend dit gardable (toutes le sont) se garde", () => {
    const tronquee = copy(2, "C:/a/y.mp3", { truncated: true, keepable: true });
    expect(isKept(new Map([[2, true]]), tronquee)).toBe(true);
    expect(isKept(new Map([[2, false]]), tronquee)).toBe(false);
  });

});

describe("encre de différence", () => {
  it("une paire .aif / .aiff du même dossier : seuls le format et le fichier diffèrent", () => {
    const g = group(1, [copy(1, "C:/a/Bram - Lost.aiff"), copy(2, "C:/a/Bram - Lost.aif")]);
    expect([...differingFields(g)].sort()).toEqual(["file", "format"]);
  });

  it("une durée qui s'affiche pareil ne diffère pas", () => {
    const g = group(1, [copy(1, "C:/a/x.mp3", { duration: 300.2 }), copy(2, "C:/b/x.mp3", { duration: 299.9 })]);
    expect(differingFields(g).has("duration")).toBe(false);
    expect(differingFields(g).has("folder")).toBe(true);
  });
});

describe("Préférer ce dossier", () => {
  it("recoche la copie du dossier dans les groupes à égalité, et seulement eux", () => {
    const egalite = group(1, [
      copy(1, "C:/x/Jay - A.aiff", { keep: true, tied_with_best: true }),
      copy(2, "D:/vintage/Jay - A.aiff", { tied_with_best: true }),
    ]);
    const moinsBonne = group(2, [
      copy(3, "C:/x/Jay - B.aiff", { keep: true, tied_with_best: true }),
      copy(4, "D:/vintage/Jay - B.mp3"),
    ]);
    const { plan, changed } = preferFolder([egalite, moinsBonne], initialPlan([egalite, moinsBonne]), "D:/vintage");
    expect(changed).toEqual([1]);
    expect(plan.get(2)).toBe(true);
    expect(plan.get(1)).toBe(false);
    expect(plan.get(4)).toBe(false);
    expect(plan.get(3)).toBe(true);
  });

  it("une copie que Rekordbox joue reste gardée", () => {
    const g = group(1, [
      copy(1, "C:/x/Jay - A.aiff", { keep: true, tied_with_best: true, rekordbox: { state: "present", playlists: 1 } }),
      copy(2, "D:/vintage/Jay - A.aiff", { tied_with_best: true }),
    ]);
    const { plan } = preferFolder([g], initialPlan([g]), "D:/vintage");
    expect(plan.get(1)).toBe(true);
    expect(plan.get(2)).toBe(true);
  });

  it("ne tranche pas un groupe À vérifier : celui-là se tranche à la main", () => {
    const g = group(
      1,
      [
        copy(1, "C:/x/Jay - A.wav", { keep: true, tied_with_best: true }),
        copy(2, "D:/vintage/Jay - A.wav", { tied_with_best: true, duration: 344 }),
      ],
      { to_check: true },
    );
    const { plan, changed } = preferFolder([g], initialPlan([g]), "D:/vintage");
    expect(changed).toEqual([]);
    // Option B : les deux copies d'un groupe À vérifier sont gardées par défaut, et y restent.
    expect(plan.get(1)).toBe(true);
    expect(plan.get(2)).toBe(true);
  });
});

describe("les copies que Rekordbox n'a pas pu vérifier", () => {
  it("se comptent, avec la raison, pour l'avertissement de la confirmation", () => {
    const ouvert = { state: "unverified", reason: "rekordbox_open" } as const;
    const copies = [
      copy(1, "C:/a/x.mp3", { rekordbox: ouvert }),
      copy(2, "C:/b/x.wav", { rekordbox: { state: "absent" } }),
      copy(3, "C:/c/x.flac", { rekordbox: ouvert }),
      copy(4, "C:/d/x.aiff", { rekordbox: { state: "unknown" } }),
    ];
    expect(unverifiedRekordbox(copies)).toEqual({ count: 2, reason: "rekordbox_open" });
  });

  it("rien à dire sans copie non vérifiée — ni pour « inconnue » (intégration inactive)", () => {
    expect(unverifiedRekordbox([copy(1, "C:/a/x.mp3", { rekordbox: { state: "unknown" } })])).toBeNull();
    expect(unverifiedRekordbox([])).toBeNull();
  });

});

describe("le plan rebasé sur des groupes relus", () => {
  it("une copie tranchée garde sa case quand la plus petite copie du groupe est partie", () => {
    // Avant : 10 médiocre, 20 WAV gardé par la règle, 30 MP3 gardé à la main ; 10 part.
    const avant = group(10, [
      copy(10, "C:/a/x.mp3", { verdict: "fake" }),
      copy(20, "C:/b/x.wav", { keep: true }),
      copy(30, "C:/c/x.mp3"),
    ]);
    const plan = initialPlan([avant]);
    plan.set(30, true);
    const decided = new Set([10, 20, 30]);
    const apres = group(20, [copy(20, "C:/b/x.wav", { keep: true }), copy(30, "C:/c/x.mp3")]);
    const r = rebasePlan([apres], plan, decided);
    expect(r.plan.get(30)).toBe(true);
    expect(r.touched).toEqual(new Set([20]));
    expect(r.decided).toEqual(new Set([20, 30]));
  });

  it("ce que l'utilisateur n'a pas tranché repart de la règle", () => {
    const g = group(1, [copy(1, "C:/a/x.wav", { keep: true }), copy(2, "C:/b/x.mp3")]);
    const plan = initialPlan([g]);
    plan.set(2, true);
    const r = rebasePlan([g], plan, new Set());
    expect(r.plan.get(2)).toBe(false);
    expect(r.touched.size).toBe(0);
  });
});

describe("la phrase de la règle", () => {
  it("suit l'ordre de la règle", () => {
    const mp3 = copy(1, "C:/a/x.mp3", { keep: true, bitrate: 320 });
    const flacFaux = copy(2, "C:/b/x.flac", { verdict: "fake", bitrate: 912 });
    const g = group(1, [mp3, flacFaux]);
    expect(ruleReason(g, mp3, flacFaux)).toBe("verdict");
    expect(ruleReason(g, mp3, copy(3, "C:/c/x.wav", { verdict: "grey" }))).toBe("verdict_grey");
    expect(ruleReason(g, mp3, copy(4, "C:/c/x.mp3", { missing: true }))).toBe("missing");
    expect(ruleReason(g, mp3, copy(5, "C:/c/x.mp3", { truncated: true }))).toBe("truncated");
  });

  it("le débit ne départage que deux lossy, la fréquence et l'extension viennent après", () => {
    const wav = copy(1, "C:/a/x.wav", { keep: true, bitrate: 1411 });
    const g = group(1, [wav]);
    expect(ruleReason(g, wav, copy(2, "C:/b/x.flac", { bitrate: 912 }))).toBe("tie");
    expect(ruleReason(g, wav, copy(3, "C:/b/x.mp3", { bitrate: 320 }))).toBe("lossless");
    const mp3 = copy(4, "C:/a/y.mp3", { keep: true, bitrate: 320 });
    expect(ruleReason(group(2, [mp3]), mp3, copy(5, "C:/b/y.mp3", { bitrate: 256 }))).toBe("bitrate");
    expect(ruleReason(g, wav, copy(6, "C:/b/x.wav", { sample_rate: 48_000 }))).toBe("rate");
    const aiff = copy(7, "C:/a/z.aiff", { keep: true });
    expect(ruleReason(group(3, [aiff]), aiff, copy(8, "C:/a/z.aif"))).toBe("aiff");
  });

  it("une copie gardée à la main ou par Rekordbox le dit", () => {
    const best = copy(1, "C:/a/x.mp3", { keep: true });
    const main = copy(2, "C:/b/x.wav");
    const rkb = copy(3, "C:/c/x.wav", { keep: true, rekordbox: { state: "present", playlists: 1 } });
    const g = group(1, [best, main, rkb]);
    expect(ruleReason(g, main, best)).toBe("user");
    expect(ruleReason(g, rkb, best)).toBe("rekordbox");
  });
});

describe("filtres, recherche, rangées", () => {
  const a = group(1, [copy(1, "C:/a/Aldo - Subzero.mp3"), copy(2, "C:/b/Aldo - Subzero.wav")], { proof: "identical" });
  const b = group(3, [copy(3, "C:/a/Béla - Été.mp3"), copy(4, "C:/b/Béla - Été.wav")], {
    artist: "Béla",
    title: "Été",
    version: null,
    to_check: true,
  });
  const c = group(5, [copy(5, "C:/a/Cielo - Overcast.wav", { rekordbox: { state: "present", playlists: 3 } }), copy(6, "C:/b/Cielo - Overcast.aiff")], {
    artist: "Cielo",
    title: "Overcast",
    proof: "same_sound",
  });

  it("chaque filtre compte ses groupes", () => {
    expect(filterCounts([a, b, c])).toEqual({
      all: 3,
      identical: 1,
      same_sound: 1,
      same_name: 1,
      to_check: 1,
      rekordbox: 1,
    });
  });

  it("la recherche ignore la casse et les accents", () => {
    expect(visibleGroups([a, b, c], "all", "ete").map((g) => g.id)).toEqual([3]);
    expect(visibleGroups([a, b, c], "all", "SUBZERO").map((g) => g.id)).toEqual([1]);
    expect(visibleGroups([a, b, c], "same_sound", "subzero")).toEqual([]);
  });

});

describe("option B : Issue, conséquence, Lot", () => {
  const trio = () =>
    group(1, [
      copy(1, "C:/a/x.mp3", { keep: true, size_bytes: 10 }),
      copy(2, "C:/b/x.flac", { size_bytes: 20, rekordbox: { state: "present", playlists: 2 } }),
      copy(3, "C:/c/x.mp3", { size_bytes: 30, tied_with_best: true }),
    ]);

  it("un groupe À vérifier garde toutes ses copies par défaut", () => {
    const g = group(1, [copy(1, "C:/a/x.mp3", { keep: true }), copy(2, "C:/b/x.mp3")], { to_check: true });
    expect(groupOutcome(g, initialPlan([g])).trashed).toEqual([]);
  });

  it("l'Issue nomme chaque copie : gardée, corbeille, introuvable, tronquée", () => {
    const g = group(1, [
      copy(1, "C:/a/x.mp3", { keep: true }),
      copy(2, "C:/b/x.mp3"),
      copy(3, "C:/c/x.mp3", { missing: true }),
      copy(4, "C:/d/x.mp3", { truncated: true }),
    ]);
    const plan = initialPlan([g]);
    expect(g.copies.map((c) => copyIssue(c, plan))).toEqual(["kept", "trash", "missing", "truncated"]);
  });

  it("la conséquence numérote les colonnes et compte les octets et Rekordbox", () => {
    const g = trio();
    const o = groupOutcome(g, initialPlan([g]));
    expect(o.kept).toEqual([1]);
    expect(o.trashed).toEqual([2, 3]);
    expect(o.bytes).toBe(50);
    expect(o.rekordbox).toEqual([{ n: 2, playlists: 2 }]);
  });

  it("basculer garde une copie de plus, mais jamais la dernière gardée", () => {
    const g = trio();
    const plan = initialPlan([g]);
    expect(toggleIssue(g, plan, 1)).toBe(false);
    expect(groupOutcome(g, plan).kept).toEqual([1]);
    expect(toggleIssue(g, plan, 3)).toBe(true);
    expect(groupOutcome(g, plan).kept).toEqual([1, 3]);
    expect(toggleIssue(g, plan, 1)).toBe(true);
    expect(groupOutcome(g, plan).kept).toEqual([3]);
  });

  it("une copie introuvable ou tronquée ne se bascule pas", () => {
    const g = group(1, [copy(1, "C:/a/x.mp3", { keep: true }), copy(2, "C:/b/x.mp3", { missing: true })]);
    const plan = initialPlan([g]);
    expect(toggleIssue(g, plan, 2)).toBe(false);
    expect(copyIssue(g.copies[1], plan)).toBe("missing");
  });

  it("le curseur s'ouvre sur la première copie gardée", () => {
    const g = group(1, [copy(1, "C:/a/x.mp3"), copy(2, "C:/b/x.mp3", { keep: true })]);
    expect(recommendedCopy(g, initialPlan([g])).id).toBe(2);
  });

  it("les formats d'un groupe, sans doublon, dans l'ordre", () => {
    expect(groupFormats(trio())).toBe("MP3, FLAC");
  });

  it("le Lot exclut les À vérifier et garde d'office ce que Rekordbox joue", () => {
    const g = trio();
    const doute = group(9, [copy(9, "C:/a/y.mp3", { keep: true }), copy(10, "C:/b/y.mp3")], { to_check: true });
    const plan = initialPlan([g, doute]);
    const avec = lotSummary([g, doute], plan, true);
    expect(avec.excluded).toBe(1);
    expect(avec.copies.map((c) => c.id)).toEqual([3]);
    expect(avec.bytes).toBe(30);
    expect(avec.rekordboxKept).toBe(1);
    expect(avec.ties).toBe(1);
    const sans = lotSummary([g, doute], plan, false);
    expect(sans.copies.map((c) => c.id)).toEqual([2, 3]);
    expect(sans.rekordboxKept).toBe(0);
  });
});
