// Destination bin-tree + popover, extracted from filing.ts (god-file split, tech-debt audit F03).
// Owns the destination-selection state (library root, bin list, selected bin, "sur place" flag,
// batch-pick context) that filing.ts's RevueState used to hold directly. Two narrow injection
// points replace what were direct calls into filing.ts, avoiding a static import cycle (same
// pattern as sift-live.ts's registerBatchRenderer/registerRefreshHook, Phase 1 tranche 1b/1c):
// registerDestChangeHook fires after a UI-driven destination change (bin click, "sur place"
// toggle) so filing.ts can refresh the rail's Destination/Ranger labels; registerOpenTrackPathGetter
// lets binLabel() read the currently open track's path for the "sur place" label without owning
// RevueState itself.
import { getSetting, setSetting, listBins } from "./ipc";
import type { Bin } from "../shared/contracts";
import { EXTERNAL_DEST_PREFIX } from "../shared/contracts";
import { open } from "@tauri-apps/plugin-dialog";
import { esc } from "./dom";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { destPopoverPosition } from "./popover-position";

const LIBRARY_ROOT = "library_root";
// Groupe « Autres » : dossiers externes déjà choisis, mémorisés en settings JSON (valeur = tableau
// de chemins absolus sérialisé). Première clé settings à porter du JSON — `settings.rs` stocke une
// String opaque, donc zéro migration (décision B, revue.md:161-168).
const CUSTOM_DESTS_KEY = "revue_custom_dests";

interface DestState {
  rootSet: boolean;
  rootPath: string | null; // absolute library root (for the root tree node label)
  bins: Bin[];
  binRel: string | null; // selected destination ("" = root, relative to root otherwise)
  // Dossiers externes (hors bibliothèque) choisis via le picker natif, mémorisés pour re-sélection
  // sans re-parcourir — groupe « Autres ». Chemins absolus, dédupliqués, persistés (CUSTOM_DESTS_KEY).
  customDests: string[];
  binFilter: string; // folder search text (empty = show the full tree)
  /** Impasse A8 (issue #15) : pourquoi `rootSet` est faux. Le `catch` de `loadBins` posait
   *  `rootSet = false` sur un ÉCHEC DE LECTURE, ce qui rendait la porte « Choisis ta racine de
   *  bibliothèque » à quelqu'un qui l'avait déjà choisie — et l'invitait à la re-choisir pour
   *  résoudre un problème qui n'était pas le sien. « Non choisie » et « pas lisible » sont deux
   *  états, et un seul booléen ne peut pas les porter. `null` = vraiment pas choisie. */
  loadError: string | null;
}

const destState: DestState = {
  rootSet: false,
  rootPath: null,
  bins: [],
  binRel: null,
  customDests: [],
  binFilter: "",
  loadError: null,
};

/** Detail mode's "file in place" state — mirrors sift-live.ts's batchInPlace for batch mode. A
 * module variable (not read straight off the checkbox's DOM .checked) because the checkbox now
 * renders as part of renderBins's fldz.innerHTML, rebuilt wholesale on every filter keystroke/
 * folder click/background refresh — a DOM-only checked flag would reset on each of those. */
let detailInPlace = false;

/** True when the detail-mode "file in place" checkbox is ticked: File targets the track's own
 *  source folder (FILE_IN_PLACE) instead of the bin selected in the #fldz tree. */
export function fileInPlaceChecked(): boolean {
  return detailInPlace;
}

/** The currently selected destination ("" = root, relative path, or an EXTERNAL_DEST_PREFIX
 *  destination), for doRanger to resolve the actual filing target. */
export function getBinRel(): string | null {
  return destState.binRel;
}

/** True once a real destination is selected — either "sur place" (the file's own folder) or a
 *  chosen bin/external folder. Drives both the Ranger button's disabled state and the verdict
 *  conclusion's "À finaliser" vs "Prêt à ranger" wording (same question, two places to show it). */
export function hasDestination(): boolean {
  return detailInPlace || destState.binRel !== null;
}

