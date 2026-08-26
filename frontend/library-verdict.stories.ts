import type { Meta, StoryObj } from "@storybook/html-vite";
import type { LibraryTrack } from "../shared/contracts";
import { libraryTableHeaderHtml, libraryTableRowHtml } from "./library-views";

// La colonne Verdict de la table Bibliothèque, ajoutée le 2026-08-19 (`DESIGN.md` § 16, colonne 1).
// Elle remplace l'ancienne pastille de FIN de ligne (`verdictBadge`, une puce « fake » / « ? »
// posée après les colonnes) : deux marques pour un même état dans la même ligne, dont l'une en
// minuscules et sans libellé pour `grey`.
//
// Les cinq rendus sont ceux de `verdictView()` (library-views.ts:49). Cette fonction est PRIVÉE,
// et rien ici ne la réimplémente : les stories passent par la vraie fonction publique
// `libraryTableRowHtml()` (library-views.ts:220) en réglant les deux seuls champs qui la
// pilotent — `verdict` et `format`. Une story ne peut donc pas diverger du code : elle l'exécute.
//
//   verdict "ok"   + format lossless                      → LOSSLESS      `.sift-lib-v-ok`
//   verdict "ok"   + format lossy                         → AUTHENTIQUE   `.sift-lib-v-ok`
//   verdict "fake"                                        → FAKE          `.sift-lib-v-fake`
//   verdict "grey"                                        → À VÉRIFIER    `.sift-lib-v-check`
//   verdict null (non analysé)                            → —             `.sift-lib-v-none`
//
// « lossless » se lit dans `rails.ts` (`railFromExt`, seule copie frontend de
// `analysis::tags::rail_from_ext`) : flac · wav · aif · aiff · alac. Le 2026-08-20 cette table était
// encore recopiée dans `library-views.ts` sans `aif`, si bien qu'un `.aif` authentique rendait
// AUTHENTIQUE — d'où l'option `aif` dans le contrôle `format` ci-dessous, qui rend le cas cliquable.
//
// Il n'y a pas de sixième rendu : `DUPLICATE` n'est atteignable par AUCUNE valeur de ce champ (un
// doublon sort du scan de dédoublonnage, pas de `tracks.verdict`), et les trois seuls littéraux
// que le backend écrit sont `ok` / `fake` / `grey` (`worker.rs::verdict_str`).
//
// L'en-tête est rendu par la vraie `libraryTableHeaderHtml()` : c'est lui qui prouve l'alignement
// des colonnes, la géométrie (largeur 92px, `gap`) étant partagée entre en-tête et ligne alors que
// la typographie du libellé ne vaut que dans la ligne.
//
// ⚠️ L'ordre et les largeurs des colonnes sont un ÉTAT persistant (`library-columns.ts`,
// `localStorage` clé `sift-libcols-v1`). Storybook a son propre origine, donc ces stories partent
// des colonnes par défaut — sauf si on les a déplacées DANS Storybook.

const BASE: LibraryTrack = {
  id: 1,
  path: "D:/Musique/Techno/Marcel Dettmann/(2010) Dettmann/01 Seduction.aiff",
  artist: "Marcel Dettmann",
  title: "Seduction",
  format: "aiff",
  bitrate: null,
  duration: 401,
  bpm: 132.4,
  year: 2010,
  label: "Ostgut Ton",
  genres: ["Techno"],
  discogs_release_id: null,
  // `null` volontairement : avec un chemin, la ligne appellerait `convertFileSrc()`, qui n'a de
  // sens que dans la fenêtre Tauri. La ligne peint alors sa vignette de repli (`ti-vinyl`).
  cover_path: null,
  has_cover: false,
  verdict: "ok",
  folder: "Techno/Marcel Dettmann",
};

/** Le cadre appartient à la story, pas au composant : dans la vraie fenêtre la table est bornée
 *  par le rail et l'inspecteur (`--rail-w` 200px + `--aside-w` 320px, tokens de `styles.css`), soit
 *  ~760px sur une fenêtre de 1280. */
function table(rows: readonly LibraryTrack[]): HTMLElement {
  const el = document.createElement("div");
  el.style.maxWidth = "760px";
  el.innerHTML =
    libraryTableHeaderHtml({ field: "verdict", dir: "asc" }) +
    rows.map((t) => libraryTableRowHtml(t, null)).join("");
  return el;
}

