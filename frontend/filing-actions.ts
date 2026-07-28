import { fileTrack, listQueue, rejectTrack, requeueTrack, revertBatch } from "./ipc";
import type { QueueItem, TrackFileOutcome } from "../shared/contracts";
import { FILE_IN_PLACE } from "../shared/contracts";
import { esc } from "./dom";
import { confirmAction } from "./confirm-modal";
import { fileInPlaceChecked, getBinRel, binLabel } from "./filing-bins";
import {
  state,
  openState,
  ensureFilingWatcher,
  markFilingStarted,
  isFilingInFlight,
  filingFailure,
  onFilingOutcome,
  type InFlightFiling,
} from "./filing-state";
import { toast } from "./filing-toast";

/** Banner label when a track was filed in place (its own source folder, not a tree bin). */
const IN_PLACE_BIN_LABEL = "source folder";

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

/** Ranger the current track into the selected bin.
 *
 *  ASYNCHRONOUS since P5 (PRD 2026-07-27, D3/D5): `fileTrack` no longer resolves when the file is
 *  converted, it resolves when the conversion has been PLANNED and started — destination path and
 *  journal batch id settled, ffmpeg still running. So the click gives the rail back immediately and
 *  the pane advances to the next track while the previous one converts. The refusals that must be
 *  answered before anything starts (RAIL_MISMATCH's confirmation, NoLibraryRoot, upscale) still
 *  come back from this very call, so the retry loop below is unchanged. What lands later — success
 *  or failure — arrives on `file:track:done` and is handled by `settleFilingBanner`. */