// Reads the open track's path for binLabel()'s "sur place" case — filing.ts registers this once
// at module load rather than this module importing filing.ts's RevueState directly (would create
// a static import cycle: filing.ts already imports from this module).
let getOpenTrackPath: () => string | null = () => null;
export function registerOpenTrackPathGetter(fn: () => string | null): void {
  getOpenTrackPath = fn;
}

// Fired after a UI-driven destination change (bin click, "sur place" toggle) so filing.ts can
// refresh the rail's Destination/Ranger button labels — filing.ts registers refreshFootButton here
// once at module load, same reasoning as registerOpenTrackPathGetter above.
let onDestChanged: (() => void) | null = null;
export function registerDestChangeHook(fn: () => void): void {
  onDestChanged = fn;
}

/** Refresh root + bin list from the backend. Call before rendering bins. */
async function loadBins(): Promise<void> {
  try {
    const root = await getSetting(LIBRARY_ROOT);
    destState.loadError = null;
    destState.rootPath = root ?? null;
    destState.rootSet = !!(root && root.trim());
    destState.bins = destState.rootSet ? await listBins() : [];
    destState.customDests = parseCustomDests(await getSetting(CUSTOM_DESTS_KEY));
    // Root starts COLLAPSED (no forced expanded.add("") here) — this used to re-force it open on
    // every loadBins() call (incl. background refreshes unrelated to the tree), so a user who
    // collapsed it would see it silently reopen. `expanded` persists the user's own toggles now.
    // Drop a stale selection (a real bin that vanished); "" (root) is always valid, and an
    // external destination (outside root, never listed in `destState.bins`) is its own kind of
    // valid — only a REAL bin path that no longer matches any loaded bin counts as stale here.
    if (
      destState.binRel &&
      destState.binRel !== "" &&
      !destState.binRel.startsWith(EXTERNAL_DEST_PREFIX) &&
      !destState.bins.some((b) => b.rel === destState.binRel)
    ) {
      destState.binRel = null;
    }
    // Default to filing at the root until the user picks a sub-folder.
    if (destState.rootSet && destState.binRel === null) destState.binRel = "";
  } catch (e) {
    // `rootSet` reste tel quel : ce `catch` ne sait RIEN de la racine, il sait que la lecture a
    // échoué. Le remettre à false était le mensonge d'A8 (issue #15). `loadError` porte la cause,
    // et `renderBins` s'en sert pour montrer l'échec au lieu de la porte de premier réglage.
    destState.loadError = humanizeError(
      e,
      "L'arbre de destination n'a pas pu être lu.",
      "loadBins",
    );
    destState.bins = [];
  }
}

/** Prompt for, and persist, the library root, then refresh. */
async function pickRoot(fldz: HTMLElement): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  try {
    await setSetting(LIBRARY_ROOT, dir);
    await loadBins();
    renderBins(fldz);
  } catch (e) {
    console.error("setSetting(library_root) failed", e);
    toast("Échec d'enregistrement de la racine — réessaie");
  }
}

/** Lecture défensive de la liste « Autres » depuis le settings JSON : tout ce qui n'est pas un
 *  tableau de chaînes non vides retombe sur une liste vide, jamais une exception — une valeur
 *  corrompue ne doit pas casser le rendu de la destination. */
