// Live Revue filing controller (Tauri only). Augments the mockup's Revue shell: renders the
// son-first analysis detail into the #mid pane, and the validation rail into the right .dest
// column — destination tree into #fldz (with a NoLibraryRoot picker gate) and the filing footer
// (editable canonical fields, format override, Identify, File / Re-source / Discard) into
// #filfoot below it. Drives the M4 backend via the IPC bindings; the plain-browser demo never
// loads this (see main.ts guard).
import {
  reconcile,
  fileTrack,
  listQueue,
  rejectTrack,
  requeueTrack,
  undoLast,
  revertBatch,
  applyTags,
  findDuplicate,
  identify,
  applyIdentity,
  openUrl,
  trackRelease,
  trackFileTags,
} from "./ipc";
import type { Candidate, AppliedIdentity } from "./ipc";
import type { DupMatch, TrackRelease, FileTags } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  openReportInto,
  togglePlay,
  vchipHtml,
  row,
  keyboardHintsHtml,
  zoneToggleHtml,
} from "./report-view";
import { renderCandidates } from "./identify-shared";
import { resolveGenreFamily } from "./genre-families";
import type { Canonical, Target, QueueItem, AnalysisReport } from "../shared/contracts";
import { FILE_IN_PLACE } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { emptyStateHtml } from "./empty-state";
import { confirmAction } from "./confirm-modal";
import {
  fileInPlaceChecked,
  getBinRel,
  hasDestination,
  binLabel,
  registerOpenTrackPathGetter,
  registerDestChangeHook,
  repositionDestPopoverIfOpen,
  toggleDestPopover,
  ensureDestPopoverAutoClose,
} from "./filing-bins";
import { state, openState } from "./filing-state";
import { toast, registerClearPaneHook } from "./filing-toast";
import {
  TARGET_LABEL,
  titleCase,
  defaultTarget,
  updateHeaderName,
  refreshPreview,
} from "./filing-preview";

export { TARGET_LABEL } from "./filing-preview";

/** Banner label when a track was filed in place (its own source folder, not a tree bin). */
const IN_PLACE_BIN_LABEL = "source folder";


/** Shared, mutable Revue state for the current filing session. Destination-selection state
 *  (library root, bin list, selected bin, "sur place" flag) moved to filing-bins.ts's own
 *  DestState (tech-debt audit F03 — god-file split, first tranche). */

// Identification card display mode: false = read-only grid (maquette default), true = the
// existing editable artist/title/version inputs. Reset on every track open (Step 3) so a new
// track never inherits the previous track's edit-mode.
let identEditing = false;

// Exclusive accordion (shadcn Accordion reference, ui.shadcn.com/docs/components/base/accordion):
// opening Métadonnées closes Diagnostic and vice versa. Coordinated with report-view.ts (no
// shared ancestor passed down) via a document-level event — see the matching listener there for
// why a single module-load-time registration doesn't leak across track re-opens.
let closeMetaZone: (() => void) | null = null;
document.addEventListener("sift:accordion-open", (e) => {
  if ((e as CustomEvent).detail?.zone !== "metadonnees") closeMetaZone?.();
});

// Wire filing-bins.ts's two injection points once at module load (mirrors sift-live.ts's
// registerBatchRenderer/registerRefreshHook, Phase 1 tranches) — lets it read the open track's
// path and trigger a rail refresh without importing this module back (would be a static cycle).
registerOpenTrackPathGetter(() => state.track?.path ?? null);
registerDestChangeHook(() => refreshFootButton());
registerClearPaneHook(clearPane);



/** Destination button's value text: the real bin label once one is chosen, else an explicit call
 *  to action — never the bare "—" the button used to show for "nothing chosen yet". */
function destValueLabel(): string {
  return hasDestination() ? binLabel() : "Choisir…";
}

/** Single source of truth for the Ranger button's label + real disabled state. A disabled native
 *  button never fires click, so this is the actual guard (doRanger's own dest===null check stays
 *  as defense in depth) — previously the only feedback for "no destination" was "Ranger → —" plus
 *  a toast AFTER the click.
 *  Displayed verb changed "Ranger"→"Convertir" (2026-07-10, retour utilisateur) — a 2026-07-03
 *  audit had deliberately picked "Ranger" to match the Détail rail's verb and to hide the
 *  encode step behind one product-level action ("déplacer = encoder + ranger", CLAUDE.md).
 *  Overridden: "Convertir" reads as more explicit about what the button actually does, and the
 *  Détail-rail/batch-rail button pair still shares one verb — see sift-live.ts's own button. */
function refreshRangerButton(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-fil="ranger"]');
  if (!btn) return;
  const ok = hasDestination();
  btn.disabled = !ok;
  btn.title = ok ? "" : "Choisis une destination avant de convertir";
  // Text only, no decorative kbd glyph next to an already-descriptive label (annotation: "supprime
  // les icones" — same rule already applied to Ranger/Jeter elsewhere, see CLAUDE.md). The shortcut
  // itself is still shown in the standalone kbd-hints legend (keyboardHintsHtml), not repeated here.
  btn.innerHTML = ok
    ? `Convertir → <span class="sift-fil-bin">${esc(binLabel())}</span>`
    : "Choisis une destination pour convertir";
}

