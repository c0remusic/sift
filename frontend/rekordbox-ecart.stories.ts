import type { Meta, StoryObj } from "@storybook/html-vite";
import { candidateRowHtml, metadataEcartHtml } from "./rekordbox-ecart";

// Les rangées Métadonnées de l'écran Rekordbox, cataloguées dans `design-system-states.md` §
// Rekordbox. Ces stories EXÉCUTENT le vrai rendu (`candidateRowHtml`, `metadataEcartHtml`) au lieu
// d'en recopier le markup — modèle `notice-banner.stories.ts`.

const base = {
  new_artist: "Fingers Inc.",
  new_title: "Mystery Of Love (Club Mix)",
  new_genre: "House; Deep House",
  new_year: 1986,
  new_label: "D.J. International Records",
  cleared: [] as ("label" | "year" | "genre" | "cover")[],
};

function host(inner: string): HTMLElement {
  // Largeur de la zone C de l'écran Rekordbox (`.rkb-main` borné à --measure-data).
  const el = document.createElement("div");
  el.style.cssText = "max-width:var(--measure-data);padding:var(--space-16);background:var(--color-background-primary)";
  el.innerHTML = inner;
  return el;
}

const meta: Meta = { title: "Rekordbox/Rangée Métadonnées" };
export default meta;
type Story = StoryObj;

export const EnAttente: Story = {
  name: "En attente",
  render: () =>
    host(candidateRowHtml("mdspick", 'data-id="1"', false, "Fingers Inc. — Mystery Of Love", metadataEcartHtml(base), undefined)),
};

export const ChampsVides: Story = {
  name: "Champs à vider dans Rekordbox (#81)",
  render: () =>
    host(
      candidateRowHtml(
        "mdspick",
        'data-id="2"',
        true,
        "Mr. Fingers — Mystery Of Love",
        metadataEcartHtml({ ...base, new_genre: null, new_year: null, new_label: null, cleared: ["label", "year", "cover"] }),
        undefined,
      ),
    ),
};

export const EnErreur: Story = {
  name: "Échec de synchronisation",
  render: () =>
    host(
      candidateRowHtml(
        "mdspick",
        'data-id="3"',
        false,
        "Fingers Inc. — Mystery Of Love",
        metadataEcartHtml(base),
        "Rekordbox est ouvert — ferme-le avant de synchroniser",
      ),
    ),
};
