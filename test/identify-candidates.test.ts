// La mémoire de session des candidats Discogs (#68) et le titre affiché pour un candidat.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../frontend/ipc";
import {
  appliedIndex,
  candidatesFor,
  markApplied,
  otherCount,
  rememberCandidates,
  shownTitle,
} from "../frontend/identify-candidates";

const cand = (release_id: string, title = "Mystery of Love"): Candidate => ({
  artist: "Larry Heard",
  title,
  label: null,
  year: null,
  styles: [],
  country: null,
  format: null,
  cover_url: null,
  release_id,
  source: "discogs",
});

describe("mémoire des candidats", () => {
  it("compte les AUTRES releases : la release appliquée ne se compte pas", () => {
    const s = rememberCandidates(1, [cand("a"), cand("b"), cand("c")], null);
    expect(otherCount(s)).toBe(3);
    expect(appliedIndex(s)).toBe(-1);
    markApplied(1, "b");
    expect(appliedIndex(s)).toBe(1);
    expect(otherCount(s)).toBe(2);
  });

  it("une seule release, appliquée : rien d'autre à proposer, la ligne reste inerte", () => {
    const s = rememberCandidates(2, [cand("a")], null);
    markApplied(2, "a");
    expect(otherCount(s)).toBe(0);
    expect(otherCount(null)).toBe(0);
  });

  it("une nouvelle recherche garde la release appliquée, même absente de la nouvelle liste", () => {
    rememberCandidates(3, [cand("a"), cand("b")], null);
    markApplied(3, "b");
    const s = rememberCandidates(3, [cand("x"), cand("y")], "Dub");
    expect(s.appliedId).toBe("b");
    expect(appliedIndex(s)).toBe(-1);
    expect(otherCount(s)).toBe(2);
    expect(candidatesFor(3)?.fallbackVersion).toBe("Dub");
  });

  it("un « Rétablir » vers une release inconnue de la liste remet la ligne à « aucune appliquée »", () => {
    const s = rememberCandidates(4, [cand("a"), cand("b")], null);
    markApplied(4, "a");
    markApplied(4, null);
    expect(appliedIndex(s)).toBe(-1);
    expect(otherCount(s)).toBe(2);
  });

  it("marquer une piste sans liste ne crée rien", () => {
    markApplied(5, "a");
    expect(candidatesFor(5)).toBeNull();
  });
});

describe("titre affiché pour un candidat", () => {
  it("la parenthèse finale du titre Discogs devient la version", () => {
    expect(shownTitle(cand("a", "Love Foolosophy (Knee Deep Remix)"), "Original Mix")).toEqual({
      title: "Love Foolosophy",
      version: "Knee Deep Remix",
    });
  });

  it("sans parenthèse, la version d'avant la recherche sert, mise en capitales de mots", () => {
    expect(shownTitle(cand("a", "Mystery of Love"), "original mix")).toEqual({
      title: "Mystery of Love",
      version: "Original Mix",
    });
    expect(shownTitle(cand("a", "Mystery of Love"), null)).toEqual({ title: "Mystery of Love", version: null });
    expect(shownTitle(cand("a", "Mystery of Love"), "  ")).toEqual({ title: "Mystery of Love", version: null });
  });

  it("une parenthèse seule reste le titre : un titre vide serait refusé par apply_release", () => {
    expect(shownTitle(cand("a", "(Untitled)"), null)).toEqual({ title: "(Untitled)", version: null });
  });

  it("les sigles et capitales survivent à la mise en capitales", () => {
    expect(shownTitle(cand("a", "Track (2WFU dub)"), null).version).toBe("2WFU Dub");
  });
});
