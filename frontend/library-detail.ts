// Bibliothèque — détail d'une piste rangée, dans la zone D (Tauri only). Monte le rapport partagé
// (report-view : en-tête + audition + Diagnostic) et, dessous, la FICHE MÉTADONNÉES DE REVUE —
// même grammaire, mêmes classes (`.sift-meta-*`, `.sift-attr-*`, `.sift-cands-host`) : « ok pour le
// proposé », point 3 du wireframe « Rangés — inspecteur ouvert » (Antoine, 2026-09-08). L'éditeur
// d'avant (quatre champs bordés sans libellé, pochette « changer », « Voir la release »,
// « Enregistrer », « Supprimer ») est parti : les champs se gravent au BLUR / Entrée comme en Revue
// (décision du 2026-08-25, plus de bouton Enregistrer), la release choisie reste visible en ligne
// inerte (`chosenRowHtml`), et ce qui n'est pas une édition vit au clic droit de la ligne
// (`bibliotheque-view.ts::openBiblioContextMenu` : Fiche Discogs, Changer la pochette…, Envoyer à
// la corbeille).
//
// Ce qui est PARTAGÉ avec Revue : le rendu des candidats et de la ligne choisie (identify-shared.ts),
// le rapport (report-view.ts), les classes CSS de la fiche. Ce qui ne l'est pas, et pourquoi : le
// câblage. La fiche de Revue (filing-identify.ts) lit et écrit `RevueState` — canonical, fileTags,
// diff de tags, prévisualisation du nom — et grave par `write_tags_full` ; ici l'objet est un
// `LibraryTrack` rangé, gravé par `update_metadata` (tags puis base, annulable). Partager le markup
// par des classes et non par une fonction commune est un choix : un helper de markup à deux
// consommateurs qui écrivent des `data-*` différents divergerait à la première option.
import { updateMetadata, identify, applyRelease, revertBatch, libraryFolders } from "./ipc";
import type { Candidate } from "./ipc";
import type { LibraryTrack, MetadataEdit } from "../shared/contracts";
import { chosenRowHtml, identifyErrorHtml, renderCandidates, wireCandidateKeys } from "./identify-shared";
import { appliedIndex, candidatesFor, markApplied, otherCount, rememberCandidates } from "./identify-candidates";
import { T as TS } from "./i18n/identify-shared";
import { openReportInto } from "./report-view";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { requireEl, esc } from "./dom";
import { toast } from "./filing-toast";
import { humanizeError } from "./errors";
import { T } from "./i18n/library-detail";

/** État de la fiche ouverte (une seule à la fois). */
interface EditState {
  track: LibraryTrack;
  saving: boolean;
  /** L'enregistrement en vol, que le choix d'une release attend avant de prendre son « avant »
   *  (#68) : sinon « Rétablir » rendait une valeur que le fichier ne portait déjà plus. */
  pending: Promise<void> | null;
}

/** La fiche ouverte, pour les actions qui viennent d'AILLEURS que la fiche (le clic droit de la
 *  ligne : « Changer la pochette… »). `null` quand rien n'est ouvert. */
let openEdit: { edit: HTMLElement; st: EditState } | null = null;

/** Une rangée d'attribut dans la grammaire de Revue : libellé tertiaire sur rail fixe, valeur =
 *  un input stylé comme du texte au repos (`.sift-attr-input`), révélé au survol et au focus. */
function attrRow(label: string, inputHtml: string): string {
  return `<div class="sift-attr"><span class="sift-attr-k">${label}</span>${inputHtml}</div>`;
}

/** La release CHOISIE — même fonction que Revue (`chosenRowHtml`), reconstruite depuis la piste :
 *  label et année depuis la base, pochette locale. Pays et format n'existent pas sur
 *  `LibraryTrack` (pas de colonne backend, migration refusée en Revue : « je me fiche de
 *  l'édition ») — la sous-ligne se contente de ce qui est là. Contrôle qui rouvre la liste de la
 *  session quand il y en a une (#68), ligne inerte sinon. */
function chosenHtml(t: LibraryTrack): string {
  return chosenRowHtml(
    {
      artist: t.artist || "",
      title: t.title || "",
      sub: [t.label, t.year != null ? String(t.year) : null].filter(Boolean).join(" · "),
      coverSrc: t.cover_path ? convertFileSrc(t.cover_path) : null,
    },
    otherCount(candidatesFor(t.id)),
  );
}

