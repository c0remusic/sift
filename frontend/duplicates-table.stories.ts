import type { Meta, StoryObj } from "@storybook/html-vite";
import type { DupScreenCopy, DupScreenGroup, Source } from "../shared/contracts";
import { flattenRows, initialPlan } from "./duplicates-model";
import { copyRowHtml, groupRowHtml, headHtml, legendHtml, type DupRowView } from "./duplicates-rows";

// La table de l'écran Doublons (`frontend/duplicates-view.ts`, spec `docs/ui-specs/doublons.md`,
// section « Doublons » de `docs/design-system-states.md`). Ces stories EXÉCUTENT le vrai rendu :
// `groupRowHtml` et `copyRowHtml` de `duplicates-rows.ts`, le module pur que la vue appelle aussi.
// La story ne fournit que de la DONNÉE (des `DupScreenGroup`, tels que le backend les rend) et un
// `DupRowView` (le plan, les groupes touchés, les sources, la copie ouverte).
//
// Les groupes reprennent ceux de la maquette hybride validée le 2026-10-05 : noms inventés, cas
// réels — qualité différente, .aif / .aiff, copie de Rekordbox, deux copies gardées, À vérifier,
// tronquée, identiques à l'octet, introuvable.
//
// Aucune couleur, aucune taille ici : toutes les classes viennent de `frontend/styles.css`.
//
// ÉTATS NON REPRÉSENTÉS : l'inspecteur (il monte le lecteur de Revue, `openReportInto`, qui demande
// l'IPC), la feuille de progression et la confirmation (des gestes, pas des états statiques).

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

const aldo = group(
  [
    copy(`${S}\\Aldo Ostrova\\Aldo Ostrova - Subzero (Original Mix).mp3`, { keep: true, bitrate: 320, size_bytes: 17_300_000, format: "mp3" }),
    copy(`${S}\\Ostgut rips\\Aldo Ostrova - Subzero (Original Mix).flac`, { verdict: "fake", cutoff_hz: 16_000, bitrate: 912, size_bytes: 49_200_000 }),
    copy(`${M}\\BACKUP USB\\Aldo Ostrova - Subzero (Original Mix).wav`, { verdict: "fake", cutoff_hz: 16_000, size_bytes: 76_200_000 }),
  ],
  { artist: "Aldo Ostrova", title: "Subzero", version: "Original Mix", proof: "same_sound" },
);
const bram = group(
  [
    copy(`${S}\\Bram Veit\\Bram Veit - Lost Signal.aiff`, { keep: true, tied_with_best: true }),
    copy(`${S}\\Bram Veit\\Bram Veit - Lost Signal.aif`, { tied_with_best: true }),
  ],
  { artist: "Bram Veit", title: "Lost Signal" },
);
const cielo = group(
  [
    copy(`${M}\\Melodic Techno\\Cielo Ferrin - Overcast (Extended Mix).wav`, { keep: true, rekordbox: { state: "present", playlists: 3 } }),
    copy(`${M}\\Cielo Ferrin\\Cielo Ferrin - Overcast (Extended Mix).aiff`, { keep: true }),
  ],
  { artist: "Cielo Ferrin", title: "Overcast", version: "Extended Mix" },
);
const halden = group(
  [
    copy(`${S}\\Halden\\Halden - Rivers (Original Mix).aiff`, { keep: true, duration: 418 }),
    copy(`${M}\\BACKUP USB\\Halden - Rivers (Original Mix).mp3`, { bitrate: 320, duration: 462, format: "mp3" }),
  ],
  { artist: "Halden", title: "Rivers", version: "Original Mix", to_check: true, duration_spread: 44 },
);
const kovacs = group(
  [
    copy(`${S}\\Kovacs\\Kovacs - Paper Lanterns.mp3`, { keep: true, bitrate: 320, duration: 400, format: "mp3" }),
    copy(`${M}\\BACKUP USB\\Kovacs - Paper Lanterns.mp3`, { bitrate: 320, duration: 221, truncated: true, format: "mp3" }),
  ],
  { artist: "Kovacs", title: "Paper Lanterns" },
);
const okami = group(
  [
    copy(`${S}\\Okami Sound\\Okami Sound - Tidewater.mp3`, { keep: true, bitrate: 320, format: "mp3" }),
    copy(`${M}\\BACKUP USB\\Okami Sound - Tidewater-1.mp3`, { bitrate: 320, format: "mp3" }),
  ],
  { artist: "Okami Sound", title: "Tidewater", proof: "identical" },
);
const pale = group(
  [
    copy(`${M}\\BACKUP USB\\Pale Circuit - Halcyon.aif`, { keep: true }),
    copy(`${S}\\Pale Circuit\\Pale Circuit - Halcyon.aiff`, { missing: true }),
  ],
  { artist: "Pale Circuit", title: "Halcyon" },
);

const ALL = [aldo, bram, cielo, halden, kovacs, okami, pale];

function tableHtml(groups: DupScreenGroup[], view: DupRowView): string {
  const rows = flattenRows(groups)
    .map((r) => (r.kind === "group" ? groupRowHtml(r.group, r.index, view) : copyRowHtml(r.group, r.copy, r.index, view)))
    .join("");
  return (
    `<div class="sift-library-main sift-dups-main" style="width:920px">${headHtml()}` +
    `<div role="listbox">${rows}</div>${legendHtml()}</div>`
  );
}

function mount(html: string): HTMLElement {
  const w = document.createElement("div");
  w.innerHTML = html;
  return w;
}

const meta: Meta = {
  title: "Écrans/Doublons/Table",
};
export default meta;
type Story = StoryObj;

/** La table au repos, la copie FLAC du premier groupe ouverte : une rangée par copie, la meilleure
 *  cochée, le verdict teinté seulement là où il diffère dans le groupe. */
export const Table: Story = {
  render: () => {
    const plan = initialPlan(ALL);
    return mount(tableHtml(ALL, { plan, touched: new Set(), sources, openId: aldo.copies[1].id }));
  },
};

/** « Garder seulement celle-ci » sur l'AIFF de Cielo Ferrin : la copie WAV que Rekordbox joue est
 *  décochée — son repère passe en encre d'avertissement, l'effet du groupe dit ce qu'on perd. */
export const RekordboxDecochee: Story = {
  render: () => {
    const plan = initialPlan([cielo]);
    plan.set(cielo.copies[0].id, false);
    return mount(tableHtml([cielo], { plan, touched: new Set([cielo.id]), sources, openId: null }));
  },
};

/** Un groupe À vérifier tranché à la main (Entrée sur l'AIFF) : il entre dans le plan. */
export const AVerifierTranche: Story = {
  render: () => {
    const plan = initialPlan([halden]);
    return mount(tableHtml([halden], { plan, touched: new Set([halden.id]), sources, openId: null }));
  },
};
