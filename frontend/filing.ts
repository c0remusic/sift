// Live Revue filing controller (Tauri only). Augments the mockup's Revue shell: renders the
// son-first analysis detail into the #mid pane, and the validation rail into the right .dest
// column — destination tree into #fldz (with a NoLibraryRoot picker gate) and the filing footer
// (editable canonical fields, format override, Identify, File / Re-source / Discard) into
// #filfoot below it. Drives the M4 backend via the IPC bindings; the plain-browser demo never
// loads this (see main.ts guard).
import {
  reconcile,
  undoLast,
  findDuplicate,
  trackRelease,
  trackFileTags,
  listQueue,
} from "./ipc";
import type { DupMatch, TrackRelease, FileTags } from "../shared/contracts";
import {
  openReportInto,
  togglePlay,
  vchipHtml,
  keyboardHintsHtml,
} from "./report-view";
import type { Canonical, Target, QueueItem } from "../shared/contracts";
import { requireEl, esc } from "./dom";
import { emptyStateHtml } from "./empty-state";
import {
  hasDestination,
  binLabel,
  registerOpenTrackPathGetter,
  registerDestChangeHook,
  repositionDestPopoverIfOpen,
  toggleDestPopover,
  ensureDestPopoverAutoClose,
} from "./filing-bins";
import { state, openState, isFilingInFlight } from "./filing-state";
import { toast, registerClearPaneHook } from "./filing-toast";
import {
  TARGET_LABEL,
  titleCase,
  defaultTarget,
  updateHeaderName,
  refreshPreview,
} from "./filing-preview";
import {
  renderEditor,
  restoreIdentifiedLine,
  renderGenres,
  refreshDiscrepancy,
  releaseCache,
  resetIdentEditing,
} from "./filing-identify";
import { doRanger, doSecondary } from "./filing-actions";

export { TARGET_LABEL } from "./filing-preview";


/** Shared, mutable Revue state for the current filing session. Destination-selection state
 *  (library root, bin list, selected bin, "sur place" flag) moved to filing-bins.ts's own
 *  DestState (tech-debt audit F03 — god-file split, first tranche). */

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
    ?.addEventListener("click", () => void doRanger(mid, openFilingInto, clearPane));
  foot
    .querySelector('[data-fil="resource"]')
    ?.addEventListener("click", () => void doSecondary(mid, "resource", clearPane));
  foot
    .querySelector('[data-fil="trash"]')
    ?.addEventListener("click", () => void doSecondary(mid, "trash", clearPane));
  repositionDestPopoverIfOpen(); // the destbtn above was just rebuilt — keep an open popover glued to it
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

/** Render the analysis report + filing footer for `item` into the #mid pane. `openState.openSeq`
 *  is bumped on every open; an in-flight open bails at its await points if a newer one started
 *  (prevents a slow analyze/reconcile from clobbering the pane of a track opened since) — see
 *  filing-state.ts for the full rationale. */
