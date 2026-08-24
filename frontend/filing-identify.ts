import { identify, applyIdentity, applyTags, trackFileTags, openUrl } from "./ipc";
import type { Candidate, AppliedIdentity } from "./ipc";
import type { AnalysisReport } from "../shared/contracts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { row } from "./report-view";
import { identifyErrorHtml, renderCandidates } from "./identify-shared";
import { requireEl, esc } from "./dom";
import { state, openState } from "./filing-state";
import { toast } from "./filing-toast";
import { refreshPreview, updateHeaderName, titleCase } from "./filing-preview";
import { humanizeError } from "./errors";

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

/** Peint le badge « Prêt CDJ » (fork F, 2026-08-24) : coche + mot en ok, warning + raison sinon —
 *  jamais masqué. Deux sites d'appel (au render et après apply_tags) passent par ce helper unique
 *  pour ne pas diverger. Le critère est le bool `tags_cdj_ok` (Artiste+Titre gravés) ; la « raison »
 *  fine n'existe pas encore côté Rust (#46) — le bandeau .sift-tag-warn la détaille. Libellé fixe,
 *  pas de donnée non fiable → innerHTML sans esc. */
function paintCdjBadge(el: HTMLElement, ok: boolean): void {
  el.innerHTML = ok
    ? `<i class="ti ti-check sift-icon-inline-sm" aria-hidden="true"></i>Prêt CDJ`
    : `<i class="ti ti-alert-triangle sift-icon-inline-sm" aria-hidden="true"></i>CDJ — tags manquants`;
  el.style.background = ok ? "var(--color-background-success)" : "var(--color-background-warning)";
  el.style.color = ok ? "var(--color-text-success)" : "var(--color-text-warning)";
  el.title = ok
    ? "Artiste + Titre sont gravés dans les tags du fichier — un CDJ peut les lire."
    : "Un CDJ a besoin d'Artiste + Titre gravés dans les tags du fichier (pas encore fait).";
  el.hidden = false;
}

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
  // click that gives the user nothing to do.
  const applyBtn = editor.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
  if (applyBtn) {
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
  // Label est lecture seule (rendu par renderEditor) mais onIdentityApplied ne re-render pas
  // l'éditeur — patcher sa valeur en place, comme les inputs artiste/titre/version plus haut.
  const labelRo = editor.querySelector<HTMLElement>('[data-fil="label-ro"]');
  if (labelRo) labelRo.textContent = state.label ?? "—";

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

/** Markup for the "Identified: artist — title" confirmation line (cover thumb + "change" button),
 *  shown in the candidate zone by onIdentityApplied right after a fresh Discogs release is applied. */
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

/** On reopen of an already-identified track, restore the hero cover (mid `.sift-report-cover`) from
 *  the Discogs cover path — the identity's cover isn't carried by the analysis report, so without
 *  this the hero/player cover stayed hidden until you re-ran Identify
 *  (docs/superpowers/reviews/2026-07-02-audit-fidelite-ecran-par-ecran.md décision #5). Discogs
 *  placeholder art can fail to decode → re-hide on error, same as onIdentityApplied. In direction B
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
  host.innerHTML =
    // Header statique (spec revue.md § Zone C, direction B validée 2026-08-21) : Métadonnées est
    // TOUJOURS visible, sans accordéon NI bascule read-only/édition. Les valeurs s'éditent EN PLACE —
    // chaque ligne d'attribut porte son input, stylé comme du texte au repos, révélé au survol et au
    // focus. Un seul rendu quel que soit l'état : c'est tout le point de la direction B. Le bouton
    // "Identifier" ne bascule plus un mode, il lance la recherche Discogs qui remplit ces mêmes
    // champs. Le badge CDJ (critère code recâblé par #46, hors périmètre) vit sur ce header.
    `<div class="sift-meta-header">` +
    `<span class="sift-meta-title">Métadonnées</span>` +
    `<span class="sift-meta-header-right">` +
    `<span class="sift-chip-badge" id="sift-cdj-badge" hidden></span>` +
    `<button data-fil="identifier" class="sift-meta-ident-btn" title="Rechercher les métadonnées sur Discogs (pochette, label, année, genres)"><i class="ti ti-search sift-icon-inline-sm"></i> ${c.artist && c.title ? "Ré-identifier" : "Identifier"} <span class="kbd sift-kbd-hint-id">I</span></button>` +
    `</span></div>` +
    `<div class="sift-meta-body">` +
    // Résultats Discogs — vide au repos, rempli le temps d'une recherche (doIdentify), au-dessus des
    // attributs pour que le choix d'une release précède l'édition. onIdentityApplied remplit ensuite
    // les inputs data-fil ci-dessous en place, sans re-render.
    `<div class="sift-cands sift-cands-host" hidden></div>` +
    // Liste d'attributs éditable en place : la valeur EST un input (data-fil écouté par `upd` à la
    // saisie et par onIdentityApplied au remplissage), stylé comme du texte tant qu'on ne le touche
    // pas. Labels persistants — annotation "on ne sait pas à quoi correspondent les champs".
    // Placeholder "—" quand vide, jamais une ligne vide.
    `<div class="sift-attr-list">` +
    `<div class="sift-attr"><span class="sift-attr-k">Artiste</span><input data-fil="artist" placeholder="—" value="${esc(c.artist)}" class="sift-attr-input" aria-label="Artiste"></div>` +
    `<div class="sift-attr"><span class="sift-attr-k">Titre</span><input data-fil="title" placeholder="—" value="${esc(c.title)}" class="sift-attr-input" aria-label="Titre"></div>` +
    `<div class="sift-attr"><span class="sift-attr-k">Version</span><input data-fil="version" placeholder="—" value="${esc(c.version ?? "")}" class="sift-attr-input" aria-label="Version"></div>` +
    // Label — fait de release Discogs, LECTURE SEULE : apply_tags reçoit un Canonical (artiste/titre/
    // version) et écrit le label depuis la métadonnée stockée, pas depuis une saisie ; l'éditer
    // demanderait d'élargir le contrat IPC (backend, hors #47). Mis à jour en place par
    // onIdentityApplied quand une release est choisie. "—" quand aucun label connu.
    `<div class="sift-attr"><span class="sift-attr-k">Label</span><span class="sift-attr-ro" data-fil="label-ro">${esc(state.label ?? "—")}</span></div>` +
    `</div>` +
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
    `<button data-fil="applytags" class="sift-applytags-btn" title="Applique les tags ID3 au fichier (ou Entrée après avoir édité un champ)"${c.artist && c.title ? "" : " hidden"}><i class="ti ti-tag sift-icon-inline-md"></i> Appliquer</button>` +
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
    `</div>`; // ferme .sift-meta-body

  const cdjBadge = host.querySelector<HTMLElement>("#sift-cdj-badge");
  // Vit sur le header statique, visible en lecture-seule comme en édition (jamais masqué, fork F).
  if (cdjBadge && report) paintCdjBadge(cdjBadge, report.tags_cdj_ok);

  // Métadonnées ne se replie plus (spec revue.md § Zone C) : rien à fermer quand Diagnostic s'ouvre,
  // donc l'accordéon exclusif est neutralisé côté Métadonnées (closeMetaZone reste null). Diagnostic
  // garde son propre repli, indépendant.
  closeMetaZone = null;

  const upd = () => {
    const a = host.querySelector<HTMLInputElement>('[data-fil="artist"]');
    const t = host.querySelector<HTMLInputElement>('[data-fil="title"]');
    const v = host.querySelector<HTMLInputElement>('[data-fil="version"]');
    if (!state.canonical) return;
    state.canonical.artist = a?.value ?? "";
    state.canonical.title = t?.value ?? "";
    state.canonical.version = v?.value.trim() ? v.value.trim() : null;
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
    const applyBtn = host.querySelector<HTMLButtonElement>('[data-fil="applytags"]');
    if (applyBtn && tagFieldDiffs().any) void doApplyTags(applyBtn);
    (e.currentTarget as HTMLInputElement).blur();
  };
  host
    .querySelectorAll<HTMLInputElement>('[data-fil="artist"],[data-fil="title"],[data-fil="version"]')
    .forEach((el) => {
      let focusVal = el.value;
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
          el.blur();
        }
      });
      el.addEventListener("blur", commitTitle);
    });

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

// Apply button — une seule action « Appliquer » (grave les tags ID3 en place). Plus de bascule inline
// vers « Annuler » (Antoine 2026-08-21) : l'apply est journalisé (tag_edit, actions.rs), donc l'undo
// vit dans Ctrl+Z (undoLast) et l'écran Journal — le bouton inline faisait doublon.
const APPLY_IDLE_HTML =
  '<i class="ti ti-tag sift-icon-inline-md"></i> Appliquer';

/** Put the Apply button in its idle "write" state. Left ENABLED here — refreshDiscrepancy() is
 *  what actually gates .disabled against tagFieldDiffs().any right after (called on every path
 *  that can call this: open, edit, apply), so this only sets the label + handler. */
function setApplyIdle(btn: HTMLButtonElement): void {
  btn.disabled = false;
  btn.style.color = "var(--color-text-secondary)";
  btn.innerHTML = APPLY_IDLE_HTML;
  btn.onclick = () => void doApplyTags(btn);
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
    await applyTags(trackId, edited);
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
    if (cdjBadgeAfterApply) paintCdjBadge(cdjBadgeAfterApply, cdjOk);
    // Plus de bascule "Annuler" (Antoine 2026-08-21) : l'apply est journalisé (tag_edit), donc l'undo
    // vit dans Ctrl+Z / l'écran Journal. Le bouton revient à l'idle ; refreshDiscrepancy ci-dessus l'a
    // déjà désactivé, puisqu'il n'y a plus de divergence.
    setApplyIdle(btn);
  } catch (e) {
    console.error("apply_tags failed", e);
    toast("Échec de l'écriture des tags", false);
    if (myseq === openState.openSeq) setApplyIdle(btn);
  }
}

