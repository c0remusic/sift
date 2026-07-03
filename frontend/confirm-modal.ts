// Generic in-app confirmation overlay — replaces window.confirm() everywhere in Sift. See
// CLAUDE.md: a real incident happened when a synthetic click ran straight through window.confirm()
// in this Tauri/WebView2 setup with no dialog ever appearing, filing 265 tracks by accident. A
// real DOM button, like every other control in this app, doesn't have that blocking-OS-dialog
// bypass — the returned promise only resolves on an actual click landing inside the webview.
// Lighter than usb-format-modal.ts's typed+armed cycle: that extra friction is reserved for the
// one truly irreversible action (disk format) — everything else stays at today's single-confirm
// friction level, just delivered reliably.
const OVERLAY_ID = "sift-confirm-overlay";

export function confirmAction(message: string, confirmLabel = "Confirmer"): Promise<boolean> {
  document.getElementById(OVERLAY_ID)?.remove();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "sift-report-overlay";

    const card = document.createElement("div");
    card.className = "sift-report-overlay-card sift-confirm-card";

    const msg = document.createElement("div");
    msg.className = "sift-confirm-msg";
    msg.textContent = message;

    const actions = document.createElement("div");
    actions.className = "sift-confirm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sift-settings-btn";
    cancelBtn.textContent = "Annuler";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "sift-confirm-btn";
    confirmBtn.textContent = confirmLabel;
    actions.append(cancelBtn, confirmBtn);

    card.append(msg, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}
