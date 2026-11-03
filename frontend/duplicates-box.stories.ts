import type { Meta, StoryObj } from "@storybook/html-vite";
import type { DupScreenCopy, DupScreenGroup, Source } from "../shared/contracts";
import { initialPlan, recommendedCopy, toggleIssue, type Plan } from "./duplicates-model";
import { consequenceHtml, gridHtml, groupFactsHtml, keepButtonLabel, legendHtml, queueRowHtml } from "./duplicates-rows";
import { T } from "./i18n/duplicates-view";

// L'écran Doublons en option B (`frontend/duplicates-view.ts`, spec `docs/ui-specs/doublons.md`
// § Layout, décidée le 2026-10-30) : la file de groupes et la boîte du groupe ouvert. Ces stories
// EXÉCUTENT le vrai rendu de `duplicates-rows.ts`, le module pur que la vue appelle aussi. La story
// ne fournit que de la DONNÉE (des `DupScreenGroup`, tels que le backend les rend) et le plan.
//
// Les groupes reprennent ceux des maquettes du 2026-10-05 : noms inventés, cas réels — qualité
// différente, .aif / .aiff, copie de Rekordbox, À vérifier, tronquée, identiques, introuvable, et un
// groupe de quatre copies pour le défilement horizontal de la grille.
//
// Aucune couleur, aucune taille ici : toutes les classes viennent de `frontend/styles.css`.
//
// ÉTATS NON REPRÉSENTÉS : l'en-tête et le lecteur de la boîte (`openReportInto`, qui demande
// l'IPC), le résumé du mode Lot, la confirmation et la feuille de progression (des gestes).

const sources: Source[] = [
  { id: 1, path: "E:\\Soulseek", watched: true, color_key: null } as Source,
  { id: 2, path: "D:\\MUSIQUE A TRIER", watched: true, color_key: null } as Source,
];

let nextId = 1;
const copy = (path: string, over: Partial<DupScreenCopy> = {}): DupScreenCopy => ({
  id: nextId++,
  path,
  status: "pending",
  source_id: path.startsWith("E:") ? 1 : 2,
  verdict: "ok",
  cutoff_hz: 20_000,
  format: path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
  bitrate: 1411,
  sample_rate: 44_100,
  duration: 412,
  size_bytes: 72_000_000,
  truncated: false,
  missing: false,
  keepable: !over.missing && !over.truncated,
  discogs_release_id: null,
  year: null,
  rekordbox: { state: "absent" },
  keep: false,
  tied_with_best: false,
  name_key: "",
  ...over,
});

const group = (copies: DupScreenCopy[], over: Partial<DupScreenGroup>): DupScreenGroup => ({
  id: Math.min(...copies.map((c) => c.id)),
  artist: "",
  title: "",
  version: null,
  proof: "same_name",
  to_check: false,
  duration_spread: 0,
  copies,
  links: [],
  ...over,
});

const S = "E:\\Soulseek";
const M = "D:\\MUSIQUE A TRIER";

