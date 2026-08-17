import { identify, applyIdentity, applyTags, revertBatch, trackFileTags, openUrl } from "./ipc";
import type { Candidate, AppliedIdentity } from "./ipc";
import type { AnalysisReport } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { zoneToggleHtml, row } from "./report-view";
import { identifyErrorHtml, renderCandidates } from "./identify-shared";
import { resolveGenreFamily } from "./genre-families";
import { requireEl, esc } from "./dom";
import { state, openState } from "./filing-state";
import { toast } from "./filing-toast";
import { refreshPreview, updateHeaderName, titleCase } from "./filing-preview";
import { humanizeError } from "./errors";

// Identification card display mode: false = read-only grid (maquette default), true = the
// existing editable artist/title/version inputs. Reset on every track open (Step 3) so a new
// track never inherits the previous track's edit-mode.
let identEditing = false;

// openFilingInto (filing.ts, Task 6) also resets this on every track open — a coupling the Task 4
// brief's "read/written exclusively inside renderEditor" note missed (found during this
// extraction, not anticipated). A plain `let` can't be reassigned from an importing module (ESM
// import bindings are read-only to the importer), so expose a setter rather than the raw `let` —
// same reasoning as filing-state.ts's openState object for openSeq/acting, applied here at
// function scope instead of promoting this into shared module state it doesn't need to be.
export function resetIdentEditing(): void {
  identEditing = false;
}

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
export const releaseCache = new Map<
  number,
  { label: string | null; year: number | null; country: string | null; format: string | null }
>();

/** Render the genre chips into `.sift-genres` from `state.genres` (single source — set on open from
 *  track_release, or from `applied.styles` on identify). Empty list → empty box (no chips). */
export function renderGenres(): void {
  const el = document.querySelector<HTMLElement>(".sift-genres");
  if (!el) return; // editor not mounted
  el.innerHTML = state.genres
    .map((s) => {
      const fam = resolveGenreFamily(s);
      return `<span class="sift-genre-chip sift-genre-chip-${fam}" title="Sous-genres Discogs">${esc(s)}</span>`;
    })
    .join("");
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
  const labelW = norm(state.label);
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

  // Grey out "Appliquer" when there's nothing to write — a write with no discrepancy is a no-op
  // click that gives the user nothing to do. Never touches the button in its "Annuler" (applied)
  // state, which is a distinct action with its own always-clickable semantics.
  const applyBtn = editor.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
  if (applyBtn && applyBtn.dataset.applied !== "1") {
    applyBtn.disabled = !d.any;
    applyBtn.title = d.any
      ? "Applique les tags ID3 au fichier"
      : "Rien à appliquer — les tags du fichier correspondent déjà à l'affichage";
    // setApplyIdle() sets this color inline — an inline style always wins over any CSS class rule
    // regardless of specificity, so a CSS-only .sift-applytags-btn:disabled{color:...} rule can
    // never actually apply here (confirmed live via CDP: computed color stayed --color-text-
    // secondary, the idle inline value, even after adding that CSS rule). Toggle the SAME inline
    // property instead of fighting it. Kept opacity:1 on the disabled state (styles.css) so the
    // box itself stays fully visible — only the label mutes.
    applyBtn.style.color = d.any ? "var(--color-text-secondary)" : "var(--color-text-tertiary)";
  }
}

/** Apply an identity result to the editing fields + filename preview.
 * [C3] `host` + `allCandidates` are kept so we can show a "changer" confirmation row
 * instead of dead-ending (no new API call needed — re-renders from in-memory list). */
