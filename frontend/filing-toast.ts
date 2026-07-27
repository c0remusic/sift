import { undoLast } from "./ipc";
import { esc } from "./dom";

let clearPaneHook: ((mid: HTMLElement) => void) | null = null;

/** Registered once by filing.ts at module load (mirrors filing-bins.ts's
 *  registerOpenTrackPathGetter/registerDestChangeHook) — lets toast()'s default (LIFO) undo
 *  fallback clear the detail pane without this module importing filing.ts back (would be a
 *  static import cycle: filing.ts needs toast() too). */
export function registerClearPaneHook(hook: (mid: HTMLElement) => void): void {
  clearPaneHook = hook;
}

let toastTimer: number | undefined;

/** A transient toast at the bottom-right with an optional "Undo" action. With `onUndo` the Undo
 *  button runs that callback (e.g. a targeted revert of a specific batch); without it, Undo falls
 *  back to `undoLast` (the LIFO most-recent action), clears the detail pane, and reports the
 *  outcome (done / nothing to undo / failed) in a follow-up toast. `undo` defaults to
 *  false: callers that only need a plain message call `toast("…")`.
 *  A single toast exists at a time, by construction: when OUR `#sift-toast` is already on screen its
 *  content is MUTATED and the dismiss timer restarted, instead of removing then recreating the
 *  node. */
export function toast(message: string, undo = false, onUndo?: () => void): void {
  // Only reuse the node THIS module created: library-detail.ts:33 builds the same #sift-toast
  // with its own 6s timer (library-detail.ts:50) whose id is never stored, so it cannot be
  // cleared from here — it would remove a node we reused, at ITS deadline. A foreign node is
  // destroyed instead, as before.
  const prior = document.getElementById("sift-toast");
  const existing = prior?.dataset.owner === "filing-toast" ? prior : null;
  if (prior && !existing) prior.remove();
  const el = existing ?? document.createElement("div");
  if (!existing) {
    el.id = "sift-toast";
    el.className = "sift-toast";
    el.dataset.owner = "filing-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
  }
  el.innerHTML =
    `<span>${esc(message)}</span>` +
    (undo
      ? '<button data-fil="undo" class="sift-toast-undo">Annuler</button>'
      : "");
  if (!existing) document.body.appendChild(el);
  el.querySelector('[data-fil="undo"]')?.addEventListener("click", () => {
    el.remove();
    if (onUndo) {
      onUndo(); // targeted revert (e.g. revertBatch of THIS tag_edit) — pane stays as-is
      return;
    }
    void undoLast()
      .then((batchId) => {
        // the just-filed track is back in the queue — clear the stale detail pane
        const mid = document.getElementById("mid");
        if (mid) clearPaneHook?.(mid);
        // Visible outcome, same wording as doRevert (filing-actions.ts). Re-entering toast() from
        // toast()'s own handler is safe: this runs AFTER the promise settles, the follow-up toast
        // is built with `undo=false` (no button → no new handler → no recursion), and it never
        // writes to `el` — that node was detached above, and toast() re-reads #sift-toast from the
        // document, so it just creates a fresh one (or mutates whatever toast is on screen by then).
        // `undoLast` resolves null when the journal had nothing live to revert: say so rather than
        // claim an undo that did not happen.
        toast(batchId ? "Annulé — retour dans la file" : "Rien à annuler.", false);
      })
      .catch((e) => {
        const msg = String(e);
        if (msg.includes("source gone")) {
          toast(
            "Annulation impossible : un fichier nécessaire a disparu — l'original a peut-être été purgé de la corbeille.",
            false,
          );
        } else {
          toast(`Échec de l'annulation : ${msg}`, false);
        }
        console.error("undo failed", e);
      });
  });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 6000);
}
