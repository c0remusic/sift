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
import { ELEVATION_DECLINED, STEP_DONE, STEP_FAILED_PREFIX } from "../shared/contracts";
import { esc } from "./dom";
import { formatDrive, formatStep, listRemovableDrives, type RemovableDrive, type TargetFs } from "./ipc";
import { driveDisplayName } from "./usb-row";
import { humanizeFormatError } from "./usb-format-error";
import { parseFormatStep } from "./usb-format-step";
import { formatGo } from "./usage-chart";
import { T } from "./i18n/usb-format-modal";

const CONFIRM_REARM_MS = 400; // mirrors sift-live.ts's batch-confirm floor (see BATCH_CONFIRM_THRESHOLD)

/** Plafond que WINDOWS impose à la création d'un FAT32. Sift ne le subit plus — il écrit les
 * structures lui-même (`usb_format::fat32`) — mais l'opération demande alors une élévation, et
 * l'utilisateur doit savoir pourquoi une invite va surgir. Miroir de
 * `fat32::WINDOWS_FAT32_CREATE_CEILING`. */
const WINDOWS_FAT32_CEILING = 32 * 1024 ** 3;

/** Bulle d'information : un bouton ⓘ focalisable, et son texte en `role="tooltip"` relié par
 *  `aria-describedby`, ouvert au survol comme au focus clavier — le motif « Tooltip » du WAI-ARIA
 *  APG, celui du Tooltip de shadcn/Radix. La bulle est DANS l'enveloppe survolée : y passer la
 *  souris la garde ouverte, ce qu'exige WCAG 1.4.13.
 *
 *  Tranché par Antoine le 2026-10-07 (wireframe, variante C) : les deux avertissements de la
 *  sheet étaient deux encadrés ambre, « les messages font peur ». Ils passent derrière ⓘ ; le
 *  rappel de l'effacement que tout le monde voit est désormais le bouton armé (« Confirmer — tout
 *  sera effacé »), avec l'armement horodaté qui reste le vrai garde-fou. */