function onIdentityApplied(
  applied: AppliedIdentity,
  chosen: Candidate,
  editor: HTMLElement,
  mid: HTMLElement,
  host: HTMLElement,
  allCandidates: Candidate[],
  idBtn: HTMLButtonElement,
): void {
  if (!state.canonical) return;
  state.canonical.artist = applied.canonical.artist;
  // Split a trailing "(Version)" out of the Discogs title so it's never duplicated: the title
  // field gets the clean base, the version field gets the mix. Prefer the version Discogs put
  // in the title; otherwise keep the one parsed from the local name (Discogs search doesn't
  // always expose a per-track version). Fixes e.g. "Love Foolosophy (Knee Deep Remix) (Knee
  // Deep Remix)".
  const m = applied.canonical.title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const baseTitle = m ? m[1].trim() : applied.canonical.title.trim();
  const rawVersion = (m ? m[2].trim() : null) ?? state.canonical.version;
  const version = rawVersion ? titleCase(rawVersion) : null;
  state.canonical.title = baseTitle;
  state.canonical.version = version;

  // Update the editable inputs directly.
  const aInp = editor.querySelector<HTMLInputElement>('[data-fil="artist"]');
  const tInp = editor.querySelector<HTMLInputElement>('[data-fil="title"]');
  const vInp = editor.querySelector<HTMLInputElement>('[data-fil="version"]');
  if (aInp) aInp.value = applied.canonical.artist;
  if (tInp) tInp.value = baseTitle;
  if (vInp) vInp.value = version ?? "";

  // Refresh the filename preview using the same logic as the input handler.
  refreshPreview();
  updateHeaderName(mid);

  // Read-only release facts from the chosen Discogs release. Cache them on the track so a
  // close+reopen within the session re-shows them (reconcile doesn't carry label/year). Choosing a
  // different candidate re-enters here with the new release → the line updates in place.
  state.label = applied.label;
  state.year = applied.year;
  // Country/format only ever exist on the search-result candidate (chosen), never on AppliedIdentity
  // (Rust apply_identity_cmd doesn't return them, and metadata has no column for either) — take them
  // from the same candidate object the click already had, so they don't vanish once the candidate
  // list is replaced by the "Identifié :" confirmation line (2026-07-06 annotation).
  state.releaseCountry = chosen.country;
  state.releaseFormat = chosen.format;
  state.coverPath = applied.cover_path;
  if (state.track) {
    releaseCache.set(state.track.id, {
      label: applied.label,
      year: applied.year,
      country: chosen.country,
      format: chosen.format,
    });
  }

  // Show the cover if we have a local path. Every match, not just the first — the Hero and the
  // player's mini header both carry this class now. Probe non-throw — the report pane may be
  // gone after the identify await / a navigation.
  if (applied.cover_path) {
    const src = convertFileSrc(applied.cover_path);
    mid.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
      // Discogs sometimes returns a placeholder ("no image") instead of real art — the file
      // downloads fine but fails to decode/display as a photo. Re-hide on error so the vinyl
      // ::before fallback shows instead of a broken-image glyph on top of it.
      covEl.onerror = () => { covEl.hidden = true; };
      covEl.src = src;
      covEl.hidden = false;
    });
  }

  // [m11] Genres: store the would-write list (single source) and render the chips. The list also
  // feeds the file-vs-display discrepancy check (joined form), so it must live in state, not only DOM.
  state.genres = applied.styles;
  renderGenres();

  // A Discogs match now exists → if the file is a fake/transcode, offer the rebuy search link.
  state.identified = true;
  refreshRebuyLink();

  // [C3] Collapse candidate zone to a confirmation row + "changer" link (no dead-end).
  // Re-labelling the Identifier button to "Ré-identifier" is also handled here.
  host.hidden = false;
  host.innerHTML = identifiedLineHtml(applied.canonical.artist, applied.canonical.title, applied.cover_path);
  const identifiedLineEl = host.querySelector<HTMLElement>(".sift-identified-line");
  if (identifiedLineEl) {
    identifiedLineEl.classList.add("sift-identified-flash");
    identifiedLineEl.addEventListener(
      "animationend",
      () => identifiedLineEl.classList.remove("sift-identified-flash"),
      { once: true },
    );
  }
  // Read-only unidentified card (sift-ident-idle): the idle note ("Aucune correspondance…") is now
  // false — drop it, keeping the search button (relabelled Ré-identifier below) next to the line.
  editor.querySelector(".sift-ident-idle-note")?.remove();

  const changerBtn = host.querySelector<HTMLElement>('[data-fil="cand-changer"]');
  changerBtn?.addEventListener("click", () => {
    // Re-show the full candidate list from memory (no new API call).
    host.innerHTML = "";
    renderCandidates(host, allCandidates);
    wireCandidateClicks(host, allCandidates, editor, mid, idBtn);
  });

  // [C1] Relabel Identifier → Ré-identifier once an identity has been applied.
  idBtn.innerHTML = '<i class="ti ti-refresh sift-icon-inline-sm"></i> Ré-identifier';

  // The button starts `hidden` in the markup when the track opens unidentified (nothing to apply
  // yet) — a fresh identity just landed, so reveal it now rather than waiting for a full re-render.
  const applyBtn = editor.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
  if (applyBtn) applyBtn.hidden = false;

  // The displayed identity just changed while the FILE keeps its old tags → surface the gap, and
  // reset the Apply button (a prior "Appliqué ✓" no longer reflects this new identity).
  resetApplyButton(editor);
  refreshDiscrepancy();

  // Identifying a Discogs title now writes the ID3 tags automatically instead of requiring a
  // second manual click every time (user request) — a fresh identity is useless to a CDJ until the
  // file's own tags actually match it. Reuses the exact same doApplyTags() path a manual click on
  // the button would run (loading spinner → "Appliqué ✓" → toast on failure), just triggered here
  // instead of waiting for the user to press it.
  if (applyBtn) void doApplyTags(applyBtn);
}