const meta: Meta<LibraryTrack> = {
  title: "États de contenu/Bibliothèque — colonne Verdict",
  render: (args) => table([args]),
  argTypes: {
    verdict: { control: "radio", options: ["ok", "fake", "grey", null] },
    format: { control: "radio", options: ["aiff", "aif", "wav", "flac", "alac", "mp3"] },
    artist: { control: "text" },
    title: { control: "text" },
    bpm: { control: "number" },
    year: { control: "number" },
  },
  args: BASE,
};

export default meta;
type Story = StoryObj<LibraryTrack>;

/** Sain ET sur un rail lossless — les DEUX faits sont exigés, comme pour `verdictWordTone`. Le
 *  `format` d'une piste rangée est celui que Sift a réellement ÉCRIT, donc il EST le rail du
 *  fichier sur le disque. */
export const Lossless: Story = { args: { verdict: "ok", format: "aiff" } };

/** Sain, mais sur un rail lossy : écrire LOSSLESS sur un MP3 authentique serait faux. Même encre
 *  verte — c'est le même fait de qualité, pas un état de moindre confiance. */
export const Authentique: Story = {
  args: {
    verdict: "ok",
    format: "mp3",
    path: "D:/Musique/House/Kerri Chandler/(1998) Hemisphere/02 Rain.mp3",
    artist: "Kerri Chandler",
    title: "Rain",
  },
};

/** Faux lossless détecté : encre `danger`. C'est la raison d'être de l'app, et la ligne ne
 *  l'estompe jamais — un verdict garde sa teinte même sur la ligne ouverte (`.lr.cur`), la classe
 *  étant posée sur la CELLULE. */
export const Fake: Story = {
  args: {
    verdict: "fake",
    format: "flac",
    path: "D:/Musique/Techno/Unknown/(2004) Bootleg/03 Ghost.flac",
    artist: "Unknown Artist",
    title: "Ghost (vinyl rip)",
  },
};

/** Zone grise : ambre = « doute, décision attendue ». Le mot reprend le vocabulaire déjà employé
 *  en Revue (`report-view.ts::verdictWordTone`, « à vérifier » — l'ex-`verdictWord()` de la ligne
 *  de file a été retiré le 2026-08-26, la pastille porte le verdict seule), aucun terme n'est neuf. */
export const AVerifier: Story = {
  args: {
    verdict: "grey",
    format: "flac",
    path: "D:/Musique/Dub/Rhythm & Sound/(2001) Rhythm & Sound/05 Carrier.flac",
    artist: "Rhythm & Sound",
    title: "Carrier",
  },
};

/** Non analysé : neutre, et un tiret cadratin plutôt qu'une cellule vide — une cellule vide se lit
 *  comme un défaut de rendu, un tiret dit « rien à ce sujet ». */
export const NonAnalyse: Story = {
  args: {
    verdict: null,
    format: "wav",
    path: "D:/Musique/_inbox/track 07.wav",
    artist: null,
    title: null,
    bpm: null,
    year: null,
    duration: null,
    genres: [],
  },
};

/** Les cinq dans une seule table, dans l'ordre de tri ASCENDANT de la colonne (`rank` de
 *  `verdictView`) : ce qui demande une décision d'abord — FAKE, À VÉRIFIER — puis le non analysé,
 *  puis le sain. L'échec est l'information qu'on n'a pas le droit d'estomper, donc il ne se range
 *  pas en queue. La pastille prend `currentColor` : point et libellé ne peuvent pas se désaccorder. */
export const LesCinqRendus: Story = {
  render: () =>
    table([
      { ...BASE, id: 1, verdict: "fake", format: "flac", artist: "Unknown Artist", title: "Ghost (vinyl rip)" },
      { ...BASE, id: 2, verdict: "grey", format: "flac", artist: "Rhythm & Sound", title: "Carrier" },
      { ...BASE, id: 3, verdict: null, format: "wav", artist: null, title: null, bpm: null, year: null },
      { ...BASE, id: 4, verdict: "ok", format: "mp3", artist: "Kerri Chandler", title: "Rain" },
      { ...BASE, id: 5, verdict: "ok", format: "aiff" },
    ]),
};
