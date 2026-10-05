import { identify, applyRelease, applyTags, trackFileTags, openUrl, revertBatch } from "./ipc";
import type { Candidate } from "./ipc";
import type { Canonical } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { chosenRowHtml, identifyErrorHtml, identifyHint, renderCandidates, wireCandidateKeys } from "./identify-shared";
import {
  appliedIndex,
  candidatesFor,
  markApplied,
  otherCount,
  rememberCandidates,
  shownTitle,
} from "./identify-candidates";
import { T as TS } from "./i18n/identify-shared";
import { requireEl, esc } from "./dom";
import { state, openState } from "./filing-state";
import { toast } from "./filing-toast";
import { refreshPreview, updateHeaderName } from "./filing-preview";
import { humanizeError } from "./errors";
import { T } from "./i18n/filing-identify";
import { coalesceLatest } from "./coalesce-latest";

// Exclusive accordion (shadcn Accordion reference, ui.shadcn.com/docs/components/base/accordion):
// opening Métadonnées closes Diagnostic and vice versa. Coordinated with report-view.ts (no
// shared ancestor passed down) via a document-level event — see the matching listener there for
// why a single module-load-time registration doesn't leak across track re-opens.
let closeMetaZone: (() => void) | null = null;
document.addEventListener("sift:accordion-open", (e) => {
  if ((e as CustomEvent).detail?.zone !== "metadonnees") closeMetaZone?.();
});

// Per-track Discogs release facts (label/year/country/format), captured when an identity is
// applied so they survive a close+reopen of the SAME track within the session. `reconcile` (the
// only open-time read) doesn't return them, and re-reading would need a new IPC — so we hold them
// in memory. Keyed by track id. Cross-session reopen won't repopulate this (a fresh process starts
// empty) — country/format additionally have no persisted backend column at all (unlike label/year,
// which trackRelease re-populates from the `metadata` table on a real reopen), so those two are
// session-only regardless of process lifetime.
// `releaseId` (#68) dit À QUELLE release ces faits appartiennent : un « Rétablir » ou un Ctrl+Z fait
// ailleurs peut ramener la base sur une autre release, et le pays et le format mis en cache ne
// valent alors plus rien (`openFilingInto` les écarte quand l'id ne correspond plus).
export const releaseCache = new Map<
  number,
  { label: string | null; year: number | null; country: string | null; format: string | null; releaseId: string | null }
>();

/** Render the genres into `.sift-genres` from `state.genres` (single source — set on open from
 *  track_release, or from `applied.styles` on identify) as plain text preceded by a tag glyph
 *  (fork F, 2026-08-24 — plus de chips colorées par famille). Empty list → empty box. */
export function renderGenres(): void {
  const el = document.querySelector<HTMLElement>(".sift-genres");
  if (!el) return; // editor not mounted
  el.innerHTML = state.genres.length
    ? `<i class="ti ti-tag sift-genres-tagicon" aria-hidden="true"></i>${esc(state.genres.join(", "))}`
    : "";
}

/** Join genres EXACTLY like write_tags_full (trim, drop empties, "A; B"), so the comparison against
 *  the file's single Genre field is like-for-like. */
const joinGenres = (g: string[]): string => g.map((s) => s.trim()).filter(Boolean).join("; ");

/** Which displayed tag fields would CHANGE the file if written — i.e. diverge from `state.fileTags`.
 *  Mirrors write_tags_full's semantics: artist/title are ALWAYS written (compare directly), while
 *  label/year/genres are only written when non-empty (an empty would-write never clears the file, so
 *  it is NOT a discrepancy). All comparison is in memory against the on-open snapshot — no disk read. */
function tagFieldDiffs(): { artist: boolean; title: boolean; label: boolean; year: boolean; genres: boolean; any: boolean } {
  const f = state.fileTags;
  const c = state.canonical;
  const none = { artist: false, title: false, label: false, year: false, genres: false, any: false };
  if (!f || !c) return none; // snapshot not loaded yet → show nothing rather than a false alarm
  const norm = (s: string | null | undefined): string => (s ?? "").trim();
  // Non-empty guard added (annotation: "quand les champs sont vides, je ne veux pas de texte en
  // italique") — an untyped/not-yet-identified field showing "stale" (italic+warning) read as a
  // real conflict when it was really just nothing entered yet. Same non-empty guard label/year/
  // genres already had below; artist/title never had it.
  const artistW = norm(c.artist);
  const artist = artistW !== "" && artistW !== norm(f.artist);
  // Mirrors naming::tag_title (Rust) — the ID3 Title tag now includes the version suffix on
  // write, so the comparison must too. Without this, editing ONLY the version field never
  // changed titleW vs f.title (version was silently ignored here), leaving "Appliquer" greyed
  // out no matter what was typed (annotation: "le bouton appliquer reste grisé si on edit la
  // version"). c.version is never sent to the write itself — building the same combined string
  // on both sides so they compare like-for-like, not two different sources deriving one value.
  const versionW = norm(c.version);
  const titleW = norm(versionW ? `${c.title} (${versionW})` : c.title);
  const title = titleW !== "" && titleW !== norm(f.title);
  // Label rides on Canonical now (editable) — compare the EDITED value against the file, like
  // artist/title. Same non-empty guard: a blank label never counts as a discrepancy (write_tags_full
  // won't clear the file's existing one either).
  const labelW = norm(c.label);
  const label = labelW !== "" && labelW !== norm(f.label);
  const yearW = state.year ?? 0;
  const year = yearW > 0 && yearW !== (f.year ?? 0);
  const genresW = joinGenres(state.genres);
  const genres = genresW !== "" && genresW !== norm(f.genre_joined);
  return { artist, title, label, year, genres, any: artist || title || label || year || genres };
}

