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
import { DRIVE_VANISHED, IDENTITY_MISMATCH } from "../shared/contracts";
import { esc } from "./dom";
import { formatDrive, type RemovableDrive, type TargetFs } from "./ipc";

const CONFIRM_REARM_MS = 400; // mirrors sift-live.ts's batch-confirm floor (see BATCH_CONFIRM_THRESHOLD)

export function openUsbFormatModal(drive: RemovableDrive): void {
  document.getElementById("sift-usbfmt-overlay")?.remove();

  let fs: TargetFs = "fat32";
  let typedOk = false;
  let armedAt: number | null = null;
  let busy = false;
  // Set by the formatDrive().catch() handler, read by render(). Must survive render() itself
  // (which does card.innerHTML = ... — a full replacement) since render() is called right after
  // the error is recorded, with no paint/await in between. Reset alongside armedAt wherever a
  // fresh attempt starts (filesystem switch, confirm-word retype) so a stale error message
  // doesn't linger into the next try.
  let lastError: string | null = null;
  // Posé quand le backend a refusé pour une raison qu'un nouvel essai ne peut pas lever : le
  // disque confirmé n'est plus celui-là. Désarme définitivement le bouton de confirmation — la
  // seule sortie est Annuler puis une liste fraîche.
  let fatal = false;

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
  // drive.label is a model name (e.g. "Kingston DataTraveler USB Device") — two identical drives
  // plugged in together would share the same confirm word otherwise (audit 2026-07-09). drive.id
  // (the drive letter/path) is what actually distinguishes them.
  const confirmWord = drive.label ? `${drive.label} (${drive.id})` : drive.id;

  function render() {
    card.innerHTML =
      '<div class="sift-usbfmt-title">Formater ' +
      esc(drive.id) +
      "</div>" +
      '<div class="sift-usbfmt-desc">' +
      esc(drive.label || "Disque amovible") +
      " · " +
      sizeGb +
      " Go · actuellement " +
      esc(drive.current_fs) +
      "</div>" +
      (lastError
        ? '<div class="sift-usbfmt-error">' + esc(lastError) + "</div>"
        : "") +
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
      '<label for="sift-usbfmt-typed">Tape <code>' +
      esc(confirmWord) +
      "</code> pour confirmer</label>" +
      '<input type="text" id="sift-usbfmt-typed" autocomplete="off" spellcheck="false">' +
      "</div>" +
      '<div class="sift-usbfmt-actions">' +
      '<button type="button" id="sift-usbfmt-cancel" class="sift-settings-btn">Annuler</button>' +
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn" disabled>' +
      (busy
        ? '<span class="sift-bt-spin" style="margin-right:6px;vertical-align:-2px"></span>Formatage en cours…'
        : armedAt
          ? "Confirmer — tout sera effacé"
          : "Formater") +
      "</button>" +
      (busy
        ? '<div class="sift-usbfmt-progress-note" style="margin-top:8px;font-size:var(--text-sm);color:var(--color-text-tertiary)">Ne débranche pas le disque — cela peut prendre plusieurs minutes.</div>'
        : "") +
      "</div>";

    card.querySelectorAll<HTMLElement>("[data-usbfmt-fs]").forEach((el) =>
      el.addEventListener("click", () => {
        // The typed confirm word depends only on the drive, not on fs — preserve it
        // across the render() below (card.innerHTML = ... wipes #sift-usbfmt-typed
        // otherwise, forcing a retype on a plain filesystem toggle).
        const typedBefore = card.querySelector<HTMLInputElement>("#sift-usbfmt-typed")?.value ?? "";
        fs = el.dataset.usbfmtFs as TargetFs;
        armedAt = null; // switching filesystem resets the confirm cycle
        // ... and clears any stale error from a previous failed attempt — SAUF une erreur fatale :
        // changer de système de fichiers ne rend pas au disque l'identité qu'il a perdue, et le
        // bouton reste désarmé. Effacer le message laisserait un bouton mort sans explication.
        if (!fatal) lastError = null;
        render();
        const typedAfter = card.querySelector<HTMLInputElement>("#sift-usbfmt-typed");
        if (typedAfter && typedBefore) {
          typedAfter.value = typedBefore;
          typedOk = typedBefore.trim() === confirmWord;
          const confirmBtnAfter = card.querySelector<HTMLButtonElement>("#sift-usbfmt-confirm");
          if (confirmBtnAfter) confirmBtnAfter.disabled = !typedOk || busy || fatal;
        }
      }),
    );

    const typed = card.querySelector<HTMLInputElement>("#sift-usbfmt-typed");
    const confirmBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-confirm");
    typed?.addEventListener("input", () => {
      typedOk = typed.value.trim() === confirmWord;
      if (confirmBtn) confirmBtn.disabled = !typedOk || busy || fatal;
      // Not re-rendered here (no render() call — only the disabled attribute is touched), but
      // clears the stale error for whenever the next render() does happen (e.g. re-arming).
      lastError = null;
    });

    const cancelBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-cancel");
    if (cancelBtn) cancelBtn.disabled = busy;
    cancelBtn?.addEventListener("click", () => {
      if (busy) return; // formatDrive() has no cancel path — a disabled button says so honestly
      close();
    });

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
          const raw = String(e);
          // Les deux sentinelles du garde anti-course passent EN PREMIER, et coupent le chemin de
          // reprise (`fatal`). Elles tombaient jusqu'ici dans le message générique, qui finit par
          // « réessaie » : inviter à relancer un formatage irréversible sur un disque que le
          // backend vient de déclarer différent de celui qui a été confirmé est le pire message
          // possible pour cette condition précise. La seule sortie sûre est de refermer et de
          // repartir d'une liste fraîche.
          fatal = raw.includes(IDENTITY_MISMATCH) || raw.includes(DRIVE_VANISHED);
          const humanized = raw.includes(IDENTITY_MISMATCH)
            ? "Ce n'est plus le même disque : un autre volume répond maintenant à " +
              esc(drive.id) +
              ". Rien n'a été formaté. Ferme cette fenêtre et resélectionne le disque dans la liste."
            : raw.includes(DRIVE_VANISHED)
              ? "Le disque a été débranché avant que le formatage ne commence. Rien n'a été " +
                "formaté. Rebranche-le et resélectionne-le dans la liste."
              : /access|denied|permission/i.test(raw)
                ? "Accès refusé — ferme tout programme utilisant ce disque et réessaie."
                : /not found|no such|introuvable/i.test(raw)
                  ? "Disque introuvable — a-t-il été débranché pendant le formatage ?"
                  : "Échec du formatage. Vérifie que le disque est bien branché et réessaie.";
          // render() below does card.innerHTML = ... (full replacement) — insertAdjacentHTML'ing
          // the error directly into the current DOM would just get wiped out immediately, with no
          // paint in between to make it visible. Store it and let render() include it.
          lastError = humanized;
          render();
        });
    });
  }

  render();
  // Move focus into the modal on open (role="alertdialog"/aria-modal already set).
  // Cancel is the safest target — never the destructive confirm button — so that a
  // stray Enter/Space right after open can only close the modal, not arm/format.
  card.querySelector<HTMLButtonElement>("#sift-usbfmt-cancel")?.focus();
}