export async function doRanger(
  mid: HTMLElement,
  openNext: (mid: HTMLElement, item: QueueItem) => Promise<void>,
  clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void,
): Promise<void> {
  if (!state.track || !state.canonical || openState.acting) return;
  const track = state.track;
  const canonical = state.canonical;
  const inPlace = fileInPlaceChecked();
  const dest = inPlace ? FILE_IN_PLACE : getBinRel();
  if (dest === null) {
    toast("Choisis un dossier de destination.", false);
    return;
  }
  const ranger = document.querySelector<HTMLElement>('[data-fil="ranger"]');
  const orig = ranger?.innerHTML ?? null;
  // Subscribe before launching anything, and AWAIT the subscription: the outcome event must have a
  // live listener by the time the backend can emit it (a very short conversion can settle almost
  // immediately, and `listen()` is an invoke with no ordering guarantee against `file_track`).
  await ensureFilingWatcher();
  openState.acting = true;
  setActionsDisabled(true);
  if (ranger)
    ranger.innerHTML =
      '<i class="ti ti-loader-2 sift-spin sift-icon-inline-md"></i> Conversion en cours…';
  let allowRailMismatch = false;
  try {
    for (;;) {
      try {
        const res = await fileTrack(track.id, dest, state.target, canonical, allowRailMismatch);
        const filedPath = res.path;
        const batchId = res.batch_id;
        const bin = inPlace ? IN_PLACE_BIN_LABEL : binLabel();
        // The conversion is now running behind us. Registering it here is what takes the track out
        // of the loop: it is still `pending` in the DB, so listQueue below (and every later render)
        // would otherwise hand it straight back and let it be converted a second time.
        markFilingStarted(track.id, {
          batchId,
          path: filedPath,
          bin,
          name: filedPath.split(/[\\/]/).pop() || filedPath,
        });
        let items: QueueItem[] = [];
        try {
          items = (await listQueue()).filter((it) => !isFilingInFlight(it.id));
        } catch (err) {
          console.error("listQueue failed after filing", err);
        }
        if (items.length) await openNext(mid, items[0]);
        else clearPane(mid, true);
        showFiledConfirm(track.id, batchId, bin, filedPath);
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
    // The backend refuses a second filing of a track whose conversion is still running (P5). The
    // front normally hides such a track from the queue, so reaching this means it came back through
    // a path that doesn't go through the queue rail — say the gone-file recovery chain in filing.ts.
    else if (msg.includes("ALREADY_FILING"))
      toast("Ce morceau est déjà en cours de conversion.", false);
    else if (msg.toLowerCase().includes("upscale")) toast("Refusé : pas de surqualité lossy → lossless.", false);
    else if (/permission|access|denied/i.test(msg)) toast("Refusé : accès au fichier/dossier refusé.", false);
    else if (/no such file|not found|introuvable/i.test(msg)) toast("Fichier introuvable — a-t-il été déplacé ?", false);
    else toast("Une erreur est survenue pendant la conversion. Réessaie.", false);
    console.error("file_track failed", e);
    setActionsDisabled(false);
    if (ranger && orig != null) ranger.innerHTML = orig;
  } finally {
    openState.acting = false;
  }
}

/** Show the filing confirmation as a BANNER at the TOP of the right rail (#filfoot), above the
 *  next track's controls — the center has already auto-advanced to the next pending track (doRanger).
 *  This is the "after" proof for the file just filed: name + destination path + a targeted Revert.
 *  ONE banner at a time (replaces any prior). Revert is targeted on this file's `batchId`
 *  (revert_batch), available indefinitely via the journal; the ✕ dismisses the banner without
 *  reverting. Does NOT touch #mid or state.track — the advance owns those.
 *
 *  P5: it now opens in the "conversion en cours" state, because at this point nothing is converted
 *  yet — claiming "Converti" here would be a lie for as long as ffmpeg runs, and Annuler would
 *  target a journal batch that does not exist yet. `settleFilingBanner` flips it to Converti (and
 *  reveals Annuler) or to Échec when the backend reports. `data-batch-id` is how a late outcome
 *  recognises whether the banner still on screen is its own — a second conversion replaces it. */
function showFiledConfirm(
  trackId: number,
  batchId: string,
  bin: string,
  filedPath: string,
): void {
  state.filedConfirm = { batchId, bin };
  const foot = document.getElementById("filfoot");
  if (!foot) return;
  const filename = filedPath.split(/[\\/]/).pop() || filedPath;
  foot.querySelector(".sift-filed-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "sift-filed-banner";
  banner.dataset.batchId = batchId;
  banner.dataset.trackId = String(trackId);
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  // Audit-ref (a11y, 2026-07-24): insert the (empty) live region into the document FIRST, then
  // populate it — a screen reader's mutation watcher only starts tracking a live region once it's
  // in the DOM; a node that arrives already fully populated in one mutation is inconsistently (or
  // never) announced by some ATs. filing-toast.ts's toast() has the same fill-then-append order —
  // left alone here since it's a separate, pre-existing site and not one of the confirmed findings.
  foot.prepend(banner);
  banner.innerHTML =
    `<div class="sift-filed-banner-head">` +
    `<i class="ti ti-loader-2 sift-spin" data-fil="filed-icon"></i>` +
    `<span class="sift-filed-banner-label" data-fil="filed-label">Conversion en cours…</span>` +
    `<span class="sift-filed-banner-bin">→ ${esc(bin)}</span>` +
    `<button data-fil="filed-close" title="Fermer" aria-label="Fermer" class="sift-filed-banner-close"><i class="ti ti-x"></i></button>` +
    `</div>` +
    `<div class="sift-filed-banner-name">${esc(filename)}</div>` +
    `<div class="sift-filed-banner-path">${esc(filedPath)}</div>` +
    // Hidden until the conversion actually commits: reverting a batch the journal doesn't hold yet
    // could only fail. Revealed by paintFiledBanner on success. Hidden by an INLINE display, not by
    // the `hidden` attribute: `.sift-filed-banner-revert` declares `display:inline-flex`, which
    // beats the UA stylesheet's `[hidden]{display:none}` and would leave the button visible.
    `<button data-fil="revert" class="sift-filed-banner-revert" style="display:none" hidden><i class="ti ti-arrow-back-up"></i> Annuler</button>`;
  banner.querySelector('[data-fil="revert"]')?.addEventListener("click", () => void doRevert(batchId));
  banner.querySelector('[data-fil="filed-close"]')?.addEventListener("click", () => {
    banner.remove();
    state.filedConfirm = null;
  });
  // The banner is only built AFTER the pane has advanced (openNext awaits several IPC round trips),
  // and a conformant file is merely tagged and moved — the conversion can therefore be over BEFORE
  // this node exists, in which case the outcome event found nothing to update. Paint the settled
  // state now rather than leave a spinner that would never stop. Painting the `running` case too
  // (rather than only the settled ones) is what strips the class's success-green tint off a banner
  // that announces work still in progress — the markup alone cannot do it.
  paintFiledBanner(
    banner,
    isFilingInFlight(trackId) ? "running" : filingFailure(trackId) ? "failed" : "done",
  );
}

/** The three visible states of the filing banner. `running` is the markup's own initial state. */
type FiledBannerState = "running" | "done" | "failed";

/** Move the banner between states by MUTATING the three nodes that change (icon, label, Annuler)
 *  rather than rewriting it — same discipline as the rest of the live UI, and it keeps the ✕
 *  handler alive. Annuler is only ever exposed in `done`: before that the journal holds no batch to
 *  revert, and after a failure there is nothing to undo. */
function paintFiledBanner(banner: HTMLElement, s: FiledBannerState): void {
  const failed = s === "failed";
  const running = s === "running";
  // `.sift-filed-banner` is green by class (a filing used to only ever be shown once it had
  // succeeded), so BOTH other states have to re-tint: a failure to the warning tokens, and
  // `running` to the neutral secondary surface — announcing success in green while ffmpeg is still
  // encoding is exactly the lie P5 introduced. Inline, since these are states of an existing
  // component, not a new one (no new CSS rule).
  banner.style.background = failed
    ? "var(--color-background-warning)"
    : running
      ? "var(--color-background-secondary)"
      : "";
  const neutral = failed ? "var(--color-text-warning)" : running ? "var(--color-text-tertiary)" : "";
  const icon = banner.querySelector<HTMLElement>('[data-fil="filed-icon"]');
  if (icon) {
    icon.className = running
      ? "ti ti-loader-2 sift-spin"
      : s === "done"
        ? "ti ti-check"
        : "ti ti-alert-triangle";
    icon.style.color = neutral;
  }
  const label = banner.querySelector<HTMLElement>('[data-fil="filed-label"]');
  if (label) {
    label.textContent = running
      ? "Conversion en cours…"
      : s === "done"
        ? "Converti"
        : "Conversion échouée";
    label.style.color = neutral;
  }
  const revert = banner.querySelector<HTMLElement>('[data-fil="revert"]');
  if (revert) {
    const shown = s === "done";
    revert.style.display = shown ? "" : "none";
    if (shown) revert.removeAttribute("hidden");
    else revert.setAttribute("hidden", "");
  }
}

/** Settle the on-screen banner when a background conversion reports (P5).
 *
 *  Only touches the banner when it is still THIS filing's (a second conversion has replaced it
 *  otherwise, and navigating away has removed it entirely). The toast is deliberately not the
 *  carrier of the information either: the durable signal is the queue-row marker driven by
 *  filing-state (D5 — the user is already elsewhere when a late failure lands). */
function settleFilingBanner(o: TrackFileOutcome, started: InFlightFiling | null): void {
  const banner = document
    .getElementById("filfoot")
    ?.querySelector<HTMLElement>(".sift-filed-banner");
  const mine = banner && banner.dataset.batchId === o.batch_id ? banner : null;
  if (o.error) {
    console.error("file_track background conversion failed", o.track_id, o.error);
    if (mine) {
      paintFiledBanner(mine, "failed");
      state.filedConfirm = null;
    }
    const name = started?.name ?? `#${o.track_id}`;
    toast(`Conversion échouée — ${name} est revenu dans la file`, false);
    return;
  }
  if (mine) paintFiledBanner(mine, "done");
}

// Registered at module load (pure bookkeeping — the Tauri subscription itself is installed lazily
// by ensureFilingWatcher, from doRanger). One registration for the whole session: the banner it
// updates is looked up at event time, never captured.
onFilingOutcome(settleFilingBanner);

/** Revert THIS file's filing, targeted on its `batchId` (revert_batch). On success the engine
 *  puts the track back to pending and emits queue:changed → the queue refreshes. On a Blocked
 *  engine error (e.g. the original was purged from the trash) show a clear message rather than
 *  failing mutely. The revert engine itself is untouched here. */
async function doRevert(batchId: string): Promise<void> {
  try {
    await revertBatch(batchId);
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

/** Re-sourcer (fake) ou Écarter (non-fake) the current track — both are the same reversible
 *  reject_track path now (annotation: "jeter devrait etre écarté, et finir dans écarter"); `kind`
 *  stays two-valued only to pick the right toast wording, not a different backend action anymore. */
export async function doSecondary(
  mid: HTMLElement,
  kind: "resource" | "trash",
  clearPane: (mid: HTMLElement, emptyQueue?: boolean) => void,
): Promise<void> {
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