const mira = group(
  [
    copy(`${M}\\Promos 2024\\Mira Lune - Night Transit.mp3`, {
      keep: true,
      bitrate: 320,
      size_bytes: 14_900_000,
      cutoff_hz: 19_900,
      discogs_release_id: "1",
      year: 2024,
      rekordbox: { state: "present", playlists: 2 },
    }),
    copy(`${S}\\Mira Lune\\Night Transit.flac`, { verdict: "fake", cutoff_hz: 16_000, size_bytes: 38_900_000 }),
    copy(`${M}\\BACKUP USB\\Mira Lune - Night Transit.mp3`, { bitrate: 320, size_bytes: 14_900_000, cutoff_hz: 19_900 }),
  ],
  { artist: "Mira Lune", title: "Night Transit", proof: "same_sound" },
);
mira.links = [{ a: mira.copies[0].id, b: mira.copies[1].id, kind: "same_sound", similarity: 0.98 }];
const halden = group(
  [
    copy(`${S}\\Halden\\Halden - Rivers (Original Mix).aiff`, { keep: true, duration: 418 }),
    copy(`${M}\\BACKUP USB\\Halden - Rivers (Original Mix).mp3`, { bitrate: 320, duration: 462 }),
  ],
  { artist: "Halden", title: "Rivers", version: "Original Mix", to_check: true, duration_spread: 44 },
);
const kovacs = group(
  [
    copy(`${S}\\Kovacs\\Kovacs - Paper Lanterns.mp3`, { keep: true, bitrate: 320 }),
    copy(`${M}\\BACKUP USB\\Kovacs - Paper Lanterns.mp3`, { bitrate: 320 }),
    copy(`${M}\\Albums\\Kovacs - Paper Lanterns.mp3`, { bitrate: 320, duration: 221, truncated: true }),
    copy(`${S}\\old\\Kovacs - Paper Lanterns.mp3`, { bitrate: 320, missing: true }),
  ],
  { artist: "Kovacs", title: "Paper Lanterns", proof: "identical" },
);

const ALL = [mira, halden, kovacs];

function mount(html: string): HTMLElement {
  const w = document.createElement("div");
  w.innerHTML = html;
  return w;
}

function boxHtml(g: DupScreenGroup, plan: Plan, cursor = recommendedCopy(g, plan).id): string {
  const t = T();
  return (
    `<div class="mid" style="width:960px"><div class="sift-dupb">` +
    `<div class="sift-filbox-settings">${groupFactsHtml(g)}${gridHtml(g, plan, cursor, sources)}${consequenceHtml(g, plan)}</div>` +
    `<div class="sift-filbox-foot"><span class="sift-rail-kbd">${legendHtml()}</span>` +
    `<div class="sift-rail-abtns"><button type="button" class="sift-baction">${t.notDupsButton}</button>` +
    `<button type="button" class="sift-ranger-btn">${keepButtonLabel(g, plan)}</button></div></div>` +
    `</div></div>`
  );
}

const meta: Meta = {
  title: "Écrans/Doublons/File de tri",
};
export default meta;
type Story = StoryObj;

/** La file : une ligne par groupe, une pastille de verdict par copie, la preuve et les formats en
 *  dessous ; un groupe À vérifier le dit en encre d'avertissement. */
export const File: Story = {
  render: () =>
    mount(
      `<div class="queue" style="width:272px"><div>` +
        ALL.map((g, i) => queueRowHtml(g, { active: i === 0, checked: null })).join("") +
        `</div></div>`,
    ),
};

/** Le mode Lot : une case par ligne. */
export const FileLot: Story = {
  name: "File — mode Lot",
  render: () =>
    mount(
      `<div class="queue" style="width:272px"><div>` +
        ALL.map((g, i) => queueRowHtml(g, { active: false, checked: i !== 1 })).join("") +
        `</div></div>`,
    ),
};

/** Le groupe ouvert : la copie recommandée gardée, les deux autres à la Corbeille, la copie de
 *  Rekordbox qui part signalée sous la phrase. */
export const Groupe: Story = {
  render: () => mount(boxHtml(mira, initialPlan(ALL))),
};

/** Deux copies gardées : la phrase et le bouton suivent. */
export const DeuxGardees: Story = {
  name: "Deux copies gardées",
  render: () => {
    const plan = initialPlan(ALL);
    toggleIssue(mira, plan, mira.copies[2].id);
    return mount(boxHtml(mira, plan));
  },
};

/** À vérifier : toutes les copies gardées, Entrée = pas des doublons. */
export const AVerifier: Story = {
  name: "À vérifier",
  render: () => mount(boxHtml(halden, initialPlan(ALL))),
};

/** Quatre copies, dont une tronquée et une introuvable : la grille défile au-delà de trois. */
export const QuatreCopies: Story = {
  name: "Quatre copies",
  render: () => mount(boxHtml(kovacs, initialPlan(ALL))),
};
