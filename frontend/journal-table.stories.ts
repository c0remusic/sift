import type { Meta, StoryObj } from "@storybook/html-vite";
import { esc } from "./dom";

// La table du Journal, refondue le 2026-08-19 (`frontend/journal.ts`, spec
// `docs/ui-specs/journal.md`). L'ancienne liste `<details>` par catégorie est partie avec toutes
// ses classes — `.jrnl-cat*`, `.jrnl-revert`, `.jrnl-toast`, `.jrnl-banner`, `.jrnl-qrow`,
// `.jrnl-mass`, `.jrnl-voir-tout` : voir le bloc « REFONTE DU 2026-08-19 » en tête de la section
// Journal de `frontend/styles.css`, qui nomme chaque classe retirée et son remplaçant.
//
// `journal.ts` n'exporte QUE `renderJournal`/`paintJournal` : tout son markup est privé et lit
// `jrnlState` (mode, sélection, groupes repliés, statuts d'annulation), donc il n'y a pas de
// fonction pure à appeler ici comme la story « Ligne disque amovible » appelle `usbRowHtml`. Les
// quatre helpers ci-dessous RECOPIENT la structure réelle, fonction par fonction :
//   theadHtml()    → journal.ts:339
//   rowHtml()      → journal.ts:347
//   groupHtml()    → journal.ts:382
//   skeletonHtml() → journal.ts:404
//   statusLabel()  → journal.ts:197   (libellés d'état)
// Aucune couleur, aucune taille : toutes les classes viennent de `frontend/styles.css`, et c'est
// elle seule qui peint. Un écart entre ce fichier et `journal.ts` est un bug de la story.
//
// ÉTAT NON REPRÉSENTABLE ICI : `.jrnl-row--flash`, le flash vert de la transition « annulé ». Il
// est posé puis RETIRÉ à `animationend` (journal.ts:659-660) — une story statique ne peut que le
// montrer éteint. Seule la transition se colore ; l'état annulé permanent, lui, est celui de la
// story `Annulee` (encre tertiaire, jamais une teinte).

type RowStatus = "applied" | "pending" | "reverted" | "failed";

interface RowArgs {
  /** `fmtTime()` — heure locale HH:MM (journal.ts:126). */
  time: string;
  /** `actionLabel()` — « Rangé » (convert/move), « Purgé » (trash), « Écarté » (reject),
   *  journal.ts:185. Aucun autre libellé n'est atteignable : voir l'écart spec↔réel qui y est noté. */
  action: string;
  /** `track_count` du lot. La marque `×N` n'est peinte qu'au-delà de 1. */
  count: number;
  track: string;
  /** `relDest()` — chemin RELATIF à la racine de bibliothèque (journal.ts:104). */
  dest: string;
  /** `to_path` complet : il ne sert que d'infobulle sur la cellule. */
  path: string;
  status: RowStatus;
  selected: boolean;
}

/** journal.ts:328-334 — les cinq colonnes, dans l'ordre. */
const COLS: readonly { cls: string; label: string }[] = [
  { cls: "jrnl-c-time", label: "Heure" },
  { cls: "jrnl-c-act", label: "Action" },
  { cls: "jrnl-c-track", label: "Piste" },
  { cls: "jrnl-c-dest", label: "Destination" },
  { cls: "jrnl-c-state", label: "État" },
];

/** `statusLabel()` (journal.ts:197) + la classe d'état que `rowHtml` pose sur la ligne.
 *  « Appliqué » n'a pas de classe : c'est l'ABSENCE d'entrée dans `jrnlState.status`, l'état de
 *  toute entrée que le backend vient de rendre (journal.ts:41-50). */
const STATUS: Record<RowStatus, { label: string; cls: string }> = {
  applied: { label: "Appliqué", cls: "" },
  pending: { label: "Annulation…", cls: " jrnl-row--pending" },
  reverted: { label: "Annulé", cls: " jrnl-row--reverted" },
  failed: { label: "Échec", cls: " jrnl-row--failed" },
};

function theadHtml(): string {
  return (
    `<div class="jrnl-thead" role="row">` +
    COLS.map((c) => `<span class="jrnl-c ${c.cls}" role="columnheader">${c.label}</span>`).join("") +
    `</div>`
  );
}