/** Markup for the "Identified: artist — title" confirmation line (cover thumb + "change" button).
 *  Single source of truth, reused by a fresh fetch (onIdentityApplied) and by the reopen of an
 *  already-identified track (restoreIdentifiedLine) so both render identically. */
function identifiedLineHtml(artist: string, title: string, coverPath: string | null): string {
  const coverThumb = coverPath
    ? `<img src="${esc(convertFileSrc(coverPath))}" alt="" class="sift-identified-cover">`
    : `<span class="sift-identified-noart"><i class="ti ti-vinyl"></i></span>`;
  return (
    `<div class="sift-identified-line">` +
    coverThumb +
    `<span class="sift-identified-text">` +
    `<span class="sift-identified-label">Identifié :</span> ${esc(artist)} — ${esc(title)}` +
    `</span>` +
    `<button class="sift-cand-jump sift-cand-change-btn" data-fil="cand-changer">modifier</button>` +
    `</div>`
  );
}

/** On (re)open of an already-identified track (track_release.identified), show the "Identified" line
 *  in place of the bare Fetch button — same markup as a fresh fetch, rebuilt from `metadata` (cover
 *  included), ZERO network. The original candidate list is gone after a close / cold start, so here
 *  "change" re-runs a Discogs fetch (Antoine's call) rather than re-showing a list we no longer have.
 *  `editor` is the center editor host; `.sift-cands` + the Identifier button live inside it. */
export function restoreIdentifiedLine(
  editor: HTMLElement,
  mid: HTMLElement,
  artist: string,
  title: string,
  coverPath: string | null,
): void {
  const host = editor.querySelector<HTMLElement>(".sift-cands");
  const idBtn = editor.querySelector<HTMLButtonElement>('[data-fil="identifier"]');
  if (!host || !idBtn) return;
  host.hidden = false;
  host.innerHTML = identifiedLineHtml(artist, title, coverPath);
  // Cover was only ever set on a FRESH identify this session (onIdentityApplied) — never on
  // reopen of an already-identified track, so the hero/player cover stayed hidden until you
  // re-ran Identify (docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md décision #5, bug de branchement confirmé).
  if (coverPath) {
    const src = convertFileSrc(coverPath);
    mid.querySelectorAll<HTMLImageElement>(".sift-report-cover").forEach((covEl) => {
      // See onIdentityApplied: Discogs placeholder art can fail to render — re-hide on error.
      covEl.onerror = () => { covEl.hidden = true; };
      covEl.src = src;
      covEl.hidden = false;
    });
  }
  // [C1] Match the post-fetch state: the primary button reads "Re-identify".
  idBtn.innerHTML = '<i class="ti ti-refresh sift-icon-inline-sm"></i> Ré-identifier';
  // Cold-start "change": the original candidates aren't in memory → re-run a Discogs fetch.
  host.querySelector<HTMLElement>('[data-fil="cand-changer"]')?.addEventListener("click", () => {
    void doIdentify(idBtn, host, editor, mid);
  });
}

/** Wire clicks on rendered candidate buttons.
 * Extracted so it can be called after initial render AND after "changer" re-shows the list. */
function wireCandidateClicks(
  host: HTMLElement,
  candidates: Candidate[],
  editor: HTMLElement,
  mid: HTMLElement,
  idBtn: HTMLButtonElement,
): void {
  host.querySelectorAll<HTMLElement>("[data-cand]").forEach((el) => {
    const idx = Number(el.dataset.cand);
    el.addEventListener("click", () => {
      const c = candidates[idx];
      if (!c || !state.track) return;
      el.style.opacity = "0.5";
      el.style.pointerEvents = "none";
      // FIX-21: openState.openSeq-guarded, same pattern as openFilingInto/setApplyIdle — without it, a
      // slow applyIdentity resolving after the user already navigated to a different track would
      // write the fetched metadata onto the WRONG track's pane (state.canonical, cover, DOM).
      const myseq = openState.openSeq;
      void applyIdentity(state.track.id, c)
        .then((applied) => {
          if (myseq !== openState.openSeq) return; // a newer open started while we awaited — drop this result
          onIdentityApplied(applied, c, editor, mid, host, candidates, idBtn);
        })
        .catch((e) => {
          if (myseq !== openState.openSeq) return;
          el.style.opacity = "";
          el.style.pointerEvents = "";
          // [m10] errors get a warning icon to distinguish from "no results"
          host.innerHTML = `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>${esc(humanizeError(e, "Impossible d'appliquer cette release — réessaie", "apply_identity"))}</div>`;
        });
    });
  });
}

