// Confirmation modal for M7 "Formater une clé USB". Never window.confirm()/alert()/prompt() —
// see CLAUDE.md: a real incident happened when window.confirm() failed to block a click in
// this Tauri/WebView2 setup. This modal is a genuine in-app overlay (reuses the
// .sift-report-overlay/.sift-report-overlay-card pattern already used for the track report),
// plus TWO extra layers of friction appropriate to an irreversible disk-format action:
// La confirmation se fait par un cycle armé/confirmé horodaté sur le bouton final, même famille
// que BATCH_CONFIRM_THRESHOLD/batchConfirmArmed (sift-live.ts) : le premier clic arme, le second
// exécute, et un doublon d'événement arrivant dans la foulée est rejeté.
//
// Il y avait EN PLUS un mot à retaper à l'identique. Retiré le 2026-08-01 : « SSK SSD Portable SSD
// (I:) » est increcopiable, et le bouton restait grisé sans que rien ne dise pourquoi — on se
// croyait bloqué par l'application. CLAUDE.md exige une confirmation in-app armée et horodatée,
// pas une dictée ; c'est ce qui reste.
import { DRIVE_VANISHED, ELEVATION_DECLINED, IDENTITY_MISMATCH } from "../shared/contracts";
import { esc } from "./dom";
import { formatDrive, formatStep, type RemovableDrive, type TargetFs } from "./ipc";
import { driveDisplayName } from "./usb-row";
import { T } from "./i18n/usb-format-modal";

const CONFIRM_REARM_MS = 400; // mirrors sift-live.ts's batch-confirm floor (see BATCH_CONFIRM_THRESHOLD)

/** Plafond que WINDOWS impose à la création d'un FAT32. Sift ne le subit plus — il écrit les
 * structures lui-même (`usb_format::fat32`) — mais l'opération demande alors une élévation, et
 * l'utilisateur doit savoir pourquoi une invite va surgir. Miroir de
 * `fat32::WINDOWS_FAT32_CREATE_CEILING`. */
const WINDOWS_FAT32_CEILING = 32 * 1024 ** 3;