/** Show/hide the "tags not written" banner and mark the diverging fields. Cheap (a few
 *  querySelectors + class toggles) — safe to call on open, on each field edit, and after Apply/File.
 *  Reads `state.fileTags` (the cached snapshot), never the disk. */
export function refreshDiscrepancy(): void {
  const editor = document.querySelector<HTMLElement>(".sift-fil-editor");
  if (!editor) return;
  const d = tagFieldDiffs();
  const banner = editor.querySelector<HTMLElement>(".sift-tag-warn");
  // Visibility via display ONLY (the banner has no `hidden` attribute — that conflicted with an
  // inline display and kept it stuck on). flex when there's a discrepancy, none otherwise.
  if (banner) banner.style.display = d.any ? "flex" : "none";
  const mark = (sel: string, on: boolean) =>
    editor.querySelector<HTMLElement>(sel)?.classList.toggle("sift-tag-stale", on);
  mark('[data-fil="artist"]', d.artist);
  mark('[data-fil="title"]', d.title);
  mark(".sift-genres", d.genres);
}

/** Ce que la fiche montre de l'identité d'une piste — de quoi la repeindre après le choix d'une
 *  release (#68) ET après son « Rétablir ». Une seule peinture pour les deux sens : un « Rétablir »
 *  qui repeindrait autrement que le choix finirait par ne plus défaire ce que le choix a fait. */
interface IdentityView {
  canonical: Canonical;
  label: string | null;
  year: number | null;
  country: string | null;
  format: string | null;
  coverPath: string | null;
  genres: string[];
  identified: boolean;
  /** La release que la mémoire de session doit tenir pour appliquée, `null` si inconnue. */
  releaseId: string | null;
}

/** L'identité affichée MAINTENANT — prise avant un choix, pour que « Rétablir » la rende. */
function captureIdentity(): IdentityView | null {
  if (!state.canonical) return null;
  return {
    canonical: { ...state.canonical },
    label: state.label,
    year: state.year,
    country: state.releaseCountry,
    format: state.releaseFormat,
    coverPath: state.coverPath,
    genres: [...state.genres],
    identified: state.identified,
    releaseId: state.releaseId,
  };
}

/** Ce que la session doit retenir d'une identité, que la fiche soit encore ouverte ou non : la
 *  release appliquée (mémoire des candidats) et les faits de release en cache. Appelé AVANT toute
 *  garde d'`openSeq` — la revue de #68 a montré qu'un « Rétablir » cliqué après avoir ouvert une
 *  autre piste laissait sinon la mémoire sur la release annulée. */
function recordIdentity(trackId: number, v: IdentityView): void {
  markApplied(trackId, v.releaseId);
  releaseCache.set(trackId, { label: v.label, year: v.year, country: v.country, format: v.format, releaseId: v.releaseId });
}

/** La ligne de la release choisie, ou rien : l'hôte se masque tant que la piste n'est pas
 *  identifiée. Porte « N autres » quand la session connaît d'autres candidats (#68). */
function paintChosenRow(host: HTMLElement): void {
  const markup = chosenRowMarkup();
  host.innerHTML = markup;
  host.hidden = !markup;
}

/** Le markup de la ligne choisie, `""` pour une piste pas encore identifiée. Sert aussi SOUS un
 *  message (recherche vide ou en échec) : la ligne et son « N autres » restent atteignables. */
function chosenRowMarkup(): string {
  const c = state.canonical;
  if (!state.track || !c || !state.identified) return "";
  return chosenRowHtml(
    {
      artist: c.artist,
      title: c.version ? `${c.title} (${c.version})` : c.title,
      sub: [state.label, state.year != null ? String(state.year) : null, state.releaseCountry, state.releaseFormat]
        .filter(Boolean)
        .join(" · "),
      coverSrc: state.coverPath ? convertFileSrc(state.coverPath) : null,
    },
    otherCount(candidatesFor(state.track.id)),
  );
}

/** Repeint la fiche sur `v` : état, champs, nom final, pochette, genres, ligne choisie. */
function paintIdentity(v: IdentityView, editor: HTMLElement, mid: HTMLElement, host: HTMLElement, idBtn: HTMLButtonElement): void {
  if (!state.track) return;
  state.canonical = { ...v.canonical };
  state.label = v.label;
  state.year = v.year;
  state.releaseCountry = v.country;
  state.releaseFormat = v.format;
  state.coverPath = v.coverPath;
  state.genres = [...v.genres];
  state.identified = v.identified;
  state.releaseId = v.releaseId;

  const set = (sel: string, val: string) => {
    const inp = editor.querySelector<HTMLInputElement>(`[data-fil="${sel}"]`);
    if (inp) inp.value = val;
  };
  set("artist", v.canonical.artist);
  set("title", v.canonical.title);
  set("version", v.canonical.version ?? "");
  set("label", v.canonical.label ?? "");
  refreshPreview();
  updateHeaderName(mid);

  // La pochette du héros ne vient QUE de la base (`restoreCover`) : sans chemin, elle se masque —
  // une release sans pochette vient de la retirer du fichier aussi (décision « Vider »).
  mid.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
    if (!v.coverPath) {
      covEl.hidden = true;
      covEl.removeAttribute("src");
      return;
    }
    // Discogs sometimes returns a placeholder ("no image") that fails to decode — re-hide on error
    // so the vinyl ::before fallback shows instead of a broken-image glyph on top of it.
    covEl.onerror = () => { covEl.hidden = true; };
    covEl.src = convertFileSrc(v.coverPath);
    covEl.hidden = false;
  });

  renderGenres();
  refreshRebuyLink();
  paintChosenRow(host);
  // TEXTE SEUL, comme le premier rendu de ce bouton : c'est le MÊME bouton dans un autre état.
  idBtn.textContent = v.identified ? T().reidentify : T().identify;
  refreshDiscrepancy();
}