/** Rend la fiche dans `edit`. Un seul rendu quel que soit l'état (direction B de Revue) :
 *  l'identification et l'édition remplissent les mêmes champs en place, jamais de re-render. */
function renderEdit(edit: HTMLElement, st: EditState): void {
  const t = st.track;
  const identified = !!t.discogs_release_id;
  const L = T();
  edit.innerHTML =
    `<div class="sift-meta-header">` +
    `<span class="sift-meta-title">${L.metadata}</span>` +
    `</div>` +
    `<div class="sift-meta-body">` +
    // Release choisie au repos (ligne inerte), candidats le temps d'une recherche, vide et masqué
    // sinon — l'identification OUVRE la fiche depuis le 2026-09-07 (Revue, même ordre ici).
    `<div class="sift-cands sift-cands-host"${identified ? "" : " hidden"}>${identified ? chosenHtml(t) : ""}</div>` +
    // Pas de badge « I » : le raccourci est celui de Revue (`shortcuts.ts`), il n'existe pas ici.
    `<div class="sift-meta-actions">` +
    `<button data-lib="identifier" class="sift-meta-ident-btn" title="${L.identifyTitle}">${t.artist && t.title ? L.reidentify : L.identify}</button>` +
    `</div>` +
    `<div class="sift-attr-list">` +
    attrRow(L.artist, `<input data-lib="artist" class="sift-attr-input" placeholder="—" aria-label="${L.artist}" value="${esc(t.artist ?? "")}">`) +
    attrRow(L.title, `<input data-lib="title" class="sift-attr-input" placeholder="—" aria-label="${L.title}" value="${esc(t.title ?? "")}">`) +
    attrRow(L.label, `<input data-lib="label" class="sift-attr-input" placeholder="—" aria-label="${L.label}" value="${esc(t.label ?? "")}">`) +
    // Année : borne native 1900-2100 (audit B4, 2026-07-24), re-vérifiée dans `doSave` — la borne
    // native ne tient pas une valeur tapée puis quittée.
    attrRow(L.year, `<input data-lib="year" type="number" min="1900" max="2100" class="sift-attr-input" placeholder="—" aria-label="${L.year}" value="${t.year ?? ""}">`) +
    // Genres : ÉDITABLES ici (Revue les montre en texte + icône tag, lecture seule — spec Revue
    // § Zone C, décision F). Un input dans la même rangée, autocomplété sur les genres déjà connus.
    attrRow(L.genres, `<input data-lib="genres" list="sift-genre-list" class="sift-attr-input" placeholder="—" aria-label="${L.genresAria}" value="${esc(t.genres.join(", "))}">`) +
    `<datalist id="sift-genre-list"></datalist>` +
    `</div>` +
    `</div>`;
  wireEdit(edit, st);
}

/** Lit les champs de la fiche en `MetadataEdit`. Chaînes vides → null ; genres découpés sur
 *  virgule / point-virgule, épurés, dédoublonnés dans l'ordre. `cover_path` toujours null ici :
 *  la pochette se grave à part (`changeCoverForOpenTrack`), jamais réenvoyée avec un champ. */
function collectEdit(edit: HTMLElement): MetadataEdit {
  const val = (sel: string) => edit.querySelector<HTMLInputElement>(`[data-lib="${sel}"]`)?.value ?? "";
  const trimOrNull = (s: string) => (s.trim() ? s.trim() : null);
  const yearRaw = val("year").trim();
  const year = yearRaw ? Number(yearRaw) : null;
  const seen = new Set<string>();
  const genres = val("genres")
    .split(/[,;]/)
    .map((g) => g.trim())
    .filter((g) => g && !seen.has(g) && seen.add(g));
  return {
    artist: val("artist").trim(),
    title: val("title").trim(),
    label: trimOrNull(val("label")),
    year: year != null && Number.isFinite(year) ? year : null,
    genres,
    cover_path: null,
  };
}

/** Genre names already known to the library (facet counts dropped), fetched once and reused
 * across every editor open — reuses the same `library_folders` IPC call bibliotheque-view.ts
 * already makes to populate its Genres facet, no new backend command added. */