function parseCustomDests(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

/** Mémorise un dossier externe dans le groupe « Autres » (dédup par chemin, plus récent en tête) et
 *  persiste la liste. Best-effort : un échec d'écriture n'empêche PAS la sélection en cours — le
 *  dossier reste dans l'état de session, il ne survivra simplement pas au reload. Fail-soft assumé :
 *  perdre une entrée d'historique de destination est moins grave que bloquer un rangement. */
async function addCustomDest(path: string): Promise<void> {
  if (destState.customDests.includes(path)) return;
  destState.customDests.unshift(path);
  try {
    await setSetting(CUSTOM_DESTS_KEY, JSON.stringify(destState.customDests));
  } catch (e) {
    console.error("setSetting(custom_dests) failed", e);
  }
}

/** Pied du popover ("Nouveau dossier…" comme "Choisir un dossier…") — native OS directory picker,
 *  result becomes an EXTERNAL_DEST_PREFIX-prefixed destination (see plan_file's handling in
 *  filing.rs) AND is remembered in the « Autres » group. Same post-pick behavior as clicking a tree
 *  bin: batch routes through binPick.onPick, detail sets destState.binRel directly and closes the
 *  popover. The dialog only ever returns a real, existing directory the user navigated to — never
 *  free-typed text — which is the trust boundary EXTERNAL_DEST_PREFIX's doc comment (filing.rs)
 *  relies on. */
async function browseExternalDest(fldz: HTMLElement): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  await addCustomDest(dir); // entre dans « Autres » (dédup + persiste) avant d'être sélectionné
  const prefixed = `${EXTERNAL_DEST_PREFIX}${dir}`;
  if (binPick) {
    binPick.onPick(prefixed);
  } else {
    destState.binRel = prefixed;
    renderBins(fldz);
    onDestChanged?.();
    fldz.hidden = true;
  }
}

// Which folders are expanded in the tree. "" = the library root node.
const expanded = new Set<string>();

/** Display name of the library root (last path segment), for the root tree node. */
function rootName(): string {
  if (!destState.rootPath) return "Library";
  return destState.rootPath.split(/[\\/]/).filter(Boolean).pop() || destState.rootPath;
}

/** Absolute filesystem path of a bin (for the hover tooltip — "where on disk does this go?"),
 * using the library root's own path separator. */
function absPath(rel: string): string {
  const root = destState.rootPath ?? "";
  if (!rel) return root || rootName();
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

/** The real parent directory of a file path, on disk — no library/bin concept involved, just
 *  string surgery on the path itself (the OS separator the path already uses, not the root's). */
function sourceFolderOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : path;
}

/** Human label for the current destination selection. "Sur place" checked → the CURRENT track's
 *  own physical folder on disk (a real path, computed from the open track — never a library bin, a
 *  root-relative name, or anything else "internal" to Sift): this is a plain filesystem
 *  destination, not a library one, and must never look like it's borrowed from the bin tree. Only
 *  when unchecked does the library selection (destState.binRel) apply. */
export function binLabel(): string {
  if (detailInPlace) {
    const trackPath = getOpenTrackPath();
    return trackPath ? sourceFolderOf(trackPath) : "—";
  }
  if (destState.binRel === null) return "—";
  if (destState.binRel === "") return rootName();
  if (destState.binRel.startsWith(EXTERNAL_DEST_PREFIX)) {
    const abs = destState.binRel.slice(EXTERNAL_DEST_PREFIX.length);
    return abs.split(/[\\/]/).filter(Boolean).pop() || abs;
  }
  return destState.binRel;
}

/** Direct children of `rel` ("" = the root → its top-level bins). */
function childrenOf(rel: string): Bin[] {
  if (rel === "") return destState.bins.filter((b) => b.depth === 1);
  const depth = rel.split("/").length;
  return destState.bins.filter((b) => b.depth === depth + 1 && b.rel.startsWith(rel + "/"));
}

// Optional batch pick context: when set, the #fldz tree highlights `selectedRel` and routes a folder
// click to `onPick` (→ batchBin in sift-live) instead of detail's destState.binRel. null = detail mode.
let binPick: { selectedRel: string | null; onPick: (rel: string) => void; inert: boolean } | null =
  null;
/** The rel currently highlighted in the tree — batch pick context when active, else detail's. */
function selRel(): string | null {
  return binPick ? binPick.selectedRel : destState.binRel;
}

/** Recursive HTML for one tree node + its children when expanded. The root (depth 0,
 * rel "") sits at the top; folders nest under it, each with a caret when it has
 * sub-folders. Selecting a node sets it as the filing destination. */
