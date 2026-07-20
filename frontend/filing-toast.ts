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

/** A transient toast at the bottom-right with an optional "Undo" action. With `onUndo` the Undo
 *  button runs that callback (e.g. a targeted revert of a specific batch); without it, Undo falls
 *  back to `undoLast` (the LIFO most-recent action) and clears the detail pane. */
export function toast(message: string, undo: boolean, onUndo?: () => void): void {
  document.getElementById("sift-toast")?.remove();
  const el = document.createElement("div");
  el.id = "sift-toast";
  el.className = "sift-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML =
    `<span>${esc(message)}</span>` +
    (undo
      ? '<button data-fil="undo" class="sift-toast-undo">Annuler</button>'
      : "");
  document.body.appendChild(el);
  el.querySelector('[data-fil="undo"]')?.addEventListener("click", () => {
    el.remove();
    if (onUndo) {
      onUndo(); // targeted revert (e.g. revertBatch of THIS tag_edit) — pane stays as-is
      return;
    }
    void undoLast()
      .then(() => {
        // the just-filed track is back in the queue — clear the stale detail pane
        const mid = document.getElementById("mid");
        if (mid) clearPaneHook?.(mid);
      })
      .catch((e) => console.error("undo failed", e));
  });
  setTimeout(() => el.remove(), 6000);
}