/** Applique la release `c` (#68) : `apply_release` grave le fichier ET la base en un seul lot, puis
 *  la fiche se repeint sur ce qui a été gravé. Remplace `applyIdentity` + `doApplyTags` : le second
 *  ne faisait que poser par-dessus, et laissait sur le fichier le label ou la pochette de la
 *  release d'avant. Le toast porte « Rétablir », qui rend le fichier ET la release d'avant. */
async function applyChosen(
  c: Candidate,
  host: HTMLElement,
  editor: HTMLElement,
  mid: HTMLElement,
  idBtn: HTMLButtonElement,
): Promise<void> {
  if (!state.track || !state.canonical) return;
  const trackId = state.track.id;
  const session = candidatesFor(trackId);
  const before = captureIdentity();
  if (!before) return;
  // FIX-21: openState.openSeq-guarded — a slow apply resolving after the user opened another track
  // must not paint the fetched release onto that track's pane.
  const myseq = openState.openSeq;
  const shown = shownTitle(c, session ? session.fallbackVersion : state.canonical.version);
  const list = host.querySelector<HTMLElement>(".sift-cands-list");
  list?.setAttribute("aria-busy", "true");
  list?.classList.add("sift-cands-busy");
  try {
    const applied = await applyRelease(trackId, c, shown.title, shown.version);
    const after: IdentityView = {
      canonical: { ...before.canonical, artist: c.artist, title: shown.title, version: shown.version, label: applied.label },
      label: applied.label,
      year: applied.year,
      country: c.country,
      format: c.format,
      coverPath: applied.cover_path,
      genres: applied.styles,
      identified: true,
      releaseId: c.release_id,
    };
    // La session et le cache suivent l'écriture même si une autre piste s'est ouverte entre-temps ;
    // seule la repeinture en dépend. Le toast aussi part toujours : son « Rétablir » est le seul
    // filet de ce lot (le Journal n'affiche pas les `tag_edit`).
    recordIdentity(trackId, after);
    if (myseq === openState.openSeq) {
      paintIdentity(after, editor, mid, host, idBtn);
      await refreshFileTags(trackId, myseq);
    }
    const L = TS();
    toast(applied.cover_failed ? L.releaseAppliedNoCover : L.releaseApplied, true, () => {
      void revertBatch(applied.batch_id)
        .then(async () => {
          recordIdentity(trackId, before);
          if (myseq !== openState.openSeq) return;
          paintIdentity(before, editor, mid, host, idBtn);
          await refreshFileTags(trackId, myseq);
        })
        .catch((e) => {
          console.error("revertBatch (release) failed", e);
          toast(TS().undoFailed, false);
        });
    });
  } catch (e) {
    if (myseq !== openState.openSeq) return;
    list?.removeAttribute("aria-busy");
    list?.classList.remove("sift-cands-busy");
    host.querySelector(".sift-cand-pending")?.classList.remove("sift-cand-pending");
    // [m10] errors get a warning icon to distinguish from "no results" — au-dessus de la liste,
    // qui reste là : un autre candidat peut encore se choisir.
    host.querySelector(".sift-cands-error")?.remove();
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>${esc(humanizeError(e, T().applyFailed, "apply_release"))}</div>`,
    );
  }
}

/** Le fichier vient de changer : relit ses tags pour que le bandeau d'écart compare au vrai. */
async function refreshFileTags(trackId: number, myseq: number): Promise<void> {
  try {
    const snap = await trackFileTags(trackId);
    if (myseq !== openState.openSeq) return;
    state.fileTags = snap;
    refreshDiscrepancy();
  } catch (e) {
    console.error("track_file_tags failed", e);
  }
}

/** Ouvre la liste des candidats de la session dans `host`, la release appliquée sélectionnée et
 *  focalisée — le premier candidat quand aucune ne l'est. Aucune requête : la liste est celle de la
 *  dernière recherche (#68). */
function openCandidateList(host: HTMLElement): void {
  if (!state.track) return;
  const session = candidatesFor(state.track.id);
  if (!session) return;
  const sel = Math.max(appliedIndex(session), 0);
  host.hidden = false;
  renderCandidates(host, session.list, sel);
  host.querySelectorAll<HTMLElement>("[data-cand]")[sel]?.focus();
}

/** Referme la liste sur la ligne choisie (ou sur rien, pour une piste pas encore identifiée), le
 *  focus rendu à la ligne quand elle est un contrôle. Rend `true` si une liste était ouverte. */
function closeCandidateList(host: HTMLElement): boolean {
  if (!host.querySelector(".sift-cands-list")) return false;
  paintChosenRow(host);
  host.querySelector<HTMLElement>("[data-cand-switch]")?.focus();
  return true;
}

/** Le câblage de l'hôte des candidats, posé UNE fois à chaque rendu de l'éditeur : l'hôte survit
 *  aux rendus de son contenu, les écouteurs délégués aussi — pas d'accumulation d'un choix à
 *  l'autre. La ligne choisie rouvre la liste ; dans la liste, la release appliquée la referme sans
 *  rien écrire, une autre s'applique. */
function wireCandidateHost(host: HTMLElement, editor: HTMLElement, mid: HTMLElement, idBtn: HTMLButtonElement): void {
  host.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (target.closest("[data-cand-switch]")) {
      openCandidateList(host);
      return;
    }
    const row = target.closest<HTMLElement>("[data-cand]");
    if (!row || !state.track || host.querySelector(".sift-cands-busy")) return;
    const session = candidatesFor(state.track.id);
    const idx = Number(row.dataset.cand);
    const c = session?.list[idx];
    if (!session || !c) return;
    if (idx === appliedIndex(session)) {
      closeCandidateList(host);
      return;
    }
    row.classList.add("sift-cand-pending");
    void applyChosen(c, host, editor, mid, idBtn);
  });
  wireCandidateKeys(host, () => closeCandidateList(host));
}

/** On reopen of an already-identified track, restore the hero cover (mid `.sift-report-cover`) from
 *  the Discogs cover path — the identity's cover isn't carried by the analysis report, so without
 *  this the hero/player cover stayed hidden until you re-ran Identify
 *  (docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md décision #5). Discogs
 *  placeholder art can fail to decode → re-hide on error, same as paintIdentity. In direction B
 *  the identity itself is shown by the always-visible attribute inputs, so no "Identifié :" line is
 *  drawn on reopen — only the cover needs restoring. */
export function restoreCover(mid: HTMLElement, coverPath: string | null): void {
  if (!coverPath) return;
  const src = convertFileSrc(coverPath);
  mid.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
    covEl.onerror = () => { covEl.hidden = true; };
    covEl.src = src;
    covEl.hidden = false;
  });
}

/** Run the Discogs identify flow for the current track. */
/** Vrai dès que l'utilisateur a tapé dans un champ depuis l'ouverture de la piste (`upd`), remis à
 *  faux à chaque rendu de l'éditeur. Décide si `doIdentify` envoie l'écran comme indice. */
let typedSinceOpen = false;

async function doIdentify(btn: HTMLButtonElement, host: HTMLElement): Promise<void> {
  if (!state.track) return;
  const trackId = state.track.id;
  // FIX-21: openState.openSeq-guarded — identify's await can outlive the user navigating to another
  // track (openFilingInto bumps openState.openSeq on every open); without this a slow/late response
  // painted candidates/errors from THIS track's search into a pane now showing a different one.
  const myseq = openState.openSeq;
  const origLabel = btn.innerHTML;
  const L = T();
  btn.disabled = true;
  btn.innerHTML = `<i class="ti ti-loader-2 sift-spin sift-searching-icon"></i> ${L.searching}`;
  host.hidden = false;
  host.innerHTML = `<div class="sift-cands-msg">${L.searching}</div>`;

  let candidates: Candidate[] = [];
  try {
    // Cherche ce que l'écran affiche, gravé ou non (issue #67) — si c'est confirmé ou tapé
    // (`identifyHint`) : avant, seuls les tags SUR DISQUE comptaient, filtrés par le portail
    // « junk » et avec la version du nom de fichier.
    candidates = await identify(trackId, identifyHint(state.canonical, typedSinceOpen));
    if (myseq !== openState.openSeq) return; // a newer open started while we awaited — drop this result
    if (candidates.length === 0) {
      // Rien de trouvé : la liste d'une recherche précédente reste celle que la ligne rouvre, et la
      // ligne reste affichée sous le message.
      renderCandidates(host, candidates);
      host.insertAdjacentHTML("beforeend", chosenRowMarkup());
      return;
    }
    // Gardés pour la session (#68) : la ligne choisie rouvrira CETTE liste, sans requête. La version
    // affichée maintenant sert de repli quand le titre Discogs n'en porte pas. La release appliquée
    // vient de la base (`state.releaseId`) : sans elle, une piste identifiée hier sélectionnait le
    // premier candidat, et un clic sur sa propre release la réécrivait.
    rememberCandidates(trackId, candidates, state.canonical?.version ?? null);
    markApplied(trackId, state.releaseId);
    // PAS d'auto-apply (retour Antoine : un match auto appliqué à tort abîmerait le fichier). La
    // recherche AFFICHE les candidats, elle ne remplit rien — l'utilisateur clique un match pour
    // graver. Le focus va au candidat sélectionné pour que ↑/↓ navigue la liste tout de suite ; le
    // clic et le clavier sont câblés une fois sur l'hôte (`wireCandidateHost`).
    openCandidateList(host);
  } catch (err) {
    if (myseq !== openState.openSeq) return;
    // [C2/m5] expliquer POURQUOI + donner une action directe vers Réglages. La cascade de branches
    // vit dans `identifyErrorHtml` depuis le 2026-08-17 : elle était dupliquée à l'identique dans
    // `library-detail.ts`, donc chacun de ses deux défauts (A9, A10 — issue #15) existait en deux
    // exemplaires. Le `console.error` reste garanti par `humanizeError`.
    const { html, gotoReglages } = identifyErrorHtml(err);
    host.innerHTML =
      html +
      (gotoReglages
        ? `<button class="sift-cand-jump sift-goto-reglages" data-fil="goto-reglages"><i class="ti ti-arrow-right"></i> ${L.openSettings}</button>`
        : "");
    host.querySelector<HTMLElement>('[data-fil="goto-reglages"]')?.addEventListener("click", () => {
      // Navigate to the Réglages view via the existing nav click handler in app.js
      requireEl('[data-view="reglages"]', "filing goto-reglages").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // La ligne choisie reste sous le message d'échec (#68) : la liste connue s'y rouvre encore.
    host.insertAdjacentHTML("beforeend", chosenRowMarkup());
  } finally {
    btn.disabled = false;
    btn.innerHTML = origLabel;
  }
}

export function renderEditor(host: HTMLElement, mid: HTMLElement): void {
  const c = state.canonical;
  typedSinceOpen = false;
  if (!c) {
    host.innerHTML = "";
    return;
  }
  const L = T();
  host.innerHTML =
    // Header statique (spec revue.md § Zone C, direction B validée 2026-08-21) : Métadonnées est
    // TOUJOURS visible, sans accordéon NI bascule read-only/édition. Les valeurs s'éditent EN PLACE —
    // chaque ligne d'attribut porte son input, stylé comme du texte au repos, révélé au survol et au
    // focus. Un seul rendu quel que soit l'état : c'est tout le point de la direction B. Le bouton
    // "Identifier" ne bascule plus un mode, il lance la recherche Discogs qui remplit ces mêmes
    // champs. Ce header ne porte PLUS de badge CDJ : il a été retiré avec le passage au header
    // statique (2026-08-25), et `report.tags_cdj_ok` n'a aujourd'hui aucun consommateur dans
    // l'UI réelle — le seul rendu qui reste est celui de la maquette `app.js`, qui ne fait pas
    // autorité. Le critère backend, lui, est bien recâblé (#46, 2026-09-01).
    `<div class="sift-meta-header">` +
    `<span class="sift-meta-title">${L.metadata}</span>` +
    `</div>` +
    `<div class="sift-meta-body">` +
    // L'IDENTIFICATION DISCOGS EN TÊTE de fiche — « je voudrais mettre l'identification Discogs
    // au-dessus » (Antoine, 2026-09-07, le soir même du passage du Diagnostic en zone D). Ordre :
    // release choisie / candidats, puis le bouton qui les lance, puis les attributs que le choix
    // remplit. Renverse la décision 1b du 2026-09-06 (bouton et résultats SOUS les attributs) :
    // l'ordre de lecture redevient l'ordre de CAUSE — on choisit la release, les champs en
    // découlent. Les deux blocs (résultats + bouton) déménagent ENSEMBLE, la proximité
    // cause-effet du 06 (candidats collés au bouton) tient toujours.
    // Résultats Discogs — la release choisie au repos (chosenRowHtml, reconstruite au réopen
    // depuis l'état seedé par filing.ts), la liste ouverte le temps d'une recherche (doIdentify),
    // vide et masqué sinon. paintIdentity remplit les inputs data-fil ci-dessous en place,
    // sans re-render.
    `<div class="sift-cands sift-cands-host" hidden></div>` +
    // Bouton Identifier — aligné au bord gauche, juste sous ses résultats et AU-DESSUS des
    // attributs depuis le 2026-09-07 (voir le bloc du dessus). Loupe retirée le 2026-08-26 (CTA à
    // label descriptif = texte seul) ; le badge `I` RESTE — il porte le raccourci clavier, une
    // information que le libellé ne donne pas.
    `<div class="sift-meta-actions">` +
    `<button data-fil="identifier" class="sift-meta-ident-btn" title="${L.identifyTitle}">${c.artist && c.title ? L.reidentify : L.identify} <span class="kbd sift-kbd-hint-id">I</span></button>` +
    `</div>` +
    // Liste d'attributs éditable en place : la valeur EST un input (data-fil écouté par `upd` à la
    // saisie et par paintIdentity au remplissage), stylé comme du texte tant qu'on ne le touche
    // pas. Labels persistants — annotation "on ne sait pas à quoi correspondent les champs".
    // Placeholder "—" quand vide, jamais une ligne vide.
    `<div class="sift-attr-list">` +
    `<div class="sift-attr"><span class="sift-attr-k">${L.artist}</span><input data-fil="artist" placeholder="—" value="${esc(c.artist)}" class="sift-attr-input" aria-label="${L.artist}"></div>` +
    `<div class="sift-attr"><span class="sift-attr-k">${L.title}</span><input data-fil="title" placeholder="—" value="${esc(c.title)}" class="sift-attr-input" aria-label="${L.title}"></div>` +
    `<div class="sift-attr"><span class="sift-attr-k">${L.version}</span><input data-fil="version" placeholder="—" value="${esc(c.version ?? "")}" class="sift-attr-input" aria-label="${L.version}"></div>` +
    // Label — fait de release Discogs, ÉDITABLE EN PLACE (retour vérif visuelle 2026-08-25 :
    // l'utilisateur veut corriger le label). La valeur EST un input `data-fil="label"`, câblé comme
    // Artiste/Titre/Version : `upd` le lit vers state.canonical.label (label voyage désormais DANS
    // Canonical), et il se grave au fichier (blur/Entrée) via doApplyTags → write_tags_full (+
    // persiste metadata.label). Rempli en place par paintIdentity. Placeholder "—" quand vide.
    `<div class="sift-attr"><span class="sift-attr-k">${L.label}</span><input data-fil="label" placeholder="—" value="${esc(c.label ?? "")}" class="sift-attr-input" aria-label="${L.label}"></div>` +
    `<div class="sift-attr"><span class="sift-attr-k">${L.genres}</span><span class="sift-genres"></span></div>` +
    `</div>` +
    // Historique de l'emplacement des résultats et du bouton (tous deux en tête de fiche
    // aujourd'hui, voir plus haut) : bouton au bord droit de l'en-tête jusqu'au 2026-09-06 (à
    // ~1300px du titre en panneau large) → décision 1b, bouton SOUS les attributs, résultats
    // descendus avec lui le même jour (des résultats surgissant à l'opposé du geste se lisaient
    // comme une anomalie) → 2026-09-07, les deux remontent ensemble au-dessus des attributs.
    // Plus de bouton « Appliquer » (retour Antoine 2026-08-25) : les tags ID3 se gravent
    // AUTOMATIQUEMENT quand on finit d'éditer un champ (blur/Entrée) ou qu'on choisit un match
    // Discogs — voir doApplyTags, déclenché depuis le wiring des inputs (le choix d'un match passe par `apply_release`, #68).
    // Rebuy link slot — filled by refreshRebuyLink() only for a fake track that also has a Discogs
    // match (empty, no gap, otherwise). Placed after genres so the identity block reads whole first.
    `<div class="sift-rebuy"></div>` +
    // Plus de ligne « Tags ID3 » ici (spec docs/ui-specs/revue.md § Zone C, point 4, annotation
    // d'Antoine « supprimé ») : `report.id3_version` était un drapeau de PRÉSENCE de tag conteneur
    // — le backend ne le renseignait que pour .mp3, et il y valait la chaîne « ID3 »
    // (analysis/tags.rs) — si bien que la ligne rendue disait « Tags ID3 : ID3 ». Tautologique.
    // Depuis le 2026-09-01 (issue #46) le champ porte le TYPE réel du porteur (« Id3v2 »,
    // « RiffInfo »…), donc la ligne ne serait plus tautologique — la décision de la retirer, elle,
    // n'a pas été rouverte. Elle avait déjà été
    // renommée une fois (« Version ID3 », annotation 2026-07-06) parce que le mot « version »
    // partagé avec le champ Version de Discogs juste au-dessus laissait croire qu'appliquer une
    // identité la remplissait, ce qu'elle n'a jamais fait : le renommage n'a pas suffi, la ligne
    // part. Ne pas la restaurer sans rouvrir la décision. Ce que la piste vaut pour un CDJ ne se
    // dit nulle part dans cette vue : le badge de l'en-tête Métadonnées est parti le 2026-08-25 et
    // rien ne l'a remplacé. Le bandeau `.sift-tag-warn` ci-dessous n'en tient pas lieu — il compare
    // l'affichage aux tags du fichier (`refreshDiscrepancy`), il ne lit pas `tags_cdj_ok`.
    // Elle était le SEUL usage du rapport d'analyse dans cet éditeur : le paramètre `report` de
    // renderEditor et l'import de `row` (report-view) sont partis avec elle.
    // Discrepancy banner — sits JUST BELOW Apply. Hidden by default via inline display:none; the LONE
    // visibility mechanism is refreshDiscrepancy toggling style.display (no `hidden`+display conflict).
    // Look lives in .sift-tag-warn (styles.css). Shown only when the display diverges from the file.
    // ⚠️ Ce message a nommé « Appliquer les tags » jusqu'au 2026-09-17 — un bouton SUPPRIMÉ le
    // 2026-08-25 (retour Antoine : les tags se gravent quand on finit d'éditer un champ ou qu'on
    // choisit un match, voir `doApplyTags`). Il donnait donc une instruction impossible à suivre.
    // Règle appliquée : `docs/design-system/content.md` — « un état doit dire ce que l'utilisateur
    // peut faire MAINTENANT ». Les deux gestes nommés existent : choisir un match déclenche
    // `applyChosen`, et Convertir est le libellé de l'action principale (content.md § Actions).
    `<div class="sift-tag-warn" role="status" aria-live="polite" style="display:none"><i class="ti ti-alert-triangle sift-icon-inline-md sift-icon-flex-none"></i><span>${L.tagWarn}</span></div>` +
    `</div>`; // ferme .sift-meta-body

  // Métadonnées ne se replie plus (spec revue.md § Zone C) : rien à fermer quand Diagnostic s'ouvre,
  // donc l'accordéon exclusif est neutralisé côté Métadonnées (closeMetaZone reste null). Diagnostic
  // garde son propre repli, indépendant.
  closeMetaZone = null;

  const upd = () => {
    const a = host.querySelector<HTMLInputElement>('[data-fil="artist"]');
    const t = host.querySelector<HTMLInputElement>('[data-fil="title"]');
    const v = host.querySelector<HTMLInputElement>('[data-fil="version"]');
    const l = host.querySelector<HTMLInputElement>('[data-fil="label"]');
    if (!state.canonical) return;
    typedSinceOpen = true;
    state.canonical.artist = a?.value ?? "";
    state.canonical.title = t?.value ?? "";
    state.canonical.version = v?.value.trim() ? v.value.trim() : null;
    // Label rides on Canonical now (empty → null, same discipline as version). Graved by doApplyTags.
    state.canonical.label = l?.value.trim() ? l.value.trim() : null;
    refreshPreview();
    refreshDiscrepancy(); // editing a field may make the display diverge from the file (or re-converge)
  };
  // Le titre en haut (hero, `.sift-report-name`) ne se met à jour qu'à la FIN de l'édition — au blur
  // ou sur Entrée — pas à chaque frappe (Antoine 2026-08-21 : « pas en même temps »). Le Nom final du
  // rail, lui, suit en direct (refreshPreview dans upd).
  const commitTitle = (): void => updateHeaderName(mid);
  // Entrée dans un champ = appliquer les tags au fichier (Antoine 2026-08-21). upd() d'abord pour que
  // state.canonical porte la dernière saisie, puis on grave dès qu'il y a une vraie divergence avec le
  // fichier (`tagFieldDiffs().any`) — plus fiable que l'état `.disabled` du bouton, qui reste
  // « Annuler » après l'apply auto d'une identification et ne se ré-arme pas. Même doApplyTags que le
  // bouton. preventDefault : l'Entrée globale « Convertir » est de toute façon gardée hors des INPUT
  // (filing.ts:570, DESIGN.md § 9).
  const applyOnEnter = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    upd();
    commitTitle();
    if (tagFieldDiffs().any) void doApplyTags();
    (e.currentTarget as HTMLInputElement).blur();
  };
  host
    .querySelectorAll<HTMLInputElement>('[data-fil="artist"],[data-fil="title"],[data-fil="version"],[data-fil="label"]')
    .forEach((el) => {
      let focusVal = el.value;
      // Drapeau « ce blur-ci vient d'Échap, il ne grave RIEN ». Posé juste avant `el.blur()` du
      // chemin Échap, lu par le handler de blur ci-dessous. Corrige le bug du 2026-08-25 : Échap
      // annulait à l'écran (revert à `focusVal`) puis appelait `blur()`, dont le handler grave dès
      // que l'affichage diverge du fichier — donc ANNULER ÉCRIVAIT sur le disque. Le cas qui le rend
      // visible : une piste identifiée mais pas encore gravée, où `focusVal` diverge DÉJÀ du fichier,
      // si bien que le revert ne fait pas retomber `tagFieldDiffs().any`.
      // Drapeau plutôt que retrait/repose du listener : `blur()` est dispatché SYNCHRONEMENT, donc
      // la durée de vie du drapeau est exactement celle de l'appel et il ne peut pas fuir sur un blur
      // ultérieur ; un retrait/repose, lui, laisserait le champ définitivement sans écriture si un
      // throw traversait entre les deux. Ne touche pas la coalescence de doApplyTags (double
      // déclenchement de l'Entrée), qui répond à une autre question.
      let escapeCancel = false;
      el.addEventListener("focusin", () => {
        focusVal = el.value;
      });
      el.addEventListener("input", upd);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          applyOnEnter(e);
        } else if (e.key === "Escape") {
          // Échap = annuler l'édition : revert à la valeur du focus-in, resync l'état (upd), et
          // stopPropagation pour ne pas remonter fermer un popover/la fenêtre (couche 1, shortcuts.ts).
          e.preventDefault();
          e.stopPropagation();
          el.value = focusVal;
          upd();
          escapeCancel = true;
          try {
            el.blur();
          } finally {
            // `finally` et pas une remise à false dans le handler : si `el` n'a plus le focus,
            // `blur()` est un no-op, AUCUN événement blur n'est dispatché — et le drapeau resté
            // levé avalerait la prochaine vraie fin d'édition.
            escapeCancel = false;
          }
        }
      });
      el.addEventListener("blur", () => {
        // Graver EN FINISSANT l'édition (retour Antoine : plus de bouton Appliquer) — si un champ a
        // divergé du fichier. doApplyTags absorbe le double déclenchement avec l'Entrée (coalesceLatest).
        // `commitTitle` reste appelé même sur Échap : le titre du hero doit afficher la valeur
        // RESTAURÉE, pas celle que l'annulation vient de jeter.
        commitTitle();
        if (escapeCancel) return; // Échap : annuler ne grave jamais (voir escapeCancel plus haut)
        if (tagFieldDiffs().any) void doApplyTags();
      });
    });

  const idBtn = host.querySelector<HTMLButtonElement>('[data-fil="identifier"]');
  const candsHost = host.querySelector<HTMLElement>(".sift-cands");
  if (idBtn && candsHost) {
    idBtn.addEventListener("click", () => void doIdentify(idBtn, candsHost));
    wireCandidateHost(candsHost, host, mid, idBtn);
  }


  refreshRebuyLink(); // rebuy-on-Beatport link when the open track is fake AND already identified
  // La release choisie SURVIT au réopen (retour d'Antoine, 2026-09-07 : « elle devrait rester ») :
  // la ligne se reconstruit depuis l'état seedé par filing.ts AVANT ce render — identité depuis
  // canonical, label/année depuis la table metadata, pochette locale, pays/format depuis le cache
  // session quand il les a encore. Pas de colonne backend pour pays/format, et pas de migration :
  // « je me fiche de l'édition » (même jour) — la ligne se contente de ce qui est là.
  // Depuis #68 la ligne rouvre la liste de la session quand il y en a une (`paintChosenRow`).
  if (candsHost) paintChosenRow(candsHost);
}

/** Beatport search URL for the open track's identified artist + title. A search page (not an API):
 *  robust to spelling/pressing variants — the user picks the authentic release themselves. Null when
 *  there's nothing worth searching. */
function beatportSearchUrl(): string | null {
  const c = state.canonical;
  if (!c || !c.title.trim()) return null;
  const q = [c.artist, c.title].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return q ? `https://www.beatport.com/search?q=${encodeURIComponent(q)}` : null;
}

/** Show a "chercher sur Beatport" link ONLY when the open track is a fake/transcode AND a Discogs
 *  identity exists (state.identified) — searching a raw filename is useless. Fills a create-once
 *  `.sift-rebuy` container; empty (no link, no gap) otherwise. Called on open, on renderEditor, and
 *  after a release is applied or restored (paintIdentity). */
function refreshRebuyLink(): void {
  const el = document.querySelector<HTMLElement>(".sift-rebuy");
  if (!el) return; // editor not mounted
  const url = state.track?.verdict === "fake" && state.identified ? beatportSearchUrl() : null;
  if (!url) {
    el.innerHTML = "";
    return;
  }
  const L = T();
  el.innerHTML =
    `<button class="sift-rebuy-btn" data-fil="rebuy" title="${L.rebuyTitle}">` +
    `<i class="ti ti-shopping-cart sift-icon-inline-md"></i> ${L.rebuy}</button>`;
  el.querySelector('[data-fil="rebuy"]')?.addEventListener("click", () => {
    void openUrl(url).catch((e) => console.error("openUrl (rebuy) failed", e));
  });
}

// Apply button — une seule action « Appliquer » (grave les tags ID3 en place). Plus de bascule inline
// vers « Annuler » (Antoine 2026-08-21) : l'apply est journalisé (tag_edit, actions.rs), donc l'undo
// vit dans Ctrl+Z (undoLast) et l'écran Journal — le bouton inline faisait doublon.
/** Write the current edited tags onto the file in place (apply_tags). Déclenché AUTOMATIQUEMENT quand
 *  on finit d'éditer un champ (blur/Entrée) ou qu'on choisit un match Discogs — plus de bouton
 *  « Appliquer » (retour Antoine 2026-08-25 : les métadonnées se gravent quand on a fini de les
 *  éditer). Sur succès le fichier == l'affichage → re-snapshot pour effacer le marqueur.
 *
 *  Une écriture à la fois, par `coalesceLatest` : une demande arrivée pendant une écriture est
 *  REJOUÉE après, avec la dernière saisie, et le double déclenchement de l'Entrée (qui appelle
 *  blur()) se résorbe parce que la valeur est identique. Jusqu'au 2026-09-23, une garde
 *  `if (applyingTags) return` jetait la seconde demande — un titre validé pendant la gravure de
 *  l'artiste n'était jamais écrit. La valeur est COPIÉE à la demande : `upd` mute `state.canonical`
 *  en place, et c'est la piste de la demande qui est gravée, même si une autre s'est ouverte depuis.
 *  openState.openSeq-guarded : un open ultérieur ne repeint jamais l'état/UI de cette piste. */
interface TagJob {
  trackId: number;
  edited: Canonical;
  seq: number;
}
const applyTagsLatest = coalesceLatest<TagJob>(
  runApplyTags,
  (a, b) => a.trackId === b.trackId && JSON.stringify(a.edited) === JSON.stringify(b.edited),
);
async function doApplyTags(): Promise<void> {
  if (!state.track || !state.canonical) return;
  await applyTagsLatest({ trackId: state.track.id, edited: { ...state.canonical }, seq: openState.openSeq });
}
async function runApplyTags({ trackId, edited, seq: myseq }: TagJob): Promise<void> {
  try {
    const batchId = await applyTags(trackId, edited);
    const snap = await trackFileTags(trackId); // file changed → refresh the in-memory snapshot
    if (myseq !== openState.openSeq) return; // another track opened meanwhile — leave its state/UI alone
    state.fileTags = snap;
    refreshDiscrepancy(); // file == display now → marker clears
    // Filet « Rétablir » en TOAST (décision F.2) : graver est un geste auto, on met l'undo ciblé à
    // portée immédiate. revertBatch(CE tag_edit) ; le Journal / Ctrl+Z restent le filet durable.
    toast(T().tagsWritten, true, () =>
      void revertBatch(batchId).catch((e) => console.error("revertBatch (tag_edit) failed", e)),
    );
    // L'écran a pu bouger PENDANT l'écriture sans émettre de demande : le blur ne grave que si
    // l'affichage diffère de `fileTags`, et cet instantané datait d'AVANT l'écriture. Taper « B »,
    // Tab, puis remettre « A » (la valeur d'origine) avant la fin : aucune demande, et le fichier
    // gardait « B » (relecture #65). Maintenant que `fileTags` est frais, si l'écran diffère encore
    // de ce qui vient d'être gravé ET du fichier, on regrave.
    if (state.canonical && JSON.stringify(state.canonical) !== JSON.stringify(edited) && tagFieldDiffs().any) {
      void doApplyTags();
    }
  } catch (e) {
    console.error("apply_tags failed", e);
    toast(T().tagsFailed, false);
  }
}