export function openUsbFormatModal(drive: RemovableDrive): void {
  document.getElementById("sift-usbfmt-overlay")?.remove();

  let fs: TargetFs = "fat32";
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
  // Nom du volume, prérempli avec celui de la clé : reformater en gardant son nom est le cas
  // courant. Le backend l'assainit de toute façon (11 octets, majuscules) — ce champ ne fait que
  // proposer, il ne décide pas de ce qui sera écrit.
  let volumeName = drive.volume_name || "SIFT";
  // Étape réelle remontée par le processus élevé. Pas une animation : le travail se fait dans un
  // autre processus, et « on ne sait pas ce qui se passe » était le reproche exact.
  let step = "";
  let stepTimer: number | null = null;

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
  const displayName = driveDisplayName(drive);
  card.setAttribute("aria-label", T().titre(displayName));
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
    if (stepTimer !== null) window.clearInterval(stepTimer);
    stepTimer = null;
    overlay.remove();
  }

  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  /** Vrai quand ce formatage passera par l'écriture FAT32 de Sift plutôt que par `diskpart` —
   * donc quand une invite d'élévation Windows va surgir. Ce n'est PAS un blocage : c'est le cas
   * d'usage principal d'une clé DJ moderne, et le seul que Windows ne sait pas traiter. */
  const needsElevation = () => fs === "fat32" && drive.size_bytes > WINDOWS_FAT32_CEILING;

  function render() {
    const t = T();
    card.innerHTML =
      '<div class="sift-usbfmt-title">' +
      t.titre(esc(displayName)) +
      "</div>" +
      '<div class="sift-usbfmt-desc">' +
      esc(drive.label || t.disqueAmovible) +
      " · " +
      t.tailleEtFormat(sizeGb, esc(drive.current_fs)) +
      "</div>" +
      (lastError
        ? '<div class="sift-usbfmt-error">' + esc(lastError) + "</div>"
        : "") +
      '<div class="sift-usbfmt-warning">' +
      t.avertissement +
      "</div>" +
      // Audit-ref G2 : <span> → <button>, incohérent avec le reste de l'app.
      '<div class="sift-seg">' +
      '<button class="sift-seg-opt' +
      (fs === "fat32" ? " on" : "") +
      '" data-usbfmt-fs="fat32">' +
      t.fat32Recommande +
      "</button>" +
      '<button class="sift-seg-opt' +
      (fs === "ex_fat" ? " on" : "") +
      '" data-usbfmt-fs="ex_fat">exFAT</button>' +
      "</div>" +
      (fs === "ex_fat"
        ? '<div class="sift-usbfmt-exfat-warning">' + t.avertissementExfat + "</div>"
        : "") +
      (needsElevation()
        ? '<div class="sift-usbfmt-exfat-warning">' + t.avertissementElevation + "</div>"
        : "") +
      '<div class="sift-usbfmt-namerow">' +
      '<label for="sift-usbfmt-name">' +
      t.nomVolume +
      "</label>" +
      '<input type="text" id="sift-usbfmt-name" maxlength="11" autocomplete="off" ' +
      'spellcheck="false" value="' +
      esc(volumeName) +
      '"></div>' +

      '<div class="sift-usbfmt-actions">' +
      '<button type="button" id="sift-usbfmt-cancel" class="sift-settings-btn">' +
      t.annuler +
      "</button>" +
      '<button type="button" id="sift-usbfmt-confirm" class="sift-usbfmt-confirm-btn"' +
      (busy || fatal ? " disabled" : "") +
      ">" +
      (busy
        ? '<span class="sift-bt-spin" style="margin-right:var(--space-6);vertical-align:-2px"></span>' +
          esc(step || t.formatageEnCours)
        : armedAt
          ? t.confirmerArme
          : t.formater) +
      "</button>" +
      (busy
        ? '<div class="sift-usbfmt-progress-note" style="margin-top:var(--space-8);font-size:var(--text-sm);color:var(--color-text-tertiary)">' +
          t.noteProgression +
          "</div>"
        : "") +
      "</div>";

    card.querySelectorAll<HTMLElement>("[data-usbfmt-fs]").forEach((el) =>
      el.addEventListener("click", () => {
        fs = el.dataset.usbfmtFs as TargetFs;
        armedAt = null; // switching filesystem resets the confirm cycle
        // ... and clears any stale error from a previous failed attempt — SAUF une erreur fatale :
        // changer de système de fichiers ne rend pas au disque l'identité qu'il a perdue, et le
        // bouton reste désarmé. Effacer le message laisserait un bouton mort sans explication.
        if (!fatal) lastError = null;
        render();
      }),
    );

    const nameInput = card.querySelector<HTMLInputElement>("#sift-usbfmt-name");
    nameInput?.addEventListener("input", () => {
      volumeName = nameInput.value;
    });

    const confirmBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-confirm");

    const cancelBtn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-cancel");
    if (cancelBtn) cancelBtn.disabled = busy;
    cancelBtn?.addEventListener("click", () => {
      if (busy) return; // formatDrive() has no cancel path — a disabled button says so honestly
      close();
    });

    confirmBtn?.addEventListener("click", () => {
      if (busy || fatal) return;
      if (!armedAt || Date.now() - armedAt < CONFIRM_REARM_MS) {
        // First click (or a suspiciously-fast repeat of a stale one): arm, don't format yet.
        armedAt = Date.now();
        render();
        return;
      }
      busy = true;
      step = T().etapeAutorisation;
      render();
      // Relit l'étape déposée par le processus élevé. 400 ms : assez pour suivre, assez rare pour
      // ne rien coûter — c'est une lecture de fichier, pas un calcul.
      // `formatDrive` rend la main tout de suite : le travail continue sur un fil du backend.
      // C'est donc CE sondage qui porte la fin de l'opération, pas la résolution de la promesse.
      stepTimer = window.setInterval(() => {
        void formatStep().then((s) => {
          if (!busy || !s) return;
          if (s === "Terminé") {
            stopPolling();
            busy = false;
            close();
            window.dispatchEvent(new CustomEvent("sift:usb-format-done", { detail: { ok: true } }));
            return;
          }
          if (s.startsWith("Échec") || s.startsWith("Volume inaccessible")) {
            stopPolling();
            busy = false;
            step = "";
            armedAt = null;
            lastError = s;
            render();
            return;
          }
          if (s === step) return;
          step = s;
          render();
        });
      }, 400);
      const stopPolling = () => {
        if (stepTimer !== null) window.clearInterval(stepTimer);
        stepTimer = null;
      };
      void formatDrive(drive.id, drive.identity, fs, volumeName)
        .then(() => {
          // Ne signifie PLUS « c'est fini » : seulement « le travail est parti ». La fin arrive
          // par le sondage ci-dessus.
        })
        .catch((e: unknown) => {
          stopPolling();
          busy = false;
          step = "";
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
          const t = T();
          const humanized = raw.includes(IDENTITY_MISMATCH)
            ? t.errIdentite(esc(displayName))
            : raw.includes(DRIVE_VANISHED)
              ? t.errDebranche
              : raw.includes(ELEVATION_DECLINED)
                ? t.errElevation
                : /access|denied|permission/i.test(raw)
                  ? t.errAcces
                : /not found|no such|introuvable/i.test(raw)
                  ? t.errIntrouvable
                  : t.errEchec;
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