function infoTip(id: string, label: string, text: string): string {
  return (
    '<span class="sift-infotip">' +
    `<button type="button" class="lk-icon sift-infotip-btn" aria-label="${esc(label)}" aria-describedby="${id}">` +
    '<i class="ti ti-info-circle" aria-hidden="true"></i></button>' +
    `<span class="sift-infotip-bubble" role="tooltip" id="${id}">${esc(text)}</span>` +
    "</span>"
  );
}

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
  // Pourcentage de l'étape courante, quand elle en porte un (écriture FAT32 seulement — les autres
  // étapes ne connaissent pas leur total, et la barre ne s'affiche pas pour elles).
  let pct: number | null = null;
  // Formatage terminé : la sheet devient son rapport (spec § États, « Formatage — rapport »).
  // `fresh` = le disque relu après coup ; `undefined` tant que la relecture court, `null` quand
  // elle n'a rien rendu d'exploitable.
  let done = false;
  let fresh: RemovableDrive | null | undefined;

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
    // L'écran relit sa liste à la sortie du rapport, pas à la fin du formatage : sinon la liste
    // se repeint derrière la sheet pendant qu'on lit le résumé.
    if (done) window.dispatchEvent(new CustomEvent("sift:usb-format-done", { detail: { ok: true } }));
  }

  /** Le rapport : ce qui a été produit, relu sur le disque — pas ce qui a été demandé. Le système
   * de fichiers et l'espace viennent de la relecture (`listRemovableDrives`) ; si elle ne rend rien
   * de monté, le rapport le dit au lieu de recopier le choix de l'utilisateur. */
  function renderReport(): void {
    const t = T();
    const fact = (k: string, v: string): string =>
      `<div class="sift-usb-fact"><dt>${k}</dt><dd>${v}</dd></div>`;
    let body: string;
    if (fresh === undefined) {
      body = `<div class="sift-usbfmt-desc">${t.relecture}</div>`;
    } else if (fresh && fresh.mount) {
      body =
        '<dl class="sift-usbfmt-report">' +
        fact(t.rapportFormat, esc(fresh.current_fs)) +
        fact(t.rapportUtile, formatGo(fresh.free_bytes)) +
        fact(t.rapportMontage, esc(fresh.mount)) +
        "</dl>";
    } else {
      body = `<div class="sift-usbfmt-desc">${t.relectureVide}</div>`;
    }
    card.innerHTML =
      `<div class="sift-usbfmt-title">${t.rapportTitre(esc(displayName))}</div>` +
      body +
      '<div class="sift-usbfmt-actions">' +
      `<button type="button" id="sift-usbfmt-done" class="sift-settings-btn">${t.terminer}</button>` +
      "</div>";
    const btn = card.querySelector<HTMLButtonElement>("#sift-usbfmt-done");
    btn?.addEventListener("click", close);
    btn?.focus();
  }

  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  /** Vrai quand ce formatage passera par l'écriture FAT32 de Sift plutôt que par `diskpart` —
   * donc quand une invite d'élévation Windows va surgir. Ce n'est PAS un blocage : c'est le cas
   * d'usage principal d'une clé DJ moderne, et le seul que Windows ne sait pas traiter. */
  const needsElevation = () => fs === "fat32" && drive.size_bytes > WINDOWS_FAT32_CEILING;

  function render() {
    if (done) {
      renderReport();
      return;
    }
    const t = T();
    // Ce que la bulle du système de fichiers explique : l'exFAT incertain sur les CDJ, et
    // l'invite administrateur au-delà de 32 Go. Pas de bulle quand il n'y a rien à dire.
    const fsNotes = [
      fs === "ex_fat" ? t.avertissementExfat : null,
      needsElevation() ? t.avertissementElevation : null,
    ].filter((n): n is string => n !== null);
    card.innerHTML =
      '<div class="sift-usbfmt-titlerow">' +
      '<div class="sift-usbfmt-title">' +
      t.titre(esc(displayName)) +
      "</div>" +
      infoTip("sift-usbfmt-tip-erase", t.aproposEffacement, t.avertissement) +
      "</div>" +
      '<div class="sift-usbfmt-desc">' +
      esc(drive.label || t.disqueAmovible) +
      " · " +
      t.tailleEtFormat(sizeGb, esc(drive.current_fs)) +
      "</div>" +
      (lastError
        ? '<div class="sift-usbfmt-error">' + esc(lastError) + "</div>"
        : "") +
      '<div class="sift-usbfmt-fsrow">' +
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
      (fsNotes.length > 0 ? infoTip("sift-usbfmt-tip-fs", t.aproposSysteme, fsNotes.join(" ")) : "") +
      "</div>" +
      '<div class="sift-usbfmt-namerow">' +
      '<label for="sift-usbfmt-name">' +
      t.nomVolume +
      "</label>" +
      '<input type="text" id="sift-usbfmt-name" maxlength="11" autocomplete="off" ' +
      'spellcheck="false" value="' +
      esc(volumeName) +
      '"></div>' +

      (busy && pct !== null
        ? '<div class="sift-usbfmt-progress">' +
          `<progress class="sift-bs-bar" value="${pct}" max="100"></progress>` +
          `<div class="sift-bs-step"><span class="sift-usbfmt-pct">${t.pourcent(pct)}</span> · <span class="sift-usbfmt-steptext">${esc(step)}</span></div>` +
          "</div>"
        : "") +
      '<div class="sift-usbfmt-actions">' +
      '<button type="button" id="sift-usbfmt-cancel" class="sift-settings-btn">' +
      t.annuler +
      "</button>" +
      '<button type="button" id="sift-usbfmt-confirm" class="sift-settings-btn sift-usbfmt-confirm-btn"' +
      (busy || fatal ? " disabled" : "") +
      ">" +
      (busy
        ? '<span class="sift-bt-spin" style="margin-right:var(--space-6);vertical-align:-2px"></span>' +
          // Avec une barre, l'étape s'écrit sous elle : le bouton ne la répète pas.
          esc(pct !== null ? t.formatageEnCours : step || t.formatageEnCours)
        : armedAt
          ? t.confirmerArme
          : t.formater) +
      "</button>" +
      // L'invite d'autorisation est passée quand l'écriture rend un pourcentage : la note se tait.
      (busy && pct === null
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
      // Pas d'annulation, tranché par Antoine le 2026-11-03 (spec cle-usb.md § États) : une fois
      // lancé, l'ancien contenu est déjà effacé — s'arrêter ne laisserait qu'une clé illisible.
      if (busy) return;
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
          // Deux marqueurs NEUTRES (`shared/contracts.ts`), pas des mots : ils valaient « Terminé » et
          // « Échec » jusqu'au 2026-09-23, et traduire l'étape aurait laissé ce sondage tourner pour
          // toujours sous une interface anglaise, bouton Annuler grisé.
          if (s === STEP_DONE) {
            stopPolling();
            busy = false;
            done = true;
            render();
            void listRemovableDrives()
              .then((ds) => {
                fresh = ds.find((d) => d.id === drive.id) ?? null;
              })
              .catch((e: unknown) => {
                console.error("listRemovableDrives after format failed", e);
                fresh = null;
              })
              .then(() => {
                if (overlay.isConnected) render();
              });
            return;
          }
          if (s.startsWith(STEP_FAILED_PREFIX)) {
            stopPolling();
            busy = false;
            step = "";
            pct = null;
            armedAt = null;
            const cause = s.slice(STEP_FAILED_PREFIX.length);
            // Sous Windows, l'invite UAC refusée arrive PAR CE CHEMIN — le fil du backend dépose
            // l'erreur dans le fichier d'étape, la promesse de `formatDrive` a déjà résolu. Le
            // message humain n'existait que dans le `.catch` ci-dessous, que ce cas n'atteint jamais :
            // l'écran affichait la sentinelle brute, « Échec : ELEVATION_DECLINED ».
            lastError = cause.includes(ELEVATION_DECLINED) ? T().errElevation : cause;
            render();
            return;
          }
          // Fréquence : au plus une étape neuve par sondage (400 ms) ; pendant l'écriture FAT32 le
          // backend en dépose une tous les 16 Mio. Une barre déjà posée se MUTE — reconstruire la
          // carte à chaque cran couperait la transition de `<progress>`.
          const next = parseFormatStep(s);
          if (next.text === step && next.pct === pct) return;
          const hadBar = pct !== null;
          step = next.text;
          pct = next.pct;
          const bar = card.querySelector<HTMLProgressElement>(".sift-usbfmt-progress progress");
          if (hadBar && pct !== null && bar) {
            bar.value = pct;
            const pctEl = card.querySelector(".sift-usbfmt-pct");
            const textEl = card.querySelector(".sift-usbfmt-steptext");
            if (pctEl) pctEl.textContent = T().pourcent(pct);
            if (textEl) textEl.textContent = step;
            return;
          }
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
          pct = null;
          armedAt = null;
          console.error("formatDrive failed", e);
          // Les deux sentinelles du garde anti-course passent EN PREMIER et coupent le chemin de
          // reprise (`fatal`) — voir `usb-format-error.ts`. Le texte rendu est BRUT : render()
          // l'échappe, une seule fois.
          const humanized = humanizeFormatError(String(e), displayName);
          fatal = humanized.fatal;
          // render() below does card.innerHTML = ... (full replacement) — insertAdjacentHTML'ing
          // the error directly into the current DOM would just get wiped out immediately, with no
          // paint in between to make it visible. Store it and let render() include it.
          lastError = humanized.text;
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
