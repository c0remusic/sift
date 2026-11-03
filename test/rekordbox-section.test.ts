// Ce qu'une section de l'écran Rekordbox affiche (`rekordbox-section.ts`), issue #84.
//
// Mesuré le 2026-11-03 : XML lié, `master.db` introuvable. Les listes d'attente Fichiers,
// Métadonnées et Pochettes lisent la base de Sift, pas `master.db` : leurs appels RÉUSSISSENT et
// rendent `[]`. La colonne B′ disait donc « 0 » pour trois sections sur quatre — « rien en
// attente » — alors que sans `master.db` aucun détecteur ne peut rien détecter.
import { describe, expect, it } from "vitest";
import { sectionView } from "../frontend/rekordbox-section";

describe("sectionView", () => {
  it("section saine : son compte, son contenu", () => {
    expect(sectionView({ callFailed: false, unavailable: false, count: 3 })).toEqual({ error: false, count: "3" });
    expect(sectionView({ callFailed: false, unavailable: false, count: 0 })).toEqual({ error: false, count: "0" });
  });

  it("appel tombé : « — » et le message, jamais « 0 »", () => {
    expect(sectionView({ callFailed: true, unavailable: false, count: 0 })).toEqual({ error: true, count: "—" });
  });

  it("synchronisation indisponible : « — » et le message même quand l'appel a réussi (#84)", () => {
    expect(sectionView({ callFailed: false, unavailable: true, count: 0 })).toEqual({ error: true, count: "—" });
  });

  it("synchronisation indisponible : des rangées d'avant restent masquées (décision d'Antoine, 2026-11-03)", () => {
    expect(sectionView({ callFailed: false, unavailable: true, count: 5 })).toEqual({ error: true, count: "—" });
  });
});
