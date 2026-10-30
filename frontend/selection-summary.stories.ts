import type { Meta, StoryObj } from "@storybook/html-vite";
import type { QueueItem } from "../shared/contracts";
import { selectionSummaryHtml } from "./selection-summary";

// Le résumé de sélection du mode Lot (zone C), catalogué dans `design-system-states.md` § Ligne de
// queue. Ces stories EXÉCUTENT le vrai rendu (`selectionSummaryHtml`, module pur sans `./ipc`) au
// lieu d'en recopier le markup — modèle `queue-verdict-dot.stories.ts`.
//
// État du 2026-10-30 : Écarter et Envoyer à la corbeille portent sur TOUTE la sélection et restent
// actifs sans faux ; seul Convertir se grise, quand la sélection n'a que des faux.

const piste = (id: number, verdict: QueueItem["verdict"]): QueueItem => ({
  id,
  path: `/musique/piste-${id}.aiff`,
  filename: `piste-${id}.aiff`,
  source_id: 1,
  verdict,
  rail: "lossless",
  artist: null,
  title: null,
  dup: false,
  needs_analysis: verdict === null,
  analysis_attempts: 0,
  duration: 360,
  bitrate: null,
  declared_fmt: "aiff",
  is_new: false,
});

function host(selected: QueueItem[]): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "padding:var(--space-16)";
  el.innerHTML = selectionSummaryHtml(selected);
  return el;
}

const meta: Meta = { title: "Revue/Résumé de sélection (mode Lot)" };
export default meta;
type Story = StoryObj;

export const Vide: Story = { render: () => host([]) };
export const CinqPistesSansFaux: Story = {
  render: () => host([1, 2, 3, 4, 5].map((id) => piste(id, "ok"))),
};
export const Melangee: Story = {
  render: () => host([piste(1, "ok"), piste(2, "fake"), piste(3, "grey"), piste(4, null)]),
};
export const QueDesFaux: Story = {
  render: () => host([piste(1, "fake"), piste(2, "fake")]),
};
