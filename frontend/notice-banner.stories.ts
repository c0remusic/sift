import type { Meta, StoryObj } from "@storybook/html-vite";
import { noticeBannerHtml } from "./notice-banner";
import { T as FilingT } from "./i18n/filing";

// Les bandeaux de la surface de travail de Revue, catalogués dans `design-system-states.md`
// § « Bandeaux de Revue ». Ces stories EXÉCUTENT le vrai rendu (`noticeBannerHtml`, module pur) et
// les vrais textes du dictionnaire, au lieu d'en recopier le markup — modèle
// `queue-verdict-dot.stories.ts`.

function host(inner: string): HTMLElement {
  // Largeur d'une zone C étroite : le bandeau prend la largeur de la surface de travail.
  const el = document.createElement("div");
  el.style.cssText = "max-width:640px;padding:var(--space-16);background:var(--color-background-primary)";
  el.innerHTML = inner;
  return el;
}

const meta: Meta = { title: "Revue/Bandeaux" };
export default meta;
type Story = StoryObj;

export const SousTroisCentVingt: Story = {
  name: "Sous 320 kbps (#69)",
  render: () =>
    host(
      noticeBannerHtml({
        tone: "warning",
        icon: "ti-alert-triangle",
        head: FilingT().clubHead,
        body: FilingT().clubBody,
      }),
    ),
};

export const DoublonSur: Story = {
  name: "Doublon confirmé au son",
  render: () =>
    host(
      noticeBannerHtml({ tone: "warning", icon: "ti-copy", head: FilingT().dupSure, body: FilingT().dupFiled("House/Artiste - Titre.aiff") }),
    ),
};

export const DoublonPossible: Story = {
  name: "Doublon possible (même nom)",
  render: () =>
    host(
      noticeBannerHtml({ tone: "neutral", icon: "ti-copy", head: FilingT().dupMaybe, body: FilingT().dupPending("Artiste - Titre.mp3") }),
    ),
};