/** Re-render everything a destination change touches: the Destination button's own label/ambre
 *  state and the Ranger button's label/disabled state — both derive from the same
 *  hasDestination()/binLabel() pair. */
function refreshFootButton(): void {
  document.querySelectorAll<HTMLElement>('[data-fil="destbtn"]').forEach((el) => {
    el.classList.toggle("sift-dest-btn-empty", !hasDestination());
    const val = el.querySelector<HTMLElement>(".sift-fil-bin");
    if (val) val.textContent = destValueLabel();
  });
  refreshRangerButton();
}


// Per-track Discogs release facts (label/year/country/format), captured when an identity is
// applied so they survive a close+reopen of the SAME track within the session. `reconcile` (the
// only open-time read) doesn't return them, and re-reading would need a new IPC — so we hold them
// in memory. Keyed by track id. Cross-session reopen won't repopulate this (a fresh process starts
// empty) — country/format additionally have no persisted backend column at all (unlike label/year,
// which trackRelease re-populates from the `metadata` table on a real reopen), so those two are
// session-only regardless of process lifetime.
const releaseCache = new Map<
  number,
  { label: string | null; year: number | null; country: string | null; format: string | null }
>();

/** Render the genre chips into `.sift-genres` from `state.genres` (single source — set on open from
 *  track_release, or from `applied.styles` on identify). Empty list → empty box (no chips). */