function binNodeHtml(node: { rel: string; name: string; depth: number }): string {
  const kids = childrenOf(node.rel);
  const isOpen = expanded.has(node.rel);
  const on = node.rel === selRel() ? " on" : "";
  const indent = node.depth * 13;
  const caret = kids.length
    ? `<span data-fil="caret" data-rel="${esc(node.rel)}" title="${isOpen ? "Collapse" : "Expand"}" class="sift-fld-caret" style="${
        isOpen ? "transform:rotate(90deg)" : ""
      }">▸</span>`
    : '<span class="sift-fld-caret-spacer"></span>';
  const icon = node.depth === 0 ? "ti-database" : "ti-folder";
  // Highlight for the selected destination comes from .fld.on (styles.css) — background, text
  // color and weight. Only the icon colour is genuinely new (icon isn't covered by .fld.on).
  const iconColor = on ? "var(--color-text-info)" : "var(--color-text-tertiary)";
  // Audit-ref R4 (Revue, 2026-07-08, réf. shadcn Sidebar) : tabindex+role, clavier via
  // installNavKeyboard() (chrome.ts, sélecteur étendu pour [data-fil="bin"]).
  let html = `<div class="fld${on} sift-fld-row" data-fil="bin" data-rel="${esc(node.rel)}" tabindex="0" role="button" title="${esc(
    absPath(node.rel),
  )}" style="padding-left:${6 + indent}px">${caret}<i class="ti ${icon} sift-fld-icon" style="font-size:var(--text-base);color:${iconColor}"></i><span class="sift-fld-label">${esc(
    node.name,
  )}</span></div>`;
  if (kids.length && isOpen) html += kids.map(binNodeHtml).join("");
  return html;
}

/** Flat selectable row for the filtered view: shows the full relative path so the location is
 * obvious without the tree context, with the same highlight + absolute-path tooltip as the tree. */
function flatBinHtml(b: Bin): string {
  const on = b.rel === selRel() ? " on" : "";
  const color = on ? "var(--color-text-info)" : "var(--color-text-tertiary)";
  return `<div class="fld${on} sift-fld-flat-row" data-fil="bin" data-rel="${esc(b.rel)}" tabindex="0" role="button" title="${esc(
    absPath(b.rel),
  )}"><i class="ti ti-folder sift-fld-icon" style="font-size:var(--text-base);color:${color}"></i><span class="sift-fld-label">${esc(
    b.rel,
  )}</span></div>`;
}

/** Une entrée du groupe « Autres » : un dossier externe mémorisé, « nom · chemin » (nom = dernier
 *  segment mis en avant, chemin complet en légende + tooltip). Sélectionnable comme un bac de
 *  l'arbre via le même data-fil="bin" (rel préfixé EXTERNAL_DEST_PREFIX) — aucun nouveau wiring, le
 *  dispatch de clic et selRl() existants le gèrent. esc() sur le nom ET le chemin : données FS non
 *  fiables (dialog natif). */
function customDestHtml(path: string): string {
  const rel = `${EXTERNAL_DEST_PREFIX}${path}`;
  const on = rel === selRel() ? " on" : "";
  const color = on ? "var(--color-text-info)" : "var(--color-text-tertiary)";
  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  return `<div class="fld${on} sift-fld-flat-row" data-fil="bin" data-rel="${esc(rel)}" tabindex="0" role="button" title="${esc(
    path,
  )}"><i class="ti ti-folder-open sift-fld-icon" style="font-size:var(--text-base);color:${color}"></i><span class="sift-fld-label"><span class="sift-custom-name">${esc(
    name,
  )}</span> <span class="sift-custom-path">${esc(path)}</span></span></div>`;
}

/** Le groupe « Autres » entier (libellé + entrées), vide tant qu'aucun dossier externe n'a été
 *  mémorisé — rendu dans le wrapper grisable, sous l'arbre biblio. */
function customDestsGroupHtml(): string {
  if (destState.customDests.length === 0) return "";
  return (
    `<div class="sift-fldz-group-label">Autres</div>` + destState.customDests.map(customDestHtml).join("")
  );
}

/** Render the destination column (#fldz): root picker when unset, else a folder filter + either
 * the collapsible tree (no filter) or a flat list of matching folders (filter active). */
