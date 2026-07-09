// Confirmation modal for M7 "Formater une clé USB". Never window.confirm()/alert()/prompt() —
// see CLAUDE.md: a real incident happened when window.confirm() failed to block a click in
// this Tauri/WebView2 setup. This modal is a genuine in-app overlay (reuses the
// .sift-report-overlay/.sift-report-overlay-card pattern already used for the track report),
// plus TWO extra layers of friction appropriate to an irreversible disk-format action:
//   1. A typed confirmation: the user must type the drive's id/label exactly before the final
//      button even enables (spec requirement — stricter than the batch "armed" pattern, which
//      only requires a second click).
//   2. A timestamped armed/confirmed cycle on the final button itself, same family as
//      BATCH_CONFIRM_THRESHOLD/batchConfirmArmed (sift-live.ts) — rejects a double-click/
//      duplicate event landing right after the button enables.
import { formatDrive, type RemovableDrive, type TargetFs } from "./ipc";

const CONFIRM_REARM_MS = 400; // mirrors sift-live.ts's batch-confirm floor (see BATCH_CONFIRM_THRESHOLD)

export function openUsbFormatModal(drive: RemovableDrive): void {
  document.getElementById("sift-usbfmt-overlay")?.remove();

  let fs: TargetFs = "fat32";
  let typedOk = false;
  let armedAt: number | null = null;
  let busy = false;

  const overlay = document.createElement("div");
  overlay.id = "sift-usbfmt-overlay";
  overlay.className = "sift-report-overlay";

  const card = document.createElement("div");
  card.className = "sift-report-overlay-card sift-usbfmt-card";
  // Audit-ref G2 (Clé USB, 2026-07-09, réf. shadcn Alert Dialog) : aucune sémantique modale avant
  // ce fix — plus critique que confirm-modal.ts (R5) puisque c'est la seule action vraiment
  // irréversible de toute l'app (formatage disque). Escape ferme sauf pendant le formatage (busy).
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", `Formater ${drive.id}`);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Single cleanup path (Escape / Cancel / format success) so the keydown listener never
  // outlives the overlay — each openUsbFormatModal() call would otherwise leak one.
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || busy) return; // ne pas laisser Escape interrompre un formatage lancé
    close();
  };
  document.addEventListener("keydown", onKeydown);
  function close(): void {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }

  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  const confirmWord = drive.label || drive.id;

  function render() {
    card.innerHTML =
      '<div class="sift-usbfmt-title">Formater ' +
      escapeHtml(drive.id) +
      "</div>" +
      '<div class="sift-usbfmt-desc">' +
      escapeHtml(drive.label || "Disque amovible") +
      " · " +
      sizeGb +
      " Go · actuellement " +
      escapeHtml(drive.current_fs) +
      "</div>" +
      '<div class="sift-usbfmt-warning">Cette action efface tout le contenu du disque, ' +
      "de façon irréversible. Vérifie que c'est bien la bonne clé avant de continuer.</div>" +
      // Audit-ref G2 : <span> → <button>, incohérent avec le reste de l'app.
      '<div class="sift-seg">' +
      '<button class="sift-seg-opt' +
      (fs === "fat32" ? " on" : "") +
      '" data-usbfmt-fs="fat32">FAT32 (recommandé)</button>' +
      '<button class="sift-seg-opt' +
      (fs === "ex_fat" ? " on" : "") +
      '" data-usbfmt-fs="ex_fat">exFAT</button>' +
      "</div>" +
      (fs === "ex_fat"
        ? '<div class="sift-usbfmt-exfat-warning">exFAT n\'est pas garanti compatible avec tous ' +
          "les CDJ/contrôleurs DJ. FAT32 reste le choix le plus sûr pour un usage club.</div>"
        : "") +
      '<div class="sift-usbfmt-typerow">' +
      "<label>Tape <code>" +
      escapeHtml(confirmWord) +
      "</code> pour confirmer</label>" +
      '<input type="text" id="sift-usbfmt-typed" autocomplete="off" spellcheck="false">' +
      "</div>" +
      '<div class="sift-usbfmt-actions">' +
      '<button type="button" id="sift-usbfmt-cancel" class="sift-settings-btn">Annuler</button>' +
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn" disabled>' +
      (armedAt ? "Confirmer — tout sera effacé" : "Formater") +
      "</button>" +
      "</div>";

    card.querySelectorAll<HTMLElement>("[data-usbfmt-fs]").forEach((el) =>
      el.addEventListener("click", () => {
        fs = el.dataset.usbfmtFs as TargetFs;
        armedAt = null; // switching filesystem resets the confirm cycle
        render();
      }),
    );

    const typed = card.querySelector<HTMLInputElement>("#sift-usbfmt-typed");
    const confirmBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-confirm");
    typed?.addEventListener("input", () => {
      typedOk = typed.value.trim() === confirmWord;
      if (confirmBtn) confirmBtn.disabled = !typedOk || busy;
    });

    card.querySelector("#sift-usbfmt-cancel")?.addEventListener("click", () => close());

    confirmBtn?.addEventListener("click", () => {
      if (!typedOk || busy) return;
      if (!armedAt || Date.now() - armedAt < CONFIRM_REARM_MS) {
        // First click (or a suspiciously-fast repeat of a stale one): arm, don't format yet.
        armedAt = Date.now();
        render();
        return;
      }
      busy = true;
      render();
      void formatDrive(drive.id, drive.volume_serial, fs)
        .then(() => {
          close();
          window.dispatchEvent(new CustomEvent("sift:usb-format-done", { detail: { ok: true } }));
        })
        .catch((e: unknown) => {
          busy = false;
          armedAt = null;
          console.error("formatDrive failed", e);
          const desc = card.querySelector(".sift-usbfmt-desc");
          if (desc) {
            desc.insertAdjacentHTML(
              "afterend",
              '<div class="sift-usbfmt-error">Échec du formatage : ' +
                escapeHtml(String(e)) +
                "</div>",
            );
          }
        });
    });
  }

  render();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