function rowHtml(a: RowArgs, id: string): string {
  const st = STATUS[a.status];
  const cls = "lr jrnl-row" + (a.selected ? " sel" : "") + st.cls;
  const count = a.count > 1 ? ` (${a.count} morceaux)` : "";
  const label = `${a.time}, ${a.action}${count}, ${a.track}, ${a.dest || "sans destination"}, ${st.label}`;
  return (
    `<div class="${cls}" data-jrow="${esc(id)}" tabindex="0" role="option" ` +
    `aria-selected="${a.selected}" aria-label="${esc(label)}">` +
    `<span class="jrnl-c jrnl-c-time">${esc(a.time)}</span>` +
    `<span class="jrnl-c jrnl-c-act">${esc(a.action)}` +
    (a.count > 1 ? `<span class="jrnl-batch">×${a.count}</span>` : "") +
    `</span>` +
    `<span class="jrnl-c jrnl-c-track">${esc(a.track)}</span>` +
    // Le `<bdi>` n'est pas décoratif : la cellule est en `direction:rtl` pour tronquer par la
    // GAUCHE, et sans isolation un dossier « (2002) The Universal Sky » se peint « The Universal
    // Sky … (2002) ». C'est pour ça que la destination de ces stories commence par une année entre
    // parenthèses : sans le `<bdi>`, la story le montrerait tout de suite.
    `<span class="jrnl-c jrnl-c-dest" title="${esc(a.path)}"><bdi>${esc(a.dest || "—")}</bdi></span>` +
    `<span class="jrnl-c jrnl-c-state">${esc(st.label)}</span>` +
    `</div>`
  );
}

/** journal.ts:382 — en-tête repliable + corps. Le corps est VIDÉ quand le groupe est replié (le
 *  rendu réel ne peint aucune ligne), il n'est pas caché : c'est ce que reproduit `wireGroups`. */
function groupHtml(key: string, label: string, count: number, open: boolean, rows: string): string {
  return (
    `<div class="jrnl-group jrnl-group--l1">` +
    `<button type="button" class="jrnl-group-hd" data-jgroup="${esc(key)}" aria-expanded="${open}">` +
    `<i class="ti ti-chevron-right jrnl-group-chev" aria-hidden="true"></i>` +
    `<span class="jrnl-group-label">${esc(label)}</span>` +
    `<span class="jrnl-group-count">${count} action${count > 1 ? "s" : ""}</span>` +
    `</button>` +
    `<div class="jrnl-group-body">${open ? rows : ""}</div>` +
    `</div>`
  );
}

/** journal.ts:404 — squelette DANS la structure finale : mêmes colonnes, même hauteur de ligne. */
function skeletonHtml(): string {
  const cell = (c: string) => `<span class="jrnl-c ${c}"><span class="jrnl-skel"></span></span>`;
  const row = `<div class="lr jrnl-row jrnl-row--skel" aria-hidden="true">${COLS.map((c) => cell(c.cls)).join("")}</div>`;
  return `<div class="jrnl-body">${row.repeat(6)}</div>`;
}

/** `.jrnl-wrap` est OBLIGATOIRE autour de tout : c'est lui qui déclare `--jrnl-col-time`,
 *  `--jrnl-col-act` et `--jrnl-col-state`, les trois largeurs de colonnes fixes. Hors de ce
 *  wrapper, les trois `width:var(…)` ne résolvent rien et la table se disloque.
 *
 *  La largeur du cadre, elle, appartient à la STORY et non au composant : dans la vraie fenêtre la
 *  zone C est bornée par le rail et l'inspecteur (`--rail-w` 200px + `--aside-w` 320px, tokens de
 *  `styles.css`), soit ~760px sur une fenêtre de 1280. Une largeur finie est aussi ce qui rend
 *  visible la troncature par la gauche de la colonne Destination. */
function wrap(inner: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "jrnl-wrap";
  el.style.maxWidth = "760px";
  el.innerHTML = inner;
  return el;
}

/** Rejoue le seul geste que la story a besoin de montrer : replier/déplier. Même effet que le
 *  gestionnaire délégué de `installJournalHandlers` (journal.ts:1017-1023), qui bascule la clé dans
 *  `jrnlState.collapsed` puis repeint le corps. Fréquence : un clic. */
function wireGroups(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>(".jrnl-group-hd").forEach((hd) => {
    const body = hd.nextElementSibling as HTMLElement | null;
    if (!body) return;
    const rows = body.innerHTML;
    hd.addEventListener("click", () => {
      const open = hd.getAttribute("aria-expanded") === "true";
      hd.setAttribute("aria-expanded", open ? "false" : "true");
      body.innerHTML = open ? "" : rows;
    });
  });
}

const BASE: RowArgs = {
  time: "21:47",
  action: "Rangé",
  count: 1,
  track: "Marcel Dettmann - Seduction",
  dest: "Techno/Marcel Dettmann/(2010) Dettmann/01 Seduction.aiff",
  path: "D:/Musique/Techno/Marcel Dettmann/(2010) Dettmann/01 Seduction.aiff",
  status: "applied",
  selected: false,
};