export async function openFilingInto(
  mid: HTMLElement,
  item: QueueItem,
  // Ids already auto-advanced through in the current gone-file chain. Bounds the recovery below:
  // if the backend can't drop a gone row (forget_path a no-op — e.g. a Windows path-case mismatch),
  // two gone tracks would otherwise ping-pong openFilingInto forever, each hop a full IPC round.
  // A user-initiated open starts a fresh (empty) chain; only the recursive auto-advance grows it.
  goneVisited: Set<number> = new Set(),
): Promise<void> {
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
  resetIdentEditing(); // Identification card always opens in read-only display mode

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
  // Set only on the specific "file no longer exists on disk" message (decode.rs's open_format,
  // the one path that already produces this exact French text) — a broader readError (permission
  // glitch, corrupt file, DB hiccup) is left for the user to see and retry, not auto-dismissed.
  // Known gap (found in review, not fixed here — narrower than this bug's actual report):
  // openReportInto short-circuits on a cache hit (report-view.ts's reportCache) and never calls
  // analyzePath again, so onAnalysisError won't fire if a track analyzed successfully earlier in
  // this session has its file removed AFTER that — the cache still holds the old-but-now-stale
  // report. Out of scope here: this bug's report was a live analysis failure (not a cache hit);
  // covering the cache-staleness case needs its own file-existence check, a separate fix.
  let fileGone = false;
  const [report, canonical, release, fileTags] = await Promise.all([
    openReportInto(reportEl, item.path, verdictEl, {
      deferText: true,
      onAnalysisError: (msg) => {
        if (msg.includes("n'existe plus")) fileGone = true;
      },
    }),
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
  if (fileGone) {
    // The file is confirmed gone from disk, so nothing in this pane is actionable (can't play,
    // can't file, can't retry). CORRECTION (caught in review): `analyze_path` itself does NOT
    // remove the row from `pending` — only the live watcher's delete handler (watcher.rs) or a
    // manual rescan (scanner.rs forget_path) does, and neither is guaranteed to have run yet by
    // the time this analysis failure surfaces (unwatched source, or the watcher event just hasn't
    // been processed). So `item` itself can legitimately still be the first (or only) row
    // `listQueue()` returns — reopening it blindly would re-run this exact same failure forever.
    let items: QueueItem[] = [];
    let listQueueFailed = false;
    try {
      // Same filter as the queue rail's own delivery point (queue-panel.ts) and as doRanger's
      // auto-advance: a track whose conversion is still running in the background is still
      // `pending`, so list_queue keeps returning it — opening it here would land the user on a
      // track the backend refuses to file again (ALREADY_FILING).
      items = (await listQueue()).filter((it) => !isFilingInFlight(it.id));
    } catch (err) {
      console.error("listQueue failed after detecting a gone file", err);
      listQueueFailed = true;
    }
    if (myseq !== openState.openSeq) return; // a newer open started while we awaited listQueue
    goneVisited.add(item.id);
    // Only advance to a row we haven't already bounced through in this gone-chain (recursion bound,
    // see the param doc). A recreated file whose row the backend deliberately KEPT stays listed, so
    // "this same track is still here" is NOT proof the queue is empty.
    const next = items.find((i) => i.id !== item.id && !goneVisited.has(i.id));
    if (next) {
      void openFilingInto(mid, next, goneVisited);
    } else if (listQueueFailed) {
      // Real queue state is unknown (IPC/DB error) — don't assert "nothing to review" (fail-fast:
      // never guess a fact we couldn't verify). Surface it AND leave a neutral prompt, not the
      // formal empty state and not a silent swallow.
      toast("La file n'a pas pu être relue — réessaie.", false);
      clearPane(mid);
    } else if (items.length === 0) {
      // The queue really is empty — the only case that warrants the formal "Rien à revoir".
      clearPane(mid, true);
    } else {
      // Rows remain but they're this same still-listed track (backend kept it — file recreated
      // between analyze()'s NotFound and its exists() re-check) or ones already visited. Don't
      // assert "nothing to review" over a visibly non-empty rail (review-caught contradiction).
      clearPane(mid);
    }
    return;
  }

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
    // Audit-ref (Lot, 2026-07-24): state.track can still hold the last-opened Detail track after
    // switching to Lot mode (setReviewMode's "batch" branch never clears it, sift-live.ts) — this
    // handler would otherwise fire ALONGSIDE installNavKeyboard's click-dispatch (chrome.ts) on a
    // focused batchpick/batchpickfake row's Space press: double-trigger (toggles selection AND
    // playback) plus a lost focus via blurShortcutFocus() below that breaks Tab navigation. Bail
    // out here and let installNavKeyboard own Space/Enter for these rows exclusively — mirrors
    // why mdbpick never had this bug: it lives on Rekordbox, a screen state.track is never set on.
    if (t?.closest('[data-sift="batchpick"],[data-sift="batchpickfake"]')) return;
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
