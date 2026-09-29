import type { Meta, StoryObj } from "@storybook/html-vite";
import type { Candidate } from "./ipc";
import { chosenRowHtml, renderCandidates } from "./identify-shared";

// La ligne de la release choisie et la liste qu'elle rouvre (#68), cataloguées dans
// `design-system-states.md` § « Ligne de la release choisie ». Ces stories EXÉCUTENT le vrai rendu
// (`chosenRowHtml`, `renderCandidates`) au lieu d'en recopier le markup — modèle
// `notice-banner.stories.ts`. Les pochettes sont absentes (Storybook n'a pas Discogs) : c'est le
// repli vinyle qui se peint, comme pour une release sans image.

const cand = (release_id: string, title: string, label: string, year: number, country: string, format: string): Candidate => ({
  artist: "Larry Heard",
  title,
  label,
  year,
  styles: ["Deep House"],
  country,
  format,
  cover_url: null,
  release_id,
  source: "discogs",
});

const LIST: Candidate[] = [
  cand("1", "Mystery of Love", "Alleviated Records", 1986, "US", 'Vinyl, 12"'),
  cand("2", "Mystery of Love (Club Mix)", "Trax Records", 1987, "US", 'Vinyl, 12"'),
  cand("3", "Mystery of Love", "Alleviated Records", 2014, "US", "File, FLAC"),
  cand("4", "Mystery of Love (Remastered)", "Rush Hour", 2021, "NL", "Vinyl, LP, Compilation"),
];

const chosen = {
  artist: "Larry Heard",
  title: "Mystery of Love (Club Mix)",
  sub: "Trax Records · 1987 · US · Vinyl, 12\"",
  coverSrc: null,
};

function host(fill: (el: HTMLElement) => void): HTMLElement {
  // Largeur de la zone D (`--aside-w`), où vit la fiche de la Bibliothèque ; l'hôte porte les
  // classes réelles.
  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:var(--aside-w);padding:var(--space-16);background:var(--color-background-primary)";
  const el = document.createElement("div");
  el.className = "sift-cands sift-cands-host";
  wrap.appendChild(el);
  fill(el);
  return wrap;
}

const meta: Meta = { title: "Revue/Release choisie" };
export default meta;
type Story = StoryObj;

export const Inerte: Story = {
  name: "Inerte — aucune liste en mémoire",
  render: () => host((el) => (el.innerHTML = chosenRowHtml(chosen))),
};

export const Controle: Story = {
  name: "Contrôle — « 3 autres »",
  render: () => host((el) => (el.innerHTML = chosenRowHtml(chosen, LIST.length - 1))),
};

export const UneAutre: Story = {
  name: "Contrôle — « 1 autre »",
  render: () => host((el) => (el.innerHTML = chosenRowHtml(chosen, 1))),
};

export const ListeRouverte: Story = {
  name: "Liste rouverte — la release appliquée sélectionnée",
  render: () => host((el) => renderCandidates(el, LIST, 1)),
};

export const Ecriture: Story = {
  name: "Écriture en cours — liste inerte, ligne estompée",
  render: () =>
    host((el) => {
      renderCandidates(el, LIST, 1);
      el.querySelector(".sift-cands-list")?.classList.add("sift-cands-busy");
      el.querySelector('[data-cand="3"]')?.classList.add("sift-cand-pending");
    }),
};