/** Run the Discogs identify flow for the current track. */
async function doIdentify(
  btn: HTMLButtonElement,
  host: HTMLElement,
  editor: HTMLElement,
  mid: HTMLElement,
): Promise<void> {
  if (!state.track) return;
  const trackId = state.track.id;
  // FIX-21: openState.openSeq-guarded — identify's await can outlive the user navigating to another
  // track (openFilingInto bumps openState.openSeq on every open); without this a slow/late response
  // painted candidates/errors from THIS track's search into a pane now showing a different one.
  const myseq = openState.openSeq;
  const origLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2 sift-spin sift-searching-icon"></i> Recherche…';
  host.hidden = false;
  host.innerHTML = '<div class="sift-cands-msg">Recherche…</div>';

  let candidates: Candidate[] = [];
  try {
    candidates = await identify(trackId);
    if (myseq !== openState.openSeq) return; // a newer open started while we awaited — drop this result
    renderCandidates(host, candidates);
    wireCandidateClicks(host, candidates, editor, mid, btn);
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
        ? `<button class="sift-cand-jump sift-goto-reglages" data-fil="goto-reglages"><i class="ti ti-arrow-right"></i> Ouvrir Réglages</button>`
        : "");
    host.querySelector<HTMLElement>('[data-fil="goto-reglages"]')?.addEventListener("click", () => {
      // Navigate to the Réglages view via the existing nav click handler in app.js
      requireEl('[data-view="reglages"]', "filing goto-reglages").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
  } finally {
    btn.disabled = false;
    btn.innerHTML = origLabel;
  }
}

export function renderEditor(host: HTMLElement, mid: HTMLElement, rail: string, report: AnalysisReport | null): void {
  void rail;
  const c = state.canonical;
  if (!c) {
    host.innerHTML = "";
    return;
  }
  const inputCss = "sift-editor-input";

  // [C1] "Fetch metadata from Discogs" is the primary entry point (gold filled), above the inputs.
  // [C2] title= explains what it does; the kbd hint shows the I shortcut.
  // Vertical order: pick the Discogs release FIRST (badge → Fetch → candidates), then edit the
  // fields it populates (artist/title/version → Genres directly under Version). The Final name
  // preview moved to the rail (next to File). `.sift-cands` sits above the inputs so choosing a
  // release precedes editing.
  const displayName =
    c.artist && c.title ? `${c.artist} — ${c.title}${c.version ? ` (${c.version})` : ""}` : "Non identifié";
  host.innerHTML =
    zoneToggleHtml({ label: "Métadonnées", toggleId: "sift-meta-toggle", badgeId: "sift-cdj-badge" }) +
    // Grid 0fr→1fr open/close animation (same trick as Diagnostic's .sift-spectro-body) — the
    // -inner wrapper carries overflow:hidden so the grid track can animate from/to zero height.
    // Padding lives on a THIRD nested div (-pad), never on -inner itself: overflow:hidden only
    // zeroes a track's automatic minimum size from CONTENT, not from padding on the item the grid
    // actually measures — padding directly on -inner would floor the closed row at its own padding
    // sum instead of true 0 (found live via CDP: gridTemplateRows stuck at 16px, matching 8px+8px
    // vertical padding — annotation: "ça rajoute une longueur bizarre", then "c'est encore pire"
    // after padding-bottom was added). Diagnostic never hit this because its inset lives on a child
    // row (.sift-spectro-declared), not on .sift-spectro-body-inner itself, which has zero padding.
    `<div class="sift-zone-toggle-body" id="sift-meta-body">` +
    `<div class="sift-zone-toggle-body-inner">` +
    `<div class="sift-zone-toggle-body-pad">` +
    // .sift-ident-head/.sift-editor-title ("Identification · Discogs") removed (annotation:
    // "supprime") — redundant with the toggle header above it ("Métadonnées"), which already
    // names this section before it's even expanded.
    // Confidence badge ("métadonnées fiables"/"à confirmer") removed (annotation: "ça ne veut rien
    // dire, c'est à l'user de définir la fiabilité") — the extraction confidence is Sift's own
    // internal signal, not a claim the user should be told to trust or distrust up front.
    (identEditing
      ? `<button data-fil="identifier" class="sift-id-btn sift-id-btn-full${c.artist && c.title ? " sift-id-btn-neutral" : ""}" title="Rechercher les métadonnées sur Discogs (pochette, label, année, genres)"><i class="ti ti-search sift-icon-inline-sm"></i> ${c.artist && c.title ? "Rechercher à nouveau" : "Récupérer les métadonnées Discogs"} <span class="kbd sift-kbd-hint-id">I</span></button>` +
        `<div class="sift-cands sift-cands-host" hidden></div>` +
        // Persistent labels above each field (annotation: "on ne sait pas à quoi correspondent les
        // champs") — a placeholder alone disappears the moment there's real text in the input, so
        // a reopened, already-filled track showed three bare boxes with no indication of which
        // field was which. The group header ("Données de la piste") this originally shipped with
        // was removed one round later (annotation: "redondant avec le titre des données qu'on
        // affiche maintenant") — the field labels alone already say what each one is.
        `<div class="sift-editor-fields">` +
        `<div class="sift-editor-field"><span class="sift-editor-field-label">Artiste</span><input data-fil="artist" placeholder="Artiste" value="${esc(c.artist)}" class="${inputCss}"></div>` +
        `<div class="sift-editor-field"><span class="sift-editor-field-label">Titre</span><input data-fil="title" placeholder="Titre" value="${esc(c.title)}" class="${inputCss}"></div>` +
        `<div class="sift-editor-field"><span class="sift-editor-field-label">Version</span><input data-fil="version" placeholder="Version (ex. Remix, Dub)" value="${esc(c.version ?? "")}" class="${inputCss}"></div>` +
        `</div>`
      : c.artist && c.title
        ? `<div class="sift-ident-display">${esc(displayName)}</div>`
        : // Unidentified + read-only: the maquette's simplified card (Sift.dc.html:357-362) — a
          // direct "Rechercher sur Discogs" entry point, without having to open edit mode first.
          // Same data-fil="identifier" + .sift-cands contract as edit mode, so the existing
          // doIdentify wiring below and the [m9] I shortcut find them unchanged.
          `<div class="sift-ident-idle"><span class="sift-ident-idle-note">Aucune correspondance Discogs pour l'instant.</span>` +
          `<button data-fil="identifier" class="sift-ident-search-btn">Rechercher sur Discogs</button></div>` +
          `<div class="sift-cands sift-cands-host" hidden></div>`) +
    // Apply ID3 tags: write these fields onto the file in place (no move, no encode, no 'filed'
    // change), revertable. Distinct from File (rail) — a neutral secondary button in the editor.
    // Moved into the Genres header row (annotation: "à côté de genres") — short label + explanatory
    // tooltip (réf. shadcn Button) now that it's compact, not a full-width bar at the bottom.
    // `hidden` (not omitted) when there's no identity yet (c.artist/title empty) — an unidentified
    // track can never produce a real discrepancy (tagFieldDiffs() already requires non-empty
    // artist/title before d.any can be true), so showing it there was a dead artifact with nothing
    // to do (annotation: "sur des tracks non identifiées on a encore cet artifact qui ne devrait pas
    // être là"). Kept in the DOM rather than omitted from the markup string: onIdentityApplied()
    // patches this exact element in place (unhides it + triggers the auto-apply) without a full
    // renderEditor() re-render — omitting it entirely would leave onIdentityApplied's querySelector
    // finding nothing on a track that was unidentified when this markup was first built.
    `<div class="sift-genres-header">` +
    `<div class="col-h sift-col-h-tight">Genres</div>` +
    `<button data-fil="applytags" class="sift-applytags-btn" title="Applique les tags ID3 au fichier"${c.artist && c.title ? "" : " hidden"}><i class="ti ti-tag sift-icon-inline-md"></i> Appliquer</button>` +
    `</div>` +
    `<div class="sift-genres sift-genres-box"></div>` +
    // Rebuy link slot — filled by refreshRebuyLink() only for a fake track that also has a Discogs
    // match (empty, no gap, otherwise). Placed after genres so the identity block reads whole first.
    `<div class="sift-rebuy"></div>` +
    // Tags ID3: moved here from the spectral-proof box (report-view.ts) — the maquette groups it
    // with Label/Année/Genre in Identification, not with the spectrum evidence. Compatibilité CDJ
    // moved OUT of this card (FIX-4): it now surfaces as an explicit "CDJ" chip right under the
    // main verdict (report-view.ts::evidenceChipsHtml) instead of a generic yes/no row buried here.
    // Renamed from "Version ID3" (2026-07-06 annotation): id3_version is a container-tag-presence
    // flag (backend only ever sets it for .mp3, tags.rs), unrelated to the Discogs release Version
    // field edited just above — the shared word "version" read as if applying the Discogs identity
    // should populate this row, which it never does. Row is omitted entirely (not "—") when the
    // container has no ID3 tag reading (AIFF/WAV, or analysis failure) — nothing to report there.
    (report?.id3_version
      ? `<div class="sift-spectro-rows">` +
        row("Tags ID3", report.id3_version) +
        `</div>`
      : "") +
    // Discrepancy banner — sits JUST BELOW Apply. Hidden by default via inline display:none; the LONE
    // visibility mechanism is refreshDiscrepancy toggling style.display (no `hidden`+display conflict).
    // Look lives in .sift-tag-warn (styles.css). Shown only when the display diverges from the file.
    `<div class="sift-tag-warn" role="status" aria-live="polite" style="display:none"><i class="ti ti-alert-triangle sift-icon-inline-md sift-icon-flex-none"></i><span>Artiste et Titre pas encore gravés dans le fichier (seulement identifiés ci-dessus) — un CDJ ne peut pas les lire tant que ce n'est pas fait. <strong>Convertir</strong> ou <strong>Appliquer les tags</strong> pour corriger.</span></div>` +
    `</div>` + // ferme .sift-zone-toggle-body-pad
    `</div>` + // ferme .sift-zone-toggle-body-inner
    `</div>`; // ferme #sift-meta-body ouvert au début de host.innerHTML

  const metaToggle = host.querySelector<HTMLButtonElement>("#sift-meta-toggle");
  const metaBody = host.querySelector<HTMLElement>("#sift-meta-body");
  const cdjBadge = host.querySelector<HTMLElement>("#sift-cdj-badge");
  if (cdjBadge && report) {
    const ok = report.tags_cdj_ok;
    cdjBadge.textContent = ok ? "CDJ compatible" : "CDJ incompatible";
    cdjBadge.style.background = ok ? "var(--color-background-success)" : "var(--color-background-warning)";
    cdjBadge.style.color = ok ? "var(--color-text-success)" : "var(--color-text-warning)";
    cdjBadge.title = "Un CDJ a besoin d'Artiste + Titre gravés dans les tags du fichier";
    // Toujours visible, replié ou ouvert (annotation 2026-07-06: disparaissait à l'ouverture —
    // le corps n'affiche en fait pas d'équivalent explicite "CDJ compatible/incompatible" une
    // fois déplié, donc le cacher perdait l'info plutôt que de la déduire de l'ouverture).
    cdjBadge.hidden = false;
  }
  // Forces the just-rebuilt zone (renderEditor was called fresh) back into its open, expanded state
  // — zoneToggleHtml always starts a fresh render collapsed, but both call sites below (opening +
  // entering edit mode in one click, and "Terminé") want to land on the open body, not a closed one.
  const forceMetaOpen = () => {
    const freshBody = host.querySelector<HTMLElement>("#sift-meta-body");
    const freshToggle = host.querySelector<HTMLButtonElement>("#sift-meta-toggle");
    // Force a reflow before adding the open class: freshBody was JUST created by the innerHTML
    // rebuild above, still closed (grid-template-rows:0fr) and never painted. Without this read,
    // the browser coalesces "created closed" + "add -open" into one paint and the grid-template-rows
    // transition never has a prior state to animate from — it just jumps straight to open (annotation:
    // "la taille a changé mais on a pas l'animation d'ouverture"). Reading offsetHeight commits the
    // closed layout first, so the class add right after is a genuine, animatable state change.
    if (freshBody) void freshBody.offsetHeight;
    freshBody?.classList.add("sift-zone-toggle-body-open");
    freshToggle?.classList.add("sift-zone-toggle-open");
    freshToggle?.setAttribute("aria-expanded", "true");
  };

  const closeMeta = () => {
    const freshBody = host.querySelector<HTMLElement>("#sift-meta-body");
    const freshToggle = host.querySelector<HTMLButtonElement>("#sift-meta-toggle");
    if (!freshBody?.classList.contains("sift-zone-toggle-body-open")) return;
    // Closing: exit edit mode too, so the next open always starts from this same single click.
    identEditing = false;
    freshBody.classList.remove("sift-zone-toggle-body-open");
    freshToggle?.classList.remove("sift-zone-toggle-open");
    freshToggle?.setAttribute("aria-expanded", "false");
    // Closing the zone resets the Apply button to idle (2026-07-06 annotation): "Appliqué ✓" is a
    // transient confirmation for the write that just happened, not a state that should survive a
    // collapse/reopen with no track change — reopening always starts from the write action again.
    resetApplyButton(host);
  };
  closeMetaZone = closeMeta; // this instance is now the one "sift:accordion-open" can close

  metaToggle?.addEventListener("click", () => {
    const wasOpen = metaBody?.classList.contains("sift-zone-toggle-body-open") ?? false;
    if (!wasOpen) {
      // Exclusive accordion (shadcn Accordion reference): opening this closes Diagnostic.
      document.dispatchEvent(new CustomEvent("sift:accordion-open", { detail: { zone: "metadonnees" } }));
      // 2026-07-06 annotation: the separate pencil "Modifier manuellement" button was redundant
      // with this same click (opening the zone only revealed a *read-only* display; a second click
      // on the pencil was needed to actually edit, and — since it re-rendered the whole zone from
      // scratch with no open state to restore — visually closed the panel it was meant to open).
      // A single click on the header now opens AND edits directly; the pencil button is removed.
      identEditing = true;
      renderEditor(host, mid, rail, report);
      forceMetaOpen();
      // renderEditor() alone only rebuilds the static markup — replay the same post-render steps
      // openFilingInto runs after its own first renderEditor() call, or this reopen regresses to a
      // blank "search Discogs" view even though the track is already identified (2026-07-06
      // annotation: the "Identifié :" line + genres were vanishing on every collapse/reopen).
      if (state.identified && state.canonical) {
        restoreIdentifiedLine(host, mid, state.canonical.artist, state.canonical.title, state.coverPath);
      }
      renderGenres();
      refreshDiscrepancy();
      updateHeaderName(mid);
      refreshPreview();
      return;
    }
    closeMeta();
  });

  const upd = () => {
    const a = host.querySelector<HTMLInputElement>('[data-fil="artist"]');
    const t = host.querySelector<HTMLInputElement>('[data-fil="title"]');
    const v = host.querySelector<HTMLInputElement>('[data-fil="version"]');
    if (!state.canonical) return;
    state.canonical.artist = a?.value ?? "";
    state.canonical.title = t?.value ?? "";
    state.canonical.version = v?.value.trim() ? v.value.trim() : null;
    refreshPreview();
    updateHeaderName(mid); // keep the report header's clean name in sync with edits
    refreshDiscrepancy(); // editing a field may make the display diverge from the file (or re-converge)
  };
  host
    .querySelectorAll<HTMLInputElement>('[data-fil="artist"],[data-fil="title"],[data-fil="version"]')
    .forEach((el) => el.addEventListener("input", upd));

  const idBtn = host.querySelector<HTMLButtonElement>('[data-fil="identifier"]');
  const candsHost = host.querySelector<HTMLElement>(".sift-cands");
  if (idBtn && candsHost) {
    idBtn.addEventListener("click", () => void doIdentify(idBtn, candsHost, host, mid));
  }

  const applyBtn = host.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
  if (applyBtn) setApplyIdle(applyBtn); // idle on every fresh render; doApplyTags flips it to "applied"


  refreshRebuyLink(); // rebuy-on-Beatport link when the open track is fake AND already identified
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
 *  after a fresh identify (onIdentityApplied). */
function refreshRebuyLink(): void {
  const el = document.querySelector<HTMLElement>(".sift-rebuy");
  if (!el) return; // editor not mounted
  const url = state.track?.verdict === "fake" && state.identified ? beatportSearchUrl() : null;
  if (!url) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    `<button class="sift-rebuy-btn" data-fil="rebuy" title="Ce fichier est un faux — chercher une version authentique sur Beatport">` +
    `<i class="ti ti-shopping-cart sift-icon-inline-md"></i> Chercher sur Beatport</button>`;
  el.querySelector('[data-fil="rebuy"]')?.addEventListener("click", () => {
    void openUrl(url).catch((e) => console.error("openUrl (rebuy) failed", e));
  });
}

// Apply-button state machine. ONE button toggles between "Apply ID3 tags" (writes the file) and
// "Appliqué ✓ — Annuler" (reverts the batch just written). `onclick` is reassigned (not
// addEventListener) so a toggle never stacks handlers.
const APPLY_IDLE_HTML =
  '<i class="ti ti-tag sift-icon-inline-md"></i> Appliquer';

/** Put the Apply button in its idle "write" state. Left ENABLED here — refreshDiscrepancy() is
 *  what actually gates .disabled against tagFieldDiffs().any right after (called on every path
 *  that can call this: open, edit, apply, undo), so this only needs to clear the "applied" marker
 *  the disable check keys off. */
function setApplyIdle(btn: HTMLButtonElement): void {
  btn.disabled = false;
  delete btn.dataset.applied;
  btn.style.color = "var(--color-text-secondary)";
  btn.innerHTML = APPLY_IDLE_HTML;
  btn.onclick = () => void doApplyTags(btn);
}

/** Put the Apply button in its "applied — click to undo" state (the whole button reverts `batchId`).
 *  Green is a brief flash (.sift-applytags-flash), not a permanent color — same convention already
 *  applied to the CDJ badge / candidate selection / Discogs CTA: a confirmed state stays neutral,
 *  only the transition into it is colored. Plain text, no icon (annotation: "vire les icones" —
 *  matches .sift-toast-undo's plain "Annuler", not a decorative checkmark next to a label that
 *  already says what happened). */
function setApplyApplied(btn: HTMLButtonElement, batchId: string): void {
  btn.disabled = false;
  btn.dataset.applied = "1"; // refreshDiscrepancy() never disables an "Annuler" button on d.any===false
  btn.style.color = "var(--color-text-primary)";
  btn.textContent = "Annuler";
  btn.onclick = () => void doUndoApply(btn, batchId);
  btn.classList.add("sift-applytags-flash");
  btn.addEventListener("animationend", () => btn.classList.remove("sift-applytags-flash"), { once: true });
}

/** Reset a possibly-"applied" Apply button back to idle (e.g. when the identity changes under it). */
function resetApplyButton(scope: HTMLElement): void {
  const btn = scope.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
  if (btn) setApplyIdle(btn);
}

/** Write the current edited tags onto the file in place (apply_tags). On success the file matches
 *  the display, so re-snapshot to clear the marker and flip the button to "Appliqué ✓ — Annuler".
 *  No move/encode/status change — works on any file. openState.openSeq-guarded: a later open never repaints
 *  this track's state/UI. */
async function doApplyTags(btn: HTMLButtonElement): Promise<void> {
  if (!state.track || !state.canonical) return;
  const trackId = state.track.id;
  const edited = state.canonical;
  const myseq = openState.openSeq;
  btn.disabled = true;
  btn.innerHTML =
    '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Applying…';
  try {
    const batchId = await applyTags(trackId, edited);
    const snap = await trackFileTags(trackId); // file changed → refresh the in-memory snapshot
    if (myseq !== openState.openSeq) return; // another track opened meanwhile — leave its state/UI alone
    state.fileTags = snap;
    refreshDiscrepancy(); // file == display now → marker clears
    // Derived from `snap` (a REAL re-read of the file's tags, track_file_tags — not assumed from
    // apply_tags returning Ok) — same Artist+Title-present criterion as tags_cdj_ok (tags.rs) at
    // initial analysis. Trusting the write result alone would show "compatible" even on a silent
    // partial write; this re-verifies against the actual file.
    const cdjOk = !!(snap.artist?.trim() && snap.title?.trim());
    const cdjBadgeAfterApply = document.querySelector<HTMLElement>("#sift-cdj-badge");
    if (cdjBadgeAfterApply) {
      cdjBadgeAfterApply.textContent = cdjOk ? "CDJ compatible" : "CDJ incompatible";
      cdjBadgeAfterApply.style.background = cdjOk
        ? "var(--color-background-success)"
        : "var(--color-background-warning)";
      cdjBadgeAfterApply.style.color = cdjOk ? "var(--color-text-success)" : "var(--color-text-warning)";
    }
    setApplyApplied(btn, batchId);
  } catch (e) {
    console.error("apply_tags failed", e);
    toast("Échec de l'écriture des tags", false);
    if (myseq === openState.openSeq) setApplyIdle(btn);
  }
}

/** Undo the just-applied tag write (targeted revert of its batch). The file returns to its old tags
 *  → re-snapshot → the marker reappears and the button returns to idle. openState.openSeq-guarded. */
async function doUndoApply(btn: HTMLButtonElement, batchId: string): Promise<void> {
  const trackId = state.track?.id;
  const myseq = openState.openSeq;
  btn.disabled = true;
  btn.innerHTML =
    '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Annulation…';
  try {
    await revertBatch(batchId);
    if (trackId != null) {
      const snap = await trackFileTags(trackId);
      if (myseq !== openState.openSeq) return;
      state.fileTags = snap;
    }
    if (myseq !== openState.openSeq) return;
    refreshDiscrepancy(); // file back to old tags → display diverges again → marker reappears
    setApplyIdle(btn);
  } catch (e) {
    console.error("revert tag_edit failed", e);
    toast("Annulation impossible", false);
    if (myseq === openState.openSeq) setApplyApplied(btn, batchId); // stay applied so the user can retry
  }
}