function renderGenres(): void {
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
function refreshDiscrepancy(): void {
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
function restoreIdentifiedLine(
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
          host.innerHTML = `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>${esc(String(e))}</div>`;
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
    const msg = String(err);
    if (msg.includes("NO_TOKEN")) {
      // [C2/m5] explain WHY + give a direct action to open Réglages
      host.innerHTML =
        `<div class="sift-cands-msg">Discogs limite les recherches anonymes — ajoute ton jeton (gratuit) dans Réglages.</div>` +
        `<button class="sift-cand-jump sift-goto-reglages" data-fil="goto-reglages"><i class="ti ti-arrow-right"></i> Ouvrir Réglages</button>`;
      const gotoBtn = host.querySelector<HTMLElement>('[data-fil="goto-reglages"]');
      gotoBtn?.addEventListener("click", () => {
        // Navigate to the Réglages view via the existing nav click handler in app.js
        requireEl('[data-view="reglages"]', "filing goto-reglages").dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
    } else {
      const rl = msg.match(/RATE_LIMITED:(\d+)/);
      if (rl) {
        host.innerHTML = `<div class="sift-cands-msg">Discogs limite le débit — réessaie dans ${rl[1]}s.</div>`;
      } else {
        // [m10] network/server errors get a warning icon to distinguish from "no results"
        host.innerHTML = `<div class="sift-cands-msg sift-cands-error"><i class="ti ti-alert-triangle sift-cand-error-icon"></i>Discogs injoignable.</div>`;
      }
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = origLabel;
  }
}

/** Create-once (idempotent) keyboard-shortcut legend, inserted as its OWN row directly AFTER
 *  #filfoot (annotation, 2nd round: "devrait etre en fin de page en fait, sous le bloc de
 *  destination etc") — not one of the rail's flex-wrap items (it used to live inside the rail
 *  where it could get squeezed/wrapped away under width pressure; it should instead "rester
 *  toujours visible", in its own space) and not above the rail either, per this later correction —
 *  the very last thing on the page, below Destination/Format/Ranger. Static content (never
 *  changes across renders), so a single append is enough — renderFoot calls this every time
 *  purely to guarantee it exists, not to refresh it. */
function ensureKbdLegend(foot: HTMLElement): void {
  if (document.getElementById("sift-kbd-legend")) return;
  const el = document.createElement("div");
  el.id = "sift-kbd-legend";
  el.className = "sift-kbd-legend";
  el.innerHTML = keyboardHintsHtml();
  foot.parentElement?.insertBefore(el, foot.nextSibling);
}

/** Slides #sift-fmt-seg's .sift-seg-thumb to the currently selected format chip (or removes it if
 *  every chip is disabled, e.g. a lossy source with only MP3 clickable — .on never gets set on a
 *  disabled span, so onEl is null and the thumb just stays wherever it last was, invisible behind
 *  the disabled chips since none of them carry z-index:1). Same pattern as ensureReviewSeg(). */
function positionFmtThumb(foot: HTMLElement): void {
  const seg = foot.querySelector<HTMLElement>("#sift-fmt-seg");
  const thumb = seg?.querySelector<HTMLElement>(".sift-seg-thumb");
  const onEl = seg?.querySelector<HTMLElement>('[data-fil="fmt"].on');
  if (!thumb || !onEl) return;
  thumb.style.width = `${onEl.offsetWidth}px`;
  thumb.style.transform = `translateX(${onEl.offsetLeft}px)`;
}

/** Render the filing rail (format + actions) into `foot`. The metadata editor (Identify + editable
 *  fields + final-name preview + genres) lives in the center now — see `renderEditor`. */
function renderFoot(foot: HTMLElement, mid: HTMLElement, rail: string): void {
  // Preserve the "Filed" banner across re-renders: it is prepended at the TOP of #filfoot (étape 2)
  // and must survive renderFoot's innerHTML rewrite (e.g. a format-chip click) until the next filing or ✕.
  const filedBanner = foot.querySelector(".sift-filed-banner");
  if (!state.canonical) {
    foot.innerHTML = "";
    if (filedBanner) foot.prepend(filedBanner);
    return;
  }

  const lossy = rail === "lossy";
  const chips = (["mp3_320", "aiff_16_44", "wav_16_44"] as Target[])
    .map((t) => {
      // a lossy source can't be upscaled to lossless — disable AIFF/WAV (the backend refuses
      // it anyway; greying it out prevents the dead-end click).
      if (lossy && t !== "mp3_320")
        return `<span class="sift-seg-opt sift-chip-disabled" title="Pas de surqualité depuis un fichier lossy">${TARGET_LABEL[t]}</span>`;
      const on = (state.target ?? defaultTarget(rail)) === t ? " on" : "";
      return `<span class="sift-seg-opt${on}" data-fil="fmt" data-t="${t}">${TARGET_LABEL[t]}</span>`;
    })
    .join("");

  const fake = state.track?.verdict === "fake";
  // Text only (annotation: "supprime les icones") — the shortcut is still named in the tooltip
  // and the standalone kbd-hints legend, not repeated as a glyph inside the button itself.
  // "Jeter" relabelled "Écarter" (annotation: "jeter devrait etre écarté, et finir dans écarter")
  // — it now routes to Écartés (reject_track) like the fake branch, not a permanent delete;
  // real deletion is still available from the Écartés screen itself (ecartes-view.ts's own
  // trash action), so this button is no longer the only path to "gone for good".
  const secondary = fake
    ? '<button data-fil="resource" class="sift-secondary-resource" title="Fichier faux — va dans Écartés (⌫)">Re-source</button>'
    : '<button data-fil="trash" class="sift-secondary-trash" title="Écarter — va dans Écartés (⌫)">Écarter</button>';

  ensureKbdLegend(foot); // its own always-visible strip directly above the rail, not a rail item

  // Destination button opens the tree as a popover (#fldz, a sibling of #filfoot — see styles.css)
  // instead of the old persistent .dest column. Rail order (2026-07-06 redesign): Destination →
  // Format → Nom final (moved here from the verdict conclusion) → spacer → secondary → Ranger.
  // Rebuilt inside this innerHTML so a format-chip re-render keeps it; the popover's own hidden
  // state lives on #fldz itself, untouched by this rewrite.
  foot.innerHTML =
    `<button data-fil="destbtn" class="sift-dest-btn${hasDestination() ? "" : " sift-dest-btn-empty"}">` +
    `<span class="sift-dest-btn-label">Destination</span>` +
    `<span class="sift-fil-bin">${esc(destValueLabel())}</span>` +
    `<i class="ti ti-chevron-down sift-dest-btn-caret"></i></button>` +
    `<div class="sift-rail-fmt-group"><span class="col-h">Format</span><div class="sift-seg sift-seg-thumbed" id="sift-fmt-seg"><div class="sift-seg-thumb"></div>${chips}</div></div>` +
    `<div class="sift-rail-final-group"><span class="sift-final-name-label">Nom final</span><span class="sift-fil-prev"></span></div>` +
    `<div class="sift-rail-spacer"></div>` +
    secondary +
    `<button data-fil="ranger" class="sift-ranger-btn"></button>`;
  if (filedBanner) foot.prepend(filedBanner); // restore the banner above the freshly-rendered controls
  refreshRangerButton(); // single source of truth for the button's label/disabled state
  refreshPreview(); // repaint .sift-fil-prev just added above — it was empty until now
  positionFmtThumb(foot);

  foot.querySelector('[data-fil="destbtn"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDestPopover();
  });
  ensureDestPopoverAutoClose();

  // In-place update instead of a full renderFoot() (2026-07-08, retour utilisateur : thumb glissant
  // pour Format comme Détail/Lot) — a full rebuild would tear down and recreate the chip elements
  // on every click, leaving .sift-seg-thumb nothing to animate between (see ensureReviewSeg in
  // sift-live.ts for the same fix applied there first). Nothing else in the rail depends on
  // state.target besides the preview extension and the Ranger button's enabled state, both
  // already refreshed below without needing the surrounding markup rebuilt.
  foot.querySelectorAll<HTMLElement>('[data-fil="fmt"]').forEach((el) =>
    el.addEventListener("click", () => {
      state.target = (el.dataset.t as Target) || null;
      foot
        .querySelectorAll<HTMLElement>('[data-fil="fmt"]')
        .forEach((c) => c.classList.toggle("on", c.dataset.t === state.target));
      positionFmtThumb(foot);
      refreshRangerButton();
      refreshPreview(); // the chosen format sets the filename extension shown in the rail preview
    }),
  );

  foot
    .querySelector('[data-fil="ranger"]')
    ?.addEventListener("click", () => void doRanger(mid));
  foot
    .querySelector('[data-fil="resource"]')
    ?.addEventListener("click", () => void doSecondary(mid, "resource"));
  foot
    .querySelector('[data-fil="trash"]')
    ?.addEventListener("click", () => void doSecondary(mid, "trash"));
  repositionDestPopoverIfOpen(); // the destbtn above was just rebuilt — keep an open popover glued to it
}

/** Render the center metadata editor (Identify + editable fields + genres) into `host`, below the
 *  analysis report. The final-name preview lives in the rail (`renderFoot`) next to the File button;
 *  this pane ends with genres. One-shot innerHTML — called once per track open, not on a
 *  burst event, so create-once/update-in-place is not required here. `rail` is accepted for symmetry
 *  with renderFoot; the editor itself is format-agnostic (the extension comes from state.target). */
function renderEditor(host: HTMLElement, mid: HTMLElement, rail: string, report: AnalysisReport | null): void {
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
    `<div class="sift-tag-warn" style="display:none"><i class="ti ti-alert-triangle sift-icon-inline-md sift-icon-flex-none"></i><span>Artiste et Titre pas encore gravés dans le fichier (seulement identifiés ci-dessus) — un CDJ ne peut pas les lire tant que ce n'est pas fait. <strong>Convertir</strong> ou <strong>Appliquer les tags</strong> pour corriger.</span></div>` +
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

// One filing action at a time — guards against a double-click firing two encodes.

/** Disable/enable the rail action buttons (visible feedback while an action runs). The buttons
 *  live in #filfoot now, so query the document rather than the #mid pane. */
function setActionsDisabled(disabled: boolean): void {
  document
    .querySelectorAll<HTMLButtonElement>('[data-fil="ranger"],[data-fil="resource"],[data-fil="trash"]')
    .forEach((b) => {
      b.disabled = disabled;
      b.style.opacity = disabled ? "0.55" : "";
      b.style.pointerEvents = disabled ? "none" : "";
    });
}

/** Ranger the current track into the selected bin. */
async function doRanger(mid: HTMLElement): Promise<void> {
  if (!state.track || !state.canonical || openState.acting) return;
  const track = state.track;
  const canonical = state.canonical;
  // "Sur place" checked → destination is the track's own source folder (sentinel), bypassing the
  // tree selection. The sentinel rides the normal binRel channel — no separate flag (single channel).
  const inPlace = fileInPlaceChecked();
  const dest = inPlace ? FILE_IN_PLACE : getBinRel();
  if (dest === null) {
    toast("Choisis un dossier de destination.", false);
    return;
  }
  const ranger = document.querySelector<HTMLElement>('[data-fil="ranger"]');
  const orig = ranger?.innerHTML ?? null;
  openState.acting = true;
  setActionsDisabled(true);
  if (ranger)
    ranger.innerHTML =
      '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Conversion en cours…';
  // FIX-1: a RAIL_MISMATCH rejection means the source's extension claims lossless but its real
  // content is lossy (e.g. an MP3 renamed .flac) — retry once with explicit confirmation instead
  // of a plain toast. A retry loop (not recursion) so this function's own `finally` stays the
  // single owner of `openState.acting` — see docs/superpowers/reviews/2026-07-02-handoff-fix1-anti-upscale.md for why recursion would race it.
  let allowRailMismatch = false;
  try {
    for (;;) {
      try {
        const res = await fileTrack(track.id, dest, state.target, canonical, allowRailMismatch);
        // Capture the "after" facts for the rail banner BEFORE we advance (state resets on the next open).
        const filedPath = res.path;
        const batchId = res.batch_id;
        const bin = inPlace ? IN_PLACE_BIN_LABEL : binLabel();
        // Auto-advance: the filed track has left the pending list, so switching away from it here is
        // LEGITIMATE — this is the one place allowed to switch outside syncDetail's player guard, because
        // we KNOW the current track was just filed (never on a passive analysis refresh). Reuse the
        // existing load path openFilingInto; fresh pending list → items[0] is the next track to file.
        let items: QueueItem[] = [];
        try {
          items = await listQueue();
        } catch (err) {
          console.error("listQueue failed after filing", err);
        }
        if (items.length) await openFilingInto(mid, items[0]);
        else clearPane(mid, true); // no pending left → the formal empty state; the banner still shows in the rail
        // Filed confirmation as a banner at the TOP of the right rail, ABOVE the new track's controls
        // (renderFoot, run by openFilingInto above, already wrote them; the banner is prepended before
        // them — 2026-07-06 annotation: it was previously appended last/bottom, past Destination →
        // Format → hints → Discard → File, reading as inert/easy to miss).
        showFiledConfirm(batchId, bin, filedPath);
        return;
      } catch (e) {
        const msg = String(e);
        if (!allowRailMismatch && msg.includes("RAIL_MISMATCH")) {
          const ext = (track.path.split(".").pop() || "").toUpperCase();
          const proceed = await confirmAction(
            `Ce fichier est déclaré ${ext} mais son contenu réel est compressé (lossy) — ` +
              `le convertir créerait un faux fichier lossless.\n\nConvertir quand même ?`,
          );
          if (proceed) {
            allowRailMismatch = true;
            continue;
          }
          // Refus explicite : sortie propre, pas d'erreur, pas de toast — l'utilisateur a choisi
          // de ne rien faire.
          setActionsDisabled(false);
          if (ranger && orig != null) ranger.innerHTML = orig;
          return;
        }
        throw e;
      }
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes("NoLibraryRoot")) toast("Aucune racine de bibliothèque configurée.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else if (/permission|access|denied/i.test(msg)) toast("Refusé : accès au fichier/dossier refusé.", false);
    else if (/no such file|not found|introuvable/i.test(msg)) toast("Fichier introuvable — a-t-il été déplacé ?", false);
    else toast(`Échec de la conversion : ${msg}`, false);
    console.error("file_track failed", e);
    setActionsDisabled(false);
    if (ranger && orig != null) ranger.innerHTML = orig;
  } finally {
    openState.acting = false;
  }
}

/** Show the "Filed ✓ ↩" confirmation as a BANNER at the TOP of the right rail (#filfoot), above the
 *  next track's controls — the center has already auto-advanced to the next pending track (doRanger).
 *  This is the "after" proof for the file just filed: name + destination path + a targeted Revert.
 *  ONE banner at a time (replaces any prior). Revert is targeted on this file's `batchId`
 *  (revert_batch), available indefinitely via the journal; the ✕ dismisses the banner without
 *  reverting. Does NOT touch #mid or state.track — the advance owns those. */
function showFiledConfirm(batchId: string, bin: string, filedPath: string): void {
  state.filedConfirm = { batchId, bin };
  const foot = document.getElementById("filfoot");
  if (!foot) return; // rail gone (navigated away while the file completed) — nothing to show
  const filename = filedPath.split(/[\\/]/).pop() || filedPath;
  foot.querySelector(".sift-filed-banner")?.remove(); // one at a time — replace any prior banner
  const banner = document.createElement("div");
  banner.className = "sift-filed-banner";
  // CDS single-side accent: success border-left, square corners. Success tint sets it apart from the
  // secondary-coloured rail. renderFoot preserves this node across its re-renders (format clicks).
  // margin-bottom (not -top): the banner sits at the TOP of the rail, above Destination — space it below.
  banner.innerHTML =
    `<div class="sift-filed-banner-head">` +
    `<i class="ti ti-check"></i>` +
    `<span class="sift-filed-banner-label">Converti</span>` +
    `<span class="sift-filed-banner-bin">→ ${esc(bin)}</span>` +
    `<button data-fil="filed-close" title="Fermer" aria-label="Fermer" class="sift-filed-banner-close"><i class="ti ti-x"></i></button>` +
    `</div>` +
    `<div class="sift-filed-banner-name">${esc(filename)}</div>` +
    `<div class="sift-filed-banner-path">${esc(filedPath)}</div>` +
    `<button data-fil="revert" class="sift-filed-banner-revert"><i class="ti ti-arrow-back-up"></i> Annuler</button>`;
  // 2026-07-06 annotation: was foot.append (last child, past Destination → Format → hints → Discard
  // → File — read as inert/easy to miss). prepend matches this function's own documented intent
  // (TOP of the rail, first thing seen) and .sift-filed-banner's full-width rule below now forces
  // it onto its own line regardless of where in the row it sits.
  foot.prepend(banner);
  banner.querySelector('[data-fil="revert"]')?.addEventListener("click", () => void doRevert(batchId));
  banner.querySelector('[data-fil="filed-close"]')?.addEventListener("click", () => {
    banner.remove();
    state.filedConfirm = null;
  });
}

/** Revert THIS file's filing, targeted on its `batchId` (revert_batch). On success the engine
 *  puts the track back to pending and emits queue:changed → the queue refreshes. On a Blocked
 *  engine error (e.g. the original was purged from the trash) show a clear message rather than
 *  failing mutely. The revert engine itself is untouched here. */
async function doRevert(batchId: string): Promise<void> {
  try {
    await revertBatch(batchId);
    // The filing is undone → drop the banner. The reverted file returns to pending (backend emits
    // queue:changed → the queue list refreshes). We do NOT clearPane: the auto-advanced track in
    // #mid stays put (syncDetail's player guard keeps it), so reverting never yanks the player.
    document.getElementById("filfoot")?.querySelector(".sift-filed-banner")?.remove();
    state.filedConfirm = null;
    toast("Annulé — retour dans la file", false);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("source gone")) {
      toast("Annulation impossible : un fichier nécessaire a disparu — l'original a peut-être été purgé de la corbeille.", false);
    } else {
      toast(`Échec de l'annulation : ${msg}`, false);
    }
    console.error("revert failed", e);
  }
}

/** Re-sourcer (fake) or Écarter (non-fake) the current track — both are the same reversible
 *  reject_track path now (annotation: "jeter devrait etre écarté, et finir dans écarter"); `kind`
 *  stays two-valued only to pick the right toast wording, not a different backend action anymore. */
async function doSecondary(mid: HTMLElement, kind: "resource" | "trash"): Promise<void> {
  if (!state.track || openState.acting) return;
  const trackId = state.track.id;
  openState.acting = true;
  setActionsDisabled(true);
  try {
    await rejectTrack(trackId);
    toast(kind === "resource" ? "Marqué à re-sourcer" : "Écarté", true, () => {
      void requeueTrack(trackId).catch((e) => {
        console.error(`${kind} undo failed`, e);
        toast(`Échec de l'annulation : ${String(e)}`, false);
      });
    });
    clearPane(mid);
  } catch (e) {
    toast(`Échec : ${String(e)}`, false);
    console.error(`${kind} failed`, e);
    setActionsDisabled(false);
  } finally {
    openState.acting = false;
  }
}

/** Empty the detail pane back to a neutral prompt (after an action), or — when `emptyQueue` is
 *  true — to the formal empty state (DESIGN.md "État vide"): the caller already knows the queue
 *  has nothing left, a real dead-end rather than a mid-session deselect. Revue is the entry point
 *  so it never gets a "back to X" link; the rail is already cleared below in both cases. */
function clearPane(mid: HTMLElement, emptyQueue = false): void {
  state.track = null;
  state.canonical = null;
  state.target = null;
  state.label = null;
  state.year = null;
  state.releaseCountry = null;
  state.releaseFormat = null;
  state.coverPath = null;
  state.genres = [];
  state.fileTags = null;
  state.filedConfirm = null;
  state.identified = false;
  mid.innerHTML = emptyQueue
    ? emptyStateHtml({
        title: "Rien à revoir",
        note: "Les morceaux à traiter apparaissent ici une fois ajoutés depuis Accueil ou déposés dans la file.",
      })
    : '<div class="sift-clear-pane">Sélectionne un morceau dans la file pour l\'écouter et le convertir.</div>';
  // The validation footer lives in the rail (#filfoot); clear it too so no stale controls linger
  // (non-throw: clearPane runs from async revert/undo/secondary callbacks that may fire off Review).
  const ff = document.getElementById("filfoot");
  if (ff) ff.innerHTML = "";
}

/** Banner HTML for a duplicate match (filed = already in library, pending = dupe in queue;
 * `both` = sound-confirmed, `name` = same name only → cautious wording). */
function dupBanner(m: DupMatch): string {
  const where =
    m.status === "filed"
      ? `Déjà converti : ${esc((m.folder ? m.folder + "/" : "") + (m.filename || ""))}`
      : `Doublon d'un fichier en file : ${esc(m.filename || "")}`;
  const sure = m.kind === "both";
  const fg = sure ? "var(--color-text-warning)" : "var(--color-text-tertiary)";
  const bg = sure ? "var(--color-background-warning)" : "var(--color-background-secondary)";
  const head = sure ? "Doublon" : "Doublon possible (même nom — à vérifier)";
  return `<div class="sift-dup-banner" style="background:${bg}"><i class="ti ti-copy" style="color:${fg}"></i><div class="sift-dup-banner-body"><div class="sift-dup-banner-head" style="color:${fg}">${head}</div><div class="sift-dup-banner-where">${where}</div></div></div>`;
}

// Bumped on every open; an in-flight open bails at its await points if a newer one started
// (prevents a slow analyze/reconcile from clobbering the pane of a track opened since).

/** Render the analysis report + filing footer for `item` into the #mid pane. */
export async function openFilingInto(mid: HTMLElement, item: QueueItem): Promise<void> {
  const myseq = ++openState.openSeq;
  state.track = item;
  state.target = null;
  state.canonical = null;
  // Seed read-only release facts SYNCHRONOUSLY from the session cache (set on a prior identify this
  // session) so a re-open paints label/year with no flash. The persisted `metadata` table is the
  // source of truth and is read below (trackRelease) — it primes the cold-start case (cache empty).
  const cachedRelease = releaseCache.get(item.id);
  state.label = cachedRelease?.label ?? null;
  state.year = cachedRelease?.year ?? null;
  state.releaseCountry = cachedRelease?.country ?? null;
  state.releaseFormat = cachedRelease?.format ?? null;
  state.filedConfirm = null; // opening a track dismisses any "Filed ↩" confirmation
  identEditing = false; // Identification card always opens in read-only display mode

  mid.innerHTML =
    '<div class="sift-fil sift-fil-root">' +
    '<div class="sift-fil-scroll">' +
    '<div class="sift-fil-report"></div>' +
    '<div class="sift-fil-editor sift-fil-editor-margin"></div>' +
    '<div class="sift-fil-verdict sift-fil-editor-margin"></div>' +
    '</div>' +
    '<div class="sift-fil-dup"></div>' +
    "</div>";
  const reportEl = requireEl<HTMLElement>(".sift-fil-report", "openFilingInto", mid);
  // Verdict is the CONCLUSION — rendered last, after Identification, matching the maquette
  // (see docs/superpowers/plans/2026-07-02-refonte-ui-plan.md, décision du 2026-07-02). Passed to openReportInto below.
  const verdictEl = requireEl<HTMLElement>(".sift-fil-verdict", "openFilingInto", mid);
  // The validation footer now lives in the right rail (#filfoot in the .dest column), below the
  // destination tree — so #mid is a pure son-first detail and the rail holds the filing stack.
  const footEl = requireEl("#filfoot", "openFilingInto");

  // Duplicate check (by name, sound-confirmed when available) — drives both the banner slot and
  // the verdict-panel UNIQUE/DUPLICATE chip (appended once the panel exists, see end of fn).
  const dupP = findDuplicate(item.id).catch((e): DupMatch | null => {
    console.error("find_duplicate failed", e);
    return null;
  });
  void dupP.then((m) => {
    if (!m || state.track?.id !== item.id) return;
    const slot = mid.querySelector<HTMLElement>(".sift-fil-dup");
    if (slot) slot.innerHTML = dupBanner(m);
  });

  // Analysis report, metadata reconcile, the persisted release facts, and the file's REAL tags are
  // independent reads — run them in parallel so the footer renders as soon as they complete. The
  // file-tags read is the ONE disk read for the discrepancy marker (cached after; never per-keystroke).
  // Tracks whether any of the 3 reads below failed, so a real IPC error can be surfaced to the
  // user distinctly from "nothing to show yet" instead of silently rendering as an empty field.
  let readError = false;
  const [report, canonical, release, fileTags] = await Promise.all([
    openReportInto(reportEl, item.path, verdictEl, { deferText: true }),
    reconcile(item.id).catch((e): Canonical => {
      console.error("reconcile failed", e);
      readError = true;
      return { artist: "", title: "", version: null, confidence: "yellow" };
    }),
    trackRelease(item.id).catch((e): TrackRelease => {
      console.error("track_release failed", e);
      readError = true;
      return { artist: null, title: null, version: null, label: null, year: null, cover_path: null, genres: [], identified: false };
    }),
    // On failure: leave fileTags null (no marker) and log it — never assert a discrepancy we could
    // not measure (no silent false alarm).
    trackFileTags(item.id).catch((e): FileTags | null => {
      console.error("track_file_tags failed", e);
      readError = true;
      return null;
    }),
  ]);
  if (myseq !== openState.openSeq) return; // a newer open started while we awaited — don't paint this track

  // When a Discogs identity was applied earlier but not yet filed, the file tags still hold the OLD
  // name, so reconcile (which reads those tags) would wipe the chosen identity on reopen. Trust the
  // persisted metadata instead: artist/title from `metadata`, confidence green (a validated Discogs
  // match), and version kept from reconcile (the filename — metadata has no version column and
  // Discogs has no version field). Not identified → reconcile stays the source, as before.
  state.canonical =
    release.identified && release.artist && release.title
      ? {
          artist: release.artist,
          title: release.title,
          // Prefer the remix/dub stored when the release was chosen; fall back to reconcile's
          // filename-parsed version (metadata has none for that track, e.g. a Discogs title with
          // no parenthetical but a "(Dub)" filename).
          version: release.version ?? canonical.version,
          confidence: "green",
        }
      : canonical;
  // The persisted `metadata` table is the source of truth for label/year (the session cache above
  // was only a flash-avoiding seed). Cold start: this is where an identified-not-filed track gets
  // its identity + label/year back. Keep the cache in sync so later re-opens stay synchronous.
  state.label = release.label;
  state.year = release.year;
  // Country/format have no backend column (TrackRelease carries neither) — `release` says nothing
  // about them either way, so keep whatever the session cache already had instead of nulling them
  // out on every reopen (state.releaseCountry/Format were already seeded from that same cache above).
  // Would-write genres (shown in .sift-genres, compared joined) + the file's real-tags snapshot,
  // both cached here for the in-memory discrepancy check. fileTags may be null (read failed → no marker).
  state.genres = release.genres;
  state.fileTags = fileTags;
  state.identified = release.identified; // gates the rebuy link (fake + identified only)
  state.coverPath = release.cover_path;
  releaseCache.set(item.id, {
    label: release.label,
    year: release.year,
    country: cachedRelease?.country ?? null,
    format: cachedRelease?.format ?? null,
  });
  // Tidy the casing of a version parsed from a (often lowercase) filename: "original mix"
  // → "Original Mix". Title/artist are left as reconciled.
  if (state.canonical.version) state.canonical.version = titleCase(state.canonical.version);

  // Default rail by extension (analysis data attribute not available cross-module).
  const ext = (item.path.split(".").pop() || "").toLowerCase();
  let rail = "unknown";
  if (["flac", "wav", "aif", "aiff", "alac"].includes(ext)) rail = "lossless";
  else if (["mp3", "m4a", "aac", "ogg"].includes(ext)) rail = "lossy";
  state.rail = rail; // so refreshPreview defaults the extension like the lit chip does

  renderFoot(footEl, mid, rail);
  const editorEl = requireEl<HTMLElement>(".sift-fil-editor", "openFilingInto", mid);
  renderEditor(editorEl, mid, rail, report);
  // Already-identified track → show the "Identified" line (cover + release) in place of the bare
  // Fetch button, rebuilt from metadata (no network). Runs inside the openState.openSeq-guarded section above,
  // so a superseded open never paints this onto the wrong track.
  if (release.identified && state.canonical) {
    restoreIdentifiedLine(editorEl, mid, state.canonical.artist, state.canonical.title, release.cover_path);
  }
  renderGenres(); // fill .sift-genres from state.genres (also shows genres on reopen, not just fresh fetch)
  refreshDiscrepancy(); // flag the marker if the file's tags differ from the displayed identity
  updateHeaderName(mid); // show the clean proposed name in the report header
  if (readError) {
    // One of reconcile/trackRelease/trackFileTags failed above — without this, the panel would
    // just show blank/default fields indistinguishable from "not identified yet".
    // .sift-vchips never existed in the rendered markup (verdictCardHtml() — report-view.ts —
    // currently returns "" and never produced that wrapper); querying it was silent dead code for
    // this chip and the pre-existing DUPLICATE one below. .sift-fil-verdict is the actual verdict
    // slot filing.ts itself creates (openFilingInto, above) and always exists in the DOM.
    const chips = mid.querySelector<HTMLElement>(".sift-fil-verdict");
    if (chips && !chips.querySelector('[data-chip="read-error"]')) {
      chips.insertAdjacentHTML(
        "beforeend",
        vchipHtml("LECTURE INCOMPLÈTE", "danger").replace("<span ", '<span data-chip="read-error" '),
      );
    }
  }
  // Paint "Nom final" on first open — previously only set on a later edit/identify/format
  // click, so the verdict panel's name field stayed empty until the user touched something
  // (docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md §2, bug confirmé sur capture fraîche).
  refreshPreview();

  // Verdict-panel chip (board: LOSSLESS · DUPLICATE): only appended when dedup found a real match —
  // no "UNIQUE" chip for the common case, per the maquette rule that a chip exists to flag
  // something worth checking, not to confirm the absence of a problem. (CHECK MATCH removed
  // entirely — annotation confirmed intentional.)
  void dupP.then((m) => {
    if (myseq !== openState.openSeq) return;
    // .sift-vchips never existed in the rendered markup (verdictCardHtml() — report-view.ts —
    // currently returns "" and never produced that wrapper); querying it was silent dead code for
    // this chip and the pre-existing DUPLICATE one below. .sift-fil-verdict is the actual verdict
    // slot filing.ts itself creates (openFilingInto, above) and always exists in the DOM.
    const chips = mid.querySelector<HTMLElement>(".sift-fil-verdict");
    if (!chips || chips.querySelector('[data-chip="dup"]') || !m) return;
    chips.insertAdjacentHTML(
      "beforeend",
      vchipHtml("DUPLICATE", "warning").replace("<span ", '<span data-chip="dup" '),
    );
  });
}

/** Keyboard shortcuts for the open track (Revue): ↑/↓ = focus prev/next queue row,
 * Space = play/pause, Enter = File, Backspace (⌫) / X = Discard/Re-source, I = Identify.
 * Matches interaction-model.md §7. Ignored while typing in a field, and only when a track
 * is open. */
export function installFilingKeys(): void {
  const blurShortcutFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  };
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (!state.track) return; // only with a track open (i.e. on Revue)
    // ArrowUp/ArrowDown: handled by sift-live.ts's installQueueNavKeys, not here. The queue is
    // virtualized (renderQueue only mounts the visible window) — walking `#ql .qi` DOM nodes (the
    // old approach) silently stopped at the edge of whatever happened to be rendered.
    // sift-live.ts already owns currentItems and can step by index instead.
    if (e.key === " ") {
      e.preventDefault(); // also stops Space from activating a focused button
      blurShortcutFocus();
      togglePlay();
    } else if (e.key === "Enter") {
      e.preventDefault();
      blurShortcutFocus();
      document.querySelector<HTMLElement>('[data-fil="ranger"]')?.click();
    } else if (e.key === "Backspace" || e.key === "x" || e.key === "X") {
      // ⌫ is the model's Discard key; X kept as an alias (matches the visible button hint).
      e.preventDefault();
      blurShortcutFocus();
      document.querySelector<HTMLElement>('[data-fil="resource"],[data-fil="trash"]')?.click();
    } else if (e.key === "i" || e.key === "I") {
      // [m9] I = trigger Identifier (same as clicking the button)
      blurShortcutFocus();
      document.querySelector<HTMLButtonElement>('[data-fil="identifier"]')?.click();
    }
  });
}

/** Wire a one-time global Ctrl+Z → undo (ignored while editing a field). */
export function installUndoShortcut(): void {
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && (e.key === "z" || e.key === "Z"))) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    void undoLast()
      .then((b) => {
        if (b) toast("Action annulée", false);
      })
      .catch((err) => console.error("undo failed", err));
  });
}