const meta: Meta<RowArgs> = {
  title: "États de contenu/Journal — ligne de table",
  render: (args) => wrap(theadHtml() + `<div class="jrnl-body">${rowHtml(args, "b-1")}</div>`),
  argTypes: {
    status: { control: "radio", options: ["applied", "pending", "reverted", "failed"] },
    selected: { control: "boolean" },
    count: { control: "number" },
    time: { control: "text" },
    action: { control: "radio", options: ["Rangé", "Purgé", "Écarté"] },
    track: { control: "text" },
    dest: { control: "text" },
    path: { control: "text" },
  },
  args: BASE,
};

export default meta;
type Story = StoryObj<RowArgs>;

/** Cas nominal. La ligne réutilise `.lr`, la ligne de table de l'app — hauteur, survol, filet,
 *  focus : une seule grammaire de ligne pour Bibliothèque et Journal. */
export const Normale: Story = {};

/** Sélection : `.sel`, promue au plan du contenu comme tout état actif de l'app. Jamais un accent
 *  coloré — un état permanent reste neutre. C'est aussi la ligne que l'inspecteur (zone D) détaille
 *  et depuis laquelle « Annuler » est offert : le bouton a quitté la ligne le 2026-08-19. */
export const Selectionnee: Story = { args: { selected: true } };

/** Annulation en cours : TRANSITOIRE, donc elle a le droit de se colorer — encre `info` sur la
 *  seule cellule État. La ligne reste utilisable, et le reste de la table aussi ; rien n'est
 *  désactivé au-delà du bouton de l'inspecteur. */
export const AnnulationEnCours: Story = { args: { status: "pending", count: 12 } };

/** Annulé : PERMANENT, donc neutre. L'encre de la piste et de l'état baisse d'un cran
 *  (`--color-text-tertiary`), elle ne s'éteint pas — aucune opacité, jamais. */
export const Annulee: Story = { args: { status: "reverted" } };

/** Échec d'annulation : encre `danger` sur piste, destination et état. Un échec ne s'estompe
 *  jamais, et son motif est lisible dans l'inspecteur (`.jrnl-insp-fail`). */
export const Echec: Story = { args: { status: "failed" } };

/** Les cinq d'un coup, dans une vraie table : c'est là qu'on vérifie que seul l'état transitoire
 *  porte une couleur, et que sélection et statut se cumulent sans se contredire. */
export const TousLesEtats: Story = {
  render: () =>
    wrap(
      theadHtml() +
        `<div class="jrnl-body">` +
        rowHtml(BASE, "b-1") +
        rowHtml({ ...BASE, time: "21:44", track: "Levon Vincent - Man or Mistress", selected: true }, "b-2") +
        rowHtml({ ...BASE, time: "21:39", action: "Écarté", track: "DJ Rashad - Feelin", status: "pending" }, "b-3") +
        rowHtml({ ...BASE, time: "21:31", track: "Anthony Naples - Mad Disrespect", status: "reverted" }, "b-4") +
        rowHtml({ ...BASE, time: "21:22", action: "Purgé", track: "Untitled - 03 (dup)", status: "failed" }, "b-5") +
        `</div>`,
    ),
};

/** Groupes de session : déplié et replié. L'en-tête est un vrai `<button>` — Entrée et Espace
 *  marchent sans câblage — et le chevron pivote sur `[aria-expanded="true"]`, en `transform` seul.
 *  Cliquer bascule, comme dans l'app.
 *
 *  Le niveau 2 (`.jrnl-group--l2`, une session sous un jour) n'apparaît qu'en mode « Tout
 *  l'historique » : même en-tête, indenté d'un cran (`--space-12`), avec le libellé court
 *  « Session de 21h47 » au lieu de la forme datée. */
export const GroupeSession: Story = {
  render: () => {
    const rows = rowHtml(BASE, "b-1") + rowHtml({ ...BASE, time: "21:44", track: "Levon Vincent - Man or Mistress" }, "b-2");
    const root = wrap(
      theadHtml() +
        `<div class="jrnl-body">` +
        groupHtml("s:1", "Session du 19/08/2026 21h30", 2, true, rows) +
        groupHtml("s:2", "Session du 19/08/2026 18h05", 47, false, rows) +
        `</div>`,
    );
    wireGroups(root);
    return root;
  },
};

/** Chargement : le squelette occupe la structure FINALE — mêmes colonnes, même hauteur de ligne —
 *  pour que l'arrivée des données ne déplace rien. Pas d'animation : un squelette qui pulse attire
 *  l'œil sur une attente d'une centaine de millisecondes. Il n'est peint que si RIEN de valide
 *  n'est déjà à l'écran (journal.ts:476). */
export const Squelette: Story = {
  render: () => wrap(theadHtml() + skeletonHtml()),
};