let genreListCache: string[] | null = null;

/** Rebuild the `#sift-genre-list` datalist options from the Genres input's CURRENT value, so
 * autocomplete keeps working past the first comma. A native `<datalist>` filters its options
 * against the input's whole value, not the last comma-separated token — so for a multi-value
 * field like this one it silently stops suggesting anything after the first comma is typed. Fix:
 * on every keystroke, split off the last segment (after the last comma/semicolon), match it
 * against `names`, and emit each option as "already-typed-prefix + candidate" — the option's
 * full text still starts with what the user typed, so the browser's own whole-value prefix
 * filter keeps working, while what's actually offered/inserted is genre-name completion for just
 * the segment being typed. */
function renderGenreDatalist(datalist: HTMLDataListElement, value: string, names: string[]): void {
  const lastSep = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
  const prefix = lastSep >= 0 ? value.slice(0, lastSep + 1) + " " : "";
  const segment = (lastSep >= 0 ? value.slice(lastSep + 1) : value).trim().toLowerCase();
  const matches = segment ? names.filter((n) => n.toLowerCase().startsWith(segment)) : names;
  datalist.innerHTML = matches.map((n) => `<option value="${esc(prefix + n)}"></option>`).join("");
}

/** Fill the `#sift-genre-list` datalist so typing in Genres offers autocomplete against genres
 * already used elsewhere in the library (avoids "House" vs "house" duplicates), and keep it
 * re-filtered per comma-separated segment as the user types (see renderGenreDatalist). Best-effort:
 * a fetch failure just leaves the datalist empty, the free-text input keeps working either way. */
function fillGenreDatalist(edit: HTMLElement): void {
  const datalist = edit.querySelector<HTMLDataListElement>("#sift-genre-list");
  const input = edit.querySelector<HTMLInputElement>('[data-lib="genres"]');
  if (!datalist || !input) return;
  const rerender = () => {
    if (genreListCache) renderGenreDatalist(datalist, input.value, genreListCache);
  };
  input.addEventListener("input", rerender);
  if (genreListCache) {
    rerender();
    return;
  }
  void libraryFolders()
    .then((facets) => {
      genreListCache = facets.genres.map((g) => g.name);
      rerender();
    })
    .catch((e) => console.error("genre datalist load failed", e));
}

/** Câble la fiche : champs gravés au blur / Entrée, Échap annule, bouton d'identification.
 *
 *  Même contrat que Revue (`filing-identify.ts`, 2026-08-25) : un champ se grave quand on FINIT
 *  de l'éditer, jamais à la frappe ; Échap rend la valeur d'avant le focus et ne grave rien — le
 *  drapeau `cancel` est lu par le handler de blur que `blur()` déclenche synchroniquement, donc
 *  sa durée de vie est exactement celle de l'appel (le bug du 2026-08-25 en Revue : Échap
 *  restaurait à l'écran puis le blur gravait la valeur restaurée… ou pas). */
function wireEdit(edit: HTMLElement, st: EditState): void {
  fillGenreDatalist(edit);
  edit.querySelectorAll<HTMLInputElement>(".sift-attr-input").forEach((inp) => {
    let focusVal = inp.value;
    let cancel = false;
    inp.addEventListener("focus", () => {
      focusVal = inp.value;
      cancel = false;
    });
    inp.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      } else if (e.key === "Escape") {
        inp.value = focusVal;
        cancel = true;
        inp.blur();
      }
    });
    inp.addEventListener("blur", () => {
      if (cancel) {
        cancel = false;
        return;
      }
      if (inp.value !== focusVal) void doSave(edit, st);
    });
  });

  const idBtn = edit.querySelector<HTMLButtonElement>('[data-lib="identifier"]');
  const candsHost = edit.querySelector<HTMLElement>(".sift-cands-host");
  if (idBtn && candsHost) {
    idBtn.addEventListener("click", () => void doIdentify(idBtn, candsHost, edit, st));
    wireLibCandidateHost(candsHost, edit, st);
  }
}