function renderBins(fldz: HTMLElement): void {
  // Ordre délibéré : l'échec de lecture se dit AVANT la porte de premier réglage. Les deux
  // pouvaient se produire ensemble (première lecture, qui échoue), et dans ce cas c'est l'échec
  // qui est actionnable — proposer de choisir une racine qu'on ne saura pas relire ensuite ne mène
  // nulle part. Impasse A8, issue #15.
  if (destState.loadError) {
    fldz.innerHTML =
      `<div class="sift-fldz-hint" style="color:var(--color-text-danger)">${esc(destState.loadError)}</div>` +
      '<button data-fil="retrybins">Réessayer</button>';
    fldz.querySelector('[data-fil="retrybins"]')?.addEventListener("click", () => {
      void loadBins().then(() => renderBins(fldz));
    });
    return;
  }
  if (!destState.rootSet) {
    fldz.innerHTML =
      '<div class="sift-fldz-hint">Choisis ta racine de bibliothèque pour commencer à convertir.</div>' +
      '<button data-fil="pickroot"><i class="ti ti-folder sift-icon-inline-base"></i> Choisir…</button>';
    fldz
      .querySelector('[data-fil="pickroot"]')
      ?.addEventListener("click", () => void pickRoot(fldz));
    return;
  }

  const filtering = destState.binFilter.trim().length > 0;

  // Folder filter (only worth showing once there are sub-folders to sift through).
  const filterRow = destState.bins.length
    ? `<input data-fil="binfilter" placeholder="Filtrer les dossiers…" value="${esc(
        destState.binFilter,
      )}" class="sift-binfilter">`
    : "";

  let body: string;
  if (filtering) {
    // Flat list of matches (path or name contains the query), case-insensitive.
    const q = destState.binFilter.trim().toLowerCase();
    const matches = destState.bins.filter(
      (b) => b.rel.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
    );
    body = matches.length
      ? matches.map(flatBinHtml).join("")
      : '<div class="sift-fldz-no-match">Aucun dossier correspondant.</div>';
  } else {
    const tree = binNodeHtml({ rel: "", name: rootName(), depth: 0 });
    const emptyNote =
      destState.bins.length === 0 && expanded.has("")
        ? '<div class="sift-fldz-empty-note">vide — crée un dossier</div>'
        : "";
    body = tree + emptyNote;
  }

  // Groupe « Autres » : dossiers externes mémorisés, sous l'arbre, dans le wrapper grisable. Masqué
  // pendant le filtre (qui ne cherche que dans la bibliothèque), comme l'arbre lui-même.
  const autresGroup = filtering ? "" : customDestsGroupHtml();

  // "Sur place" lives INSIDE the popover now (maquette: filter → in-place row → tree), instead of
  // a separate persistent element outside #fldz — same attribute per mode so the existing wiring
  // (detail: change listener below; batch: sift-live.ts's delegated #pa "change" listener, which
  // catches it regardless of where inside #pa it renders) needs no other changes. The tree itself
  // (not the checkbox) is wrapped so batch's "in place greys the tree" behavior can target just that
  // wrapper — checking the box must never make itself un-clickable.
  const inPlaceChecked = binPick ? binPick.inert : detailInPlace;
  const inPlaceAttr = binPick ? 'data-sift="inplace"' : 'data-fil="inplace"';
  const inPlaceRow = `<label class="sift-inplace-toggle"><input type="checkbox" ${inPlaceAttr}${
    inPlaceChecked ? " checked" : ""
  }><span>Sur place <span class="sift-inplace-note">(dossier du fichier)</span></span></label>`;
  // Real disk path caption (maquette: "📁 {rootPath}\"), title= carries the full path for a
  // narrow popover where the text itself gets ellipsis-truncated.
  const rootCaption = destState.rootPath
    ? `<div class="sift-fldz-rootpath" title="${esc(destState.rootPath)}"><i class="ti ti-folder"></i><span>${esc(destState.rootPath)}\\</span></div>`
    : "";
  // Pied : deux actions natives — « Nouveau dossier… » (l'explorateur natif permet d'en créer un)
  // et « Choisir un dossier… » (en sélectionner un existant). Les deux ouvrent le MÊME picker, le
  // résultat entre dans « Autres » puis est sélectionné (browseExternalDest). Hors .sift-fldz-tree,
  // comme la case Sur place : toujours cliquables même quand l'arbre est grisé (in-place coché) —
  // ce sont des actions du système de fichiers, sans concept de bibliothèque.
  const footRow =
    `<div class="sift-fldz-foot">` +
    `<div class="fld" data-fil="newfolder"><i class="ti ti-folder-plus sift-icon-inline-lg"></i> Nouveau dossier…</div>` +
    `<div class="fld" data-fil="browsecustom"><i class="ti ti-folder-open sift-icon-inline-lg"></i> Choisir un dossier…</div>` +
    `</div>`;

  // Ordre (décision B, revue.md:161-168) : arbre biblio + « Autres » dans le wrapper grisable
  // (filterRow/rootCaption = chrome de bibliothèque, grisés avec), puis un séparateur, puis la case
  // Sur place, puis le pied. Seuls la case ET le pied restent HORS du wrapper : cocher Sur place ne
  // doit jamais rendre sa propre case ni les actions natives non cliquables (régression connue).
  fldz.innerHTML =
    `<div class="sift-fldz-tree">${filterRow}${rootCaption}${body}${autresGroup}</div>` +
    `<div class="sift-fldz-sep"></div>` +
    inPlaceRow +
    footRow;

  if (!binPick) {
    fldz.querySelector<HTMLInputElement>('[data-fil="inplace"]')?.addEventListener("change", (e) => {
      detailInPlace = (e.target as HTMLInputElement).checked;
      renderBins(fldz); // re-render so the tree-wrap greying below picks up the new state
      onDestChanged?.(); // Destination/Ranger labels must switch to the file's own folder too
    });
  }

  // In-place greys the TREE ONLY (never the checkbox that controls it) — detail's own
  // detailInPlace, or batch's binPick.inert. Re-assert on every render, unconditionally (not just
  // when the flag is true) — this makes renderBins self-consistent across mode switches with no
  // external reset needed (previously an explicit cleanup in setReviewMode's "leave batch" branch
  // was required because this only ever SET opacity, never cleared it, when binPick was null).
  const treeWrap = fldz.querySelector<HTMLElement>(".sift-fldz-tree");
  if (treeWrap) {
    const inert = binPick ? binPick.inert : detailInPlace;
    treeWrap.style.opacity = inert ? ".4" : "1";
    treeWrap.style.pointerEvents = inert ? "none" : "auto";
  }

  // Re-render on every keystroke loses focus — restore it (caret at end) while filtering.
  if (filtering) {
    const fi = fldz.querySelector<HTMLInputElement>('[data-fil="binfilter"]');
    if (fi && document.activeElement !== fi) {
      fi.focus();
      fi.setSelectionRange(fi.value.length, fi.value.length);
    }
  }
  fldz.querySelector<HTMLInputElement>('[data-fil="binfilter"]')?.addEventListener("input", (e) => {
    destState.binFilter = (e.target as HTMLInputElement).value;
    renderBins(fldz);
  });

  fldz.querySelectorAll<HTMLElement>('[data-fil="caret"]').forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const rel = el.dataset.rel || "";
      if (expanded.has(rel)) expanded.delete(rel);
      else expanded.add(rel);
      renderBins(fldz);
    }),
  );
  fldz.querySelectorAll<HTMLElement>('[data-fil="bin"]').forEach((el) =>
    el.addEventListener("click", () => {
      const rel = el.dataset.rel ?? "";
      if (binPick) {
        binPick.onPick(rel); // batch: caller updates batchBin + re-renders tree/rail/preview
      } else {
        destState.binRel = rel;
        renderBins(fldz);
        onDestChanged?.();
        fldz.hidden = true; // picking a destination closes the popover (like the mockup's pickBin)
      }
    }),
  );
  // Les deux boutons du pied ouvrent le même picker natif (browseExternalDest) : « Nouveau dossier »
  // invite à en créer un dans l'explorateur, « Choisir un dossier » à en sélectionner un existant —
  // même geste technique, le résultat entre dans « Autres ».
  fldz
    .querySelector('[data-fil="newfolder"]')
    ?.addEventListener("click", () => void browseExternalDest(fldz));
  fldz.querySelector('[data-fil="browsecustom"]')?.addEventListener("click", () => void browseExternalDest(fldz));
  repositionDestPopoverIfOpen();
}

