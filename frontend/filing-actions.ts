import { fileTrack, listQueue, rejectTrack, requeueTrack, revertBatch } from "./ipc";
import type { QueueItem } from "../shared/contracts";
import { FILE_IN_PLACE } from "../shared/contracts";
import { esc } from "./dom";
import { confirmAction } from "./confirm-modal";
import { fileInPlaceChecked, getBinRel, binLabel } from "./filing-bins";
import { state, openState } from "./filing-state";
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

/** Ranger the current track into the selected bin. */
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
        let items: QueueItem[] = [];
        try {
          items = await listQueue();
        } catch (err) {
          console.error("listQueue failed after filing", err);
        }
        if (items.length) await openNext(mid, items[0]);
        else clearPane(mid, true);
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
    else toast("Une erreur est survenue pendant la conversion. Réessaie.", false);
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
  if (!foot) return;
  const filename = filedPath.split(/[\\/]/).pop() || filedPath;
  foot.querySelector(".sift-filed-banner")?.remove();
  const banner = document.createElement("div");
  banner.className = "sift-filed-banner";
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
    `<i class="ti ti-check"></i>` +
    `<span class="sift-filed-banner-label">Converti</span>` +
    `<span class="sift-filed-banner-bin">→ ${esc(bin)}</span>` +
    `<button data-fil="filed-close" title="Fermer" aria-label="Fermer" class="sift-filed-banner-close"><i class="ti ti-x"></i></button>` +
    `</div>` +
    `<div class="sift-filed-banner-name">${esc(filename)}</div>` +
    `<div class="sift-filed-banner-path">${esc(filedPath)}</div>` +
    `<button data-fil="revert" class="sift-filed-banner-revert"><i class="ti ti-arrow-back-up"></i> Annuler</button>`;
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