/** « Changer la pochette… » — depuis le clic droit de la ligne (bibliotheque-view.ts), sur la
 *  piste dont la fiche est ouverte. Choisit une image, la grave AUSSITÔT (`update_metadata`, les
 *  autres champs tels qu'ils sont), et la pose dans l'en-tête du rapport comme Revue le fait après
 *  une identification (`.sift-report-cover`). Plus de « pochette en attente d'Enregistrer ». */
export async function changeCoverForOpenTrack(): Promise<void> {
  if (!openEdit) return;
  const { edit, st } = openEdit;
  const file = await open({
    multiple: false,
    directory: false,
    filters: [{ name: T().imageFilter, extensions: ["jpg", "jpeg", "png"] }],
  });
  if (typeof file !== "string") return;
  const e = { ...collectEdit(edit), cover_path: file };
  if (!e.title) {
    toast(T().titleEmpty);
    return;
  }
  try {
    await updateMetadata(st.track.id, e);
    st.track.cover_path = file;
    st.track.has_cover = true;
    paintHeaderCover(edit, file);
    notifyChanged(st.track);
    toast(T().coverChanged);
  } catch (err) {
    toast(humanizeError(err, T().coverFailed, "update_metadata"));
  }
}

/** Pose une pochette dans l'en-tête du rapport de la colonne — même geste que Revue
 *  (`filing-identify.ts`, `.sift-report-cover`) : `onerror` re-masque l'image si le fichier ne
 *  décode pas (Discogs rend parfois un « no image »), et le repli ::before reprend. `null` la
 *  retire : une release sans pochette vient de la retirer du fichier aussi (#68, « Vider »). */
function paintHeaderCover(edit: HTMLElement, coverPath: string | null): void {
  const host = edit.closest<HTMLElement>("#sift-aside") ?? document;
  if (!coverPath) {
    host.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
      covEl.hidden = true;
      covEl.removeAttribute("src");
    });
    return;
  }
  const src = convertFileSrc(coverPath);
  host.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
    covEl.onerror = () => {
      covEl.hidden = true;
    };
    covEl.src = src;
    covEl.hidden = false;
  });
}

/** Recherche Discogs pour la piste ouverte. Liste OUVERTE comme en Revue (fork F) : tous les
 *  candidats visibles, le meilleur pré-sélectionné, sous le bouton qui la lance. */