/** Re-anchor the destination popover to the Destination button's CURRENT position, but only if
 *  it's actually open. `positionDestPopover` was previously called once, at open time — but
 *  `#fldz`'s content (this file's `renderBins`) is rebuilt independent of any user click — no
 *  longer on every analysis tick (that call was moved behind the detail-pane guard in
 *  `queue-panel.ts`), but still on the paths that genuinely change the bins — and the rail itself
 *  (`renderFoot`/`renderBatchRail`) can reflow too (e.g. a filename wrapping differently) — either
 *  can silently move the Destination button while the popover, once positioned, never re-anchored.
 *  That produced the "position aléatoire" bug: correct if you'd JUST clicked Destination, stale
 *  and drifted otherwise. Calling this from every content/layout path that could move the button
 *  keeps the popover glued to it regardless of what triggered the change. */
export function repositionDestPopoverIfOpen(): void {
  const pop = document.getElementById("fldz");
  if (pop && !pop.hidden) positionDestPopover(pop);
}

/** Anchors the popover to the Destination button's real on-screen position (position:fixed,
 *  recalculated here) instead of a hardcoded left/bottom — keeps it aligned if the rail's height
 *  changes (e.g. a longer secondary-button label wrapping), then keeps it inside the window.
 *
 *  The anchor alone used to be the whole function, and it clipped: at the declared minimum window
 *  size (920x640) the button sits at left 705 and the popover is 288 wide, so its right edge landed
 *  at 993 — 73px outside, filter field and folder rows unreachable. Measured in the real window on
 *  2026-08-13 (issue #27). The vertical case predicted by that issue did NOT reproduce there (top
 *  resolved to 132, positive); it needs a full bin list at the 340px max-height AND a taller
 *  wrapped action bar, which the flip below now covers regardless. Structure follows Floating UI's
 *  flip-then-shift order (main axis flips, cross axis shifts) — read, not installed: adding it is
 *  an open question of map #6 and this fix must not preempt it.
 *
 *  Uses `top` derived from the popover's OWN measured height, not `bottom` derived from
 *  `window.innerHeight` — the previous `bottom:${window.innerHeight - r.top + 8}px` formula
 *  placed the popover near the top of the window instead of just above the button in the real
 *  Tauri webview (window.innerHeight apparently diverges from the coordinate space
 *  getBoundingClientRect reports here, a HiDPI/webview scaling quirk — confirmed by comparing a
 *  real screenshot's button position against the popover's actual rendered position). Deriving
 *  the position purely from two getBoundingClientRect() calls (button + popover), both in the
 *  same coordinate space by construction, sidesteps that mismatch entirely. */