/** Keep the detail pane in sync with the queue: if the open track is still pending, leave it
 * untouched; otherwise auto-load the first pending track into #mid — so tracks load without a
 * click, and after filing one the next opens automatically. Empty queue → neutral prompt.
 * Returns the id now shown (for the caller to highlight its row), or null. */
export function syncDetail(mid: HTMLElement, items: QueueItem[]): number | null {
  // The "Filed ✓ ↩" confirmation now lives as a banner in the right rail (#filfoot), not in #mid, so
  // it no longer blocks auto-advance — after filing, doRanger explicitly advances #mid to the next
  // pending. syncDetail's job here is unchanged: keep the open track stable, else load the first pending.
  // Is our filing pane still in #mid? On navigation back to Revue, app.js re-draws its mock
  // detail into #mid, so the pane is no longer ours and must be re-rendered — but on a mere
  // queue/analysis refresh it's intact and we must NOT disrupt it (would restart playback).
  const paneIsOurs = !!mid.querySelector(".sift-fil");
  // If a track is open and our pane is intact, NEVER switch away from it — not even if it has
  // left the pending list (e.g. just analysed). Switching would destroy the player mid-load and
  // abort its audio (waveform shows from peaks, but no sound). This is the rule that keeps the
  // user's selection stable while the background worker churns through the queue.
  if (state.track && paneIsOurs) return state.track.id;
  // Pane was wiped (e.g. nav back to Revue re-draws app.js's mock) but we still have a track →
  // restore the real pane for it.
  if (state.track) {
    void openFilingInto(mid, state.track);
    return state.track.id;
  }
  // No track open → load the first pending one.
  if (items.length) {
    void openFilingInto(mid, items[0]);
    return items[0].id;
  }
  clearPane(mid, true); // truly nothing to review — the formal empty state
  return null;
}