async function doIdentify(
  btn: HTMLButtonElement,
  host: HTMLElement,
  edit: HTMLElement,
  st: EditState,
): Promise<void> {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = T().searching;
  host.hidden = false;
  host.innerHTML = '<div class="sift-cands-msg">' + T().searching + "</div>";
  try {
    // Ce que le formulaire affiche, pas les tags du fichier (issue #67). Le titre y est COMPLET,
    // version comprise : `version: null`, la version s'en détache côté Rust.
    const field = (k: string): string => edit.querySelector<HTMLInputElement>(`[data-lib="${k}"]`)?.value ?? "";
    const candidates = await identify(st.track.id, { artist: field("artist"), title: field("title"), version: null });
    if (candidates.length === 0) {
      // Rien de trouvé : la liste d'une recherche précédente reste celle que la ligne rouvre, et la
      // ligne reste affichée sous le message.
      renderCandidates(host, candidates);
      if (st.track.discogs_release_id) host.insertAdjacentHTML("beforeend", chosenHtml(st.track));
      return;
    }
    // Gardés pour la session (#68) : la ligne choisie rouvrira cette liste sans requête. Pas de
    // version de repli : la fiche montre le titre complet, version comprise. La release appliquée
    // vient de la piste (`discogs_release_id`) : sans elle, la liste sélectionnait le premier
    // candidat, et un clic sur la release déjà liée la réécrivait.
    rememberCandidates(st.track.id, candidates, null);
    markApplied(st.track.id, st.track.discogs_release_id ?? null);
    openLibCandidateList(host, st);
  } catch (err) {
    // Même cascade que `filing-identify.ts`, et c'est le problème qu'on retire : elle était
    // recopiée ici, donc les impasses A9 et A10 (issue #15) y vivaient en double. Une seule
    // source désormais — `identifyErrorHtml`.
    const { html, gotoReglages } = identifyErrorHtml(err);
    host.innerHTML =
      html +
      (gotoReglages
        ? `<button class="sift-cand-jump sift-goto-reglages" data-lib="goto-reglages"><i class="ti ti-arrow-right"></i> ${T().openSettings}</button>`
        : "");
    host.querySelector('[data-lib="goto-reglages"]')?.addEventListener("click", () => {
      requireEl('[data-view="reglages"]', "library-detail goto-reglages").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // La ligne choisie reste sous le message d'échec (#68) : la liste connue s'y rouvre encore.
    if (st.track.discogs_release_id) host.insertAdjacentHTML("beforeend", chosenHtml(st.track));
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

/** Repeint la fiche sur `st.track` après le choix d'une release OU son « Rétablir » (#68) — une
 *  seule peinture pour les deux sens : champs, pochette de l'en-tête, ligne choisie, bouton. */
function paintLibIdentity(edit: HTMLElement, st: EditState, host: HTMLElement): void {
  const t = st.track;
  const set = (sel: string, v: string) => {
    const inp = edit.querySelector<HTMLInputElement>(`[data-lib="${sel}"]`);
    if (inp) inp.value = v;
  };
  set("artist", t.artist ?? "");
  set("title", t.title ?? "");
  set("label", t.label ?? "");
  set("year", t.year != null ? String(t.year) : "");
  set("genres", t.genres.join(", "));
  paintHeaderCover(edit, t.cover_path);
  const identified = !!t.discogs_release_id;
  const idBtn = edit.querySelector<HTMLButtonElement>('[data-lib="identifier"]');
  if (idBtn) idBtn.textContent = t.artist && t.title ? T().reidentify : T().identify;
  host.hidden = !identified;
  host.innerHTML = identified ? chosenHtml(t) : "";
}

/** Ce qui suit une release appliquée ou rétablie, fiche ouverte ou non : la ligne de la table
 *  (`savedCb` patche par id, donc sans risque quelle que soit la fiche ouverte) et le cache des
 *  genres — une release peut en apporter de nouveaux, même raison que `doSave`. */
function recordLibIdentity(t: LibraryTrack): void {
  markApplied(t.id, t.discogs_release_id ?? null);
  genreListCache = null;
  notifyChanged(t);
}

/** Applique la release `c` à la piste rangée (#68) : `apply_release` grave le fichier ET la base —
 *  jusqu'ici la Bibliothèque ne changeait que le lien en base, et le fichier gardait ses tags.
 *  Titre COMPLET et `version: null` : la fiche montre le titre entier, la base le coupe elle-même.
 *  Le toast porte « Rétablir », qui rend le fichier ET la release d'avant. */
async function applyChosenLib(c: Candidate, host: HTMLElement, edit: HTMLElement, st: EditState): Promise<void> {
  const trackId = st.track.id;
  const list = host.querySelector<HTMLElement>(".sift-cands-list");
  list?.setAttribute("aria-busy", "true");
  list?.classList.add("sift-cands-busy");
  // Un champ modifié puis un clic direct sur un candidat : le blur a lancé l'enregistrement, qui
  // réécrit le fichier AVANT `apply_release`. Prendre l'« avant » ici, pendant qu'il vole, ferait
  // rendre à « Rétablir » la valeur d'avant la saisie.
  if (st.pending) await st.pending;
  const before: LibraryTrack = { ...st.track, genres: [...st.track.genres] };
  try {
    const applied = await applyRelease(trackId, c, c.title, null);
    // Le modèle suit l'écriture même si la fiche s'est fermée ou a changé de piste ; seul le
    // repeint en dépend. Le toast part toujours : son « Rétablir » est le seul filet de ce lot.
    st.track.artist = c.artist;
    st.track.title = c.title;
    st.track.label = applied.label;
    st.track.year = applied.year;
    st.track.genres = applied.styles;
    st.track.discogs_release_id = c.release_id;
    st.track.cover_path = applied.cover_path;
    // Une panne de pochette garde celle d'avant (fichier et base) : le drapeau aussi.
    st.track.has_cover = applied.cover_failed ? before.has_cover : applied.cover_path != null;
    recordLibIdentity(st.track);
    if (openEdit?.st === st) paintLibIdentity(edit, st, host);
    toast(applied.cover_failed ? TS().releaseAppliedNoCover : TS().releaseApplied, true, () => {
      void revertBatch(applied.batch_id)
        .then(() => {
          st.track = { ...before, genres: [...before.genres] };
          recordLibIdentity(st.track);
          if (openEdit?.st === st) paintLibIdentity(edit, st, host);
        })
        .catch((err: unknown) => {
          console.error("revert_batch (release) failed", err);
          toast(T().undoFailed);
        });
    });
  } catch (e) {
    if (openEdit?.st !== st) return;
    list?.removeAttribute("aria-busy");
    list?.classList.remove("sift-cands-busy");
    host.querySelector(".sift-cand-pending")?.classList.remove("sift-cand-pending");
    host.querySelector(".sift-cands-error")?.remove();
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>${esc(humanizeError(e, T().applyFailed, "apply_release"))}</div>`,
    );
  }
}

/** La liste de la session, la release appliquée sélectionnée — même geste qu'en Revue. */
function openLibCandidateList(host: HTMLElement, st: EditState): void {
  const session = candidatesFor(st.track.id);
  if (!session) return;
  const sel = Math.max(appliedIndex(session), 0);
  host.hidden = false;
  renderCandidates(host, session.list, sel);
  host.querySelectorAll<HTMLElement>("[data-cand]")[sel]?.focus();
}

/** Referme la liste sur la ligne choisie, ou sur rien. `true` si une liste était ouverte. */
function closeLibCandidateList(host: HTMLElement, st: EditState): boolean {
  if (!host.querySelector(".sift-cands-list")) return false;
  const identified = !!st.track.discogs_release_id;
  host.hidden = !identified;
  host.innerHTML = identified ? chosenHtml(st.track) : "";
  host.querySelector<HTMLElement>("[data-cand-switch]")?.focus();
  return true;
}

/** Câblage délégué de l'hôte des candidats, posé une fois par rendu de la fiche — voir
 *  `filing-identify.ts::wireCandidateHost`, dont c'est le pendant. */
function wireLibCandidateHost(host: HTMLElement, edit: HTMLElement, st: EditState): void {
  host.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (target.closest("[data-cand-switch]")) {
      openLibCandidateList(host, st);
      return;
    }
    const row = target.closest<HTMLElement>("[data-cand]");
    if (!row || host.querySelector(".sift-cands-busy")) return;
    const session = candidatesFor(st.track.id);
    const idx = Number(row.dataset.cand);
    const c = session?.list[idx];
    if (!session || !c) return;
    if (idx === appliedIndex(session)) {
      closeLibCandidateList(host, st);
      return;
    }
    row.classList.add("sift-cand-pending");
    void applyChosenLib(c, host, edit, st);
  });
  wireCandidateKeys(host, () => closeLibCandidateList(host, st));
}

/** Grave les champs (tags du fichier d'abord, puis base) — au blur / Entrée d'un champ modifié.
 *  Annulable depuis le toast (`revert_batch`), comme avant. */
async function doSave(edit: HTMLElement, st: EditState): Promise<void> {
  if (st.saving) return;
  const e = collectEdit(edit);
  if (!e.title) {
    toast(T().titleEmpty);
    return;
  }
  if (e.year != null && (e.year < 1900 || e.year > 2100)) {
    toast(T().yearOutOfRange);
    return;
  }
  st.saving = true;
  st.pending = saveNow(st, e).finally(() => {
    st.saving = false;
    st.pending = null;
  });
  await st.pending;
}

/** Le corps de `doSave`, une fois la saisie validée. Ne rejette jamais : un échec se dit en toast. */
async function saveNow(st: EditState, e: MetadataEdit): Promise<void> {
  try {
    const batchId = await updateMetadata(st.track.id, e);
    st.track.artist = e.artist;
    st.track.title = e.title;
    st.track.label = e.label;
    st.track.year = e.year;
    st.track.genres = e.genres;
    // A save can introduce a brand-new genre — drop the cache so the next datalist fill (any
    // editor opened afterward) refetches and offers it, instead of only picking it up after a
    // full app restart (defeats the point of the datalist: avoiding "House"/"house" duplicates
    // within the same session).
    genreListCache = null;
    notifyChanged(st.track);
    toast(T().saved, true, () => {
      void revertBatch(batchId).catch((err: unknown) => {
        console.error("revert_batch failed", err);
        toast(T().undoFailed);
      });
    });
  } catch (err) {
    toast(humanizeError(err, T().saveFailed, "update_metadata"));
  }
}

// Callbacks set per open: keep the Bibliothèque list in sync without owning its markup.
let savedCb: ((t: LibraryTrack) => void) | null = null;
function notifyChanged(t: LibraryTrack): void {
  savedCb?.(t);
}

/** Ouvre le détail d'une piste rangée dans `host` (la zone D).
 * `onSaved` permet à l'appelant de rafraîchir la ligne de la table en place (le lecteur survit).
 * `onDeleted` et `onClose` restent dans la signature : la corbeille et la fermeture ont quitté la
 * fiche (clic droit de la ligne, re-clic de la ligne), mais `bibliotheque-view.ts` les passe
 * encore et pourrait les rebrancher — ils sont ignorés ici, pas supprimés du contrat. */
export function openLibraryDetailInto(
  host: HTMLElement,
  track: LibraryTrack,
  onSaved: (t: LibraryTrack) => void,
  onDeleted: () => void,
  onClose: () => void,
): void {
  savedCb = onSaved;
  void onDeleted;
  void onClose;
  const st: EditState = { track: { ...track, genres: [...track.genres] }, saving: false, pending: null };
  // La mémoire des candidats suit la base à chaque ouverture (#68) : c'est ce qui la remet d'aplomb
  // après un Ctrl+Z, qui annule un changement de release sans passer par cette fiche.
  markApplied(track.id, track.discogs_release_id ?? null);

  // « Ok pour le proposé » (Antoine, 2026-09-08, wireframe « Rangés — inspecteur ouvert ») : la
  // colonne parle Revue. La carte « Piste ouverte » (titre + chevron) est partie — elle ne disait
  // rien que la ligne surlignée et l'en-tête du lecteur ne disent déjà ; fermer = re-cliquer la ligne
  // (`openBiblioDetail`, bibliotheque-view.ts). Le rapport et la fiche reposent sur le sol de la
  // colonne, sans carte (patron Finder « Lire les informations »).
  // Ordre de Revue : en-tête + audition, Métadonnées, Diagnostic. Le Diagnostic sort du rapport
  // pour un slot à lui (`.lib-diag`, 5ᵉ argument d'`openReportInto`, le même mécanisme que Revue
  // avec `#sift-aside`) — sinon il se peindrait AVANT la fiche, dans le scroll du rapport.
  host.innerHTML =
    '<div class="lib-detail-stack">' +
    '<div class="lib-report"></div>' +
    '<div class="lib-edit"></div>' +
    '<div class="lib-diag"></div>' +
    '<div class="lib-verdict"></div>' +
    "</div>";
  const reportEl = requireEl<HTMLElement>(".lib-report", "openLibraryDetailInto", host);
  const editEl = requireEl<HTMLElement>(".lib-edit", "openLibraryDetailInto", host);
  const diagEl = requireEl<HTMLElement>(".lib-diag", "openLibraryDetailInto", host);
  // Le slot verdict ne porte plus que les états transitoires de l'analyse (squelette), comme en
  // Revue — le mot de verdict vit dans l'en-tête du lecteur.
  const verdictEl = requireEl<HTMLElement>(".lib-verdict", "openLibraryDetailInto", host);
  // L'en-tête du lecteur porte le TITRE et l'ARTISTE (`.sift-report-name` / `.sift-report-sub`),
  // comme Revue après reconcile (`filing-preview.ts::updateHeaderName`) — plus le nom de fichier
  // en 15/600 sur trois lignes. Sans artiste ni titre, le nom de fichier reste (défaut du rapport).
  void openReportInto(
    reportEl,
    track.path,
    verdictEl,
    {
      showAnalysisFailure: false,
      title: track.title || undefined,
      subtitle: track.artist || undefined,
    },
    diagEl,
  );
  // La pochette de l'en-tête à l'OUVERTURE, comme Revue au réopen (`restoreHeroCover`) : la coque
  // du rapport est posée synchroniquement par `openReportInto`, l'image y est déjà, masquée.
  if (track.cover_path) paintHeaderCover(editEl, track.cover_path);
  renderEdit(editEl, st);
  openEdit = { edit: editEl, st };
}