function positionDestPopover(pop: HTMLElement): void {
  // Document-wide query, and it MUST stay one: there is exactly one Destination button at a time,
  // because the Detail rail (`filing.ts` renderFoot) and the Batch rail (`batch-panel.ts`
  // renderBatchRail) both write `innerHTML` into the SAME host, `#filfoot` — each render destroys
  // the other's button. Invariant measured on 2026-08-13 (issue #28): querySelectorAll length 1 in
  // both modes, in the real window.
  //
  // Do NOT "improve" this into a stored anchor passed at open time: those same innerHTML rewrites
  // replace the button node on every rail rebuild, so a held reference goes stale and would
  // re-anchor the popover to a detached element. Re-resolving here is what makes
  // `repositionDestPopoverIfOpen()` work after a rebuild at all.
  const buttons = document.querySelectorAll<HTMLElement>('[data-fil="destbtn"]');
  if (import.meta.env.DEV && buttons.length > 1) {
    // Loud on the only path that could break the invariant — a second rail host. Silent otherwise
    // it anchors to whichever comes first in the DOM, which is the "position aléatoire" symptom
    // the comment on repositionDestPopoverIfOpen describes having already chased once.
    console.error(
      `positionDestPopover: ${buttons.length} boutons Destination dans le document, l'invariant "un seul #filfoot" est rompu — le popover s'ancre au premier`,
    );
  }
  const btn = buttons[0];
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const { height: popH, width: popW } = pop.getBoundingClientRect();
  // Layout viewport, NOT window.innerWidth/innerHeight: this is the same coordinate space as the
  // getBoundingClientRect values above, by construction — which is exactly what the paragraph above
  // says window.innerHeight failed to be. Measured equal today (920/640, scrollX/Y 0, dpr 1) in the
  // real window; using these keeps them equal on a machine where they would diverge.
  const { top, left } = destPopoverPosition(
    { top: r.top, bottom: r.bottom, left: r.left },
    popW,
    popH,
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  );
  pop.style.bottom = "auto";
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}


/** Open/close the destination popover (#fldz). Its own hidden state persists across renderFoot's
 *  innerHTML rewrites since #fldz is a sibling of #filfoot, never touched by them. Exported: Batch
 *  mode has its own Destination button (sift-live.ts) and must go through this same function —
 *  the popover is position:fixed with no CSS fallback, so any toggle that bypasses this and
 *  flips `fldz.hidden` directly leaves it unpositioned (rendered wherever it falls in the layout). */
export function toggleDestPopover(force?: boolean): void {
  const pop = document.getElementById("fldz");
  if (!pop) return;
  const opening = force !== undefined ? force : pop.hidden;
  pop.hidden = !opening;
  if (opening) positionDestPopover(pop);
}

// One-time (guarded) document listener: closes the destination popover on an outside click or
// Escape, like every other popover in the app (candidate lists, palettes). Also repositions it
// on resize while open, since position:fixed coordinates are frozen at open time.
let destPopoverAutoCloseWired = false;
export function ensureDestPopoverAutoClose(): void {
  if (destPopoverAutoCloseWired) return;
  destPopoverAutoCloseWired = true;
  window.addEventListener("resize", () => {
    const pop = document.getElementById("fldz");
    if (pop && !pop.hidden) positionDestPopover(pop);
  });
  // Capture phase: the #pa delegated handler (queue rows, etc.) calls stopPropagation() on most
  // clicks, which would otherwise stop this listener ever seeing them in the bubble phase.
  document.addEventListener(
    "click",
    (e) => {
      const pop = document.getElementById("fldz");
      if (!pop || pop.hidden) return;
      const target = e.target as Node;
      if (pop.contains(target) || (target as HTMLElement).closest?.('[data-fil="destbtn"]')) return;
      pop.hidden = true;
    },
    { capture: true },
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggleDestPopover(false);
  });
}

/** Load root+bins and render the destination column. Called from the live queue refresh. */
export async function refreshBins(fldz: HTMLElement): Promise<void> {
  await loadBins();
  renderBins(fldz);
}

/** Render the tree in batch pick mode (no reload — destState.bins already loaded). */
export function renderBinsForBatch(
  fldz: HTMLElement,
  selectedRel: string | null,
  onPick: (rel: string) => void,
  inert: boolean,
): void {
  binPick = { selectedRel, onPick, inert };
  renderBins(fldz);
}

/** Load bins then render the tree in batch pick mode (entry when switching into batch). */
export async function refreshBinsForBatch(
  fldz: HTMLElement,
  selectedRel: string | null,
  onPick: (rel: string) => void,
  inert: boolean,
): Promise<void> {
  binPick = { selectedRel, onPick, inert };
  await loadBins();
  renderBins(fldz);
}

/** Leave batch pick mode → tree reverts to detail's destState.binRel. */
export function clearBinPick(): void {
  binPick = null;
}

/** Update the batch tree's inert (greyed) flag WITHOUT rebuilding the tree — so binPick.inert stays
 *  the single source of truth that renderBins re-asserts on every render (incl. queue refreshes during
 *  a run). Called by the rail's ensureBatchDestUI on each rebuild. No-op outside batch pick mode. */
export function setBinPickInert(inert: boolean): void {
  if (binPick) binPick.inert = inert;
}
