// Live "Clé USB" screen (Tauri only) — its own nav destination since 2026-07-31. It used to be a
// card inside Réglages (#sift-reglages-usb) with the nav item redirecting there (finding F5,
// audit-heuristique-visuel.md), so the "Clé USB" item lit up "Réglages" and led to a page about
// something else. Everything USB-related now lives here; Réglages no longer carries any of it.
import { listRemovableDrives } from "./ipc";
import type { RemovableDrive } from "./ipc";
import { requireEl, esc } from "./dom";
import { openUsbFormatModal, driveDisplayName } from "./usb-format-modal";

/** Holds the currently-attached `sift:usb-format-done` window listener, if any, so `renderUsbLive()`
 * can remove it before attaching a new one. Without this, every re-render of the screen (each nav
 * visit) piles up another listener on `window` — unlike DOM nodes, a `window` listener has no parent
 * to disappear with, so it accumulates forever. */
let usbFormatDoneHandler: (() => void) | null = null;

/** Live Clé USB view: the real removable-disk list + formatting entry point, replacing the mockup's
 * static volume rows (which had no backing data). Same "lean Tauri UI" pattern as the other live
 * views — hide the mock content, keep only the title, inject the real thing. */
export function renderUsbLive(): void {
  const content = requireEl("#content", "renderUsbLive");

  // Remove any previous live wrapper so we don't duplicate on re-render. Everything this view
  // renders builds inside `wrap` rather than as a direct sibling of `content` — same single-wrapper
  // rule as renderReglagesLive(), or a future block gets forgotten here and duplicates.
  document.getElementById("sift-usb-live")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "sift-usb-live";
  wrap.className = "sift-screen-stack sift-settings-stack";

  // Hide the mockup's static rows (no real data behind them); keep only the page title.
  let title: Element | null = null;
  for (const child of Array.from(content.children)) {
    if (!title && child.classList.contains("h1")) {
      title = child;
      continue;
    }
    (child as HTMLElement).style.display = "none";
  }

  // Backend-side conservative filter means this list only ever shows removable disks
  // (see usb_format::windows/macos) — no client-side re-filtering needed here.
  // A single block on its own screen, so no .sift-settings-list-row hairline: a divider needs a
  // sibling to divide from, and one item alone in a list is just chrome (CLAUDE.md § Front — CSS).
  const usbBlock = document.createElement("div");
  usbBlock.id = "sift-usb-card";
  usbBlock.dataset.section = "usb";
  usbBlock.className = "sift-settings-card sift-ui-card-soft sift-ui-card-soft-pad";
  usbBlock.innerHTML =
    '<div class="sift-settings-title">Formater une clé USB</div>' +
    '<div class="sift-settings-desc">Formate un disque amovible en FAT32 (contourne la limite ' +
    "32 Go de l'assistant Windows) ou exFAT. Seuls les disques amovibles sont proposés — " +
    "aucun disque interne n'apparaît ici.</div>" +
    '<div id="sift-usb-list" class="sift-usb-list"></div>' +
    '<div class="sift-settings-subactions"><button id="sift-usb-refresh" class="sift-settings-btn sift-settings-btn-quiet">Actualiser la liste</button></div>';

  async function renderUsbList() {
    const listEl = usbBlock.querySelector<HTMLElement>("#sift-usb-list");
    if (!listEl) return;
    listEl.innerHTML = '<div class="sift-usb-empty">Recherche des disques amovibles…</div>';
    let drives: RemovableDrive[] = [];
    try {
      drives = await listRemovableDrives();
    } catch (e) {
      console.error("listRemovableDrives failed", e);
      // The raw chain, not a generic sentence: an enumeration failure here is a backend fault and
      // hiding it is what let a broken WMI query look like "no drive plugged in" for months
      // (CLAUDE.md § Méthode — pas de fallback silencieux).
      listEl.innerHTML =
        '<div class="sift-usb-empty">Impossible de lister les disques amovibles.<br>' +
        esc(String(e)) +
        "</div>";
      return;
    }
    if (!drives.length) {
      // Naming the most common false alarm: an empty card-reader slot keeps its drive letter in
      // the Explorer sidebar forever, so "je vois E: dans l'explorateur" is not evidence that
      // anything is plugged in.
      listEl.innerHTML =
        '<div class="sift-usb-empty">Aucun disque amovible détecté.<br>' +
        "Un lecteur de cartes vide garde sa lettre dans l'explorateur Windows sans qu'aucune " +
        "clé ne soit branchée — vérifie que la clé est bien enfoncée, puis Actualiser.</div>";
      return;
    }
    listEl.innerHTML = "";
    for (const d of drives) {
      const row = document.createElement("div");
      row.className = "sift-usb-row";
      const sizeGb = (d.size_bytes / 1_000_000_000).toFixed(1);
      // A reader with no card inserted is a real, listed device with nothing in it. Say that
      // instead of offering a Formater button that diskpart can only refuse.
      const meta = d.has_media
        ? `${esc(d.label || "Disque amovible")} · ${sizeGb} Go · ${esc(d.current_fs)}`
        : `${esc(d.label || "Lecteur amovible")} · aucun média inséré`;
      row.innerHTML =
        '<div class="sift-usb-row-info">' +
        `<span class="sift-usb-row-id">${esc(driveDisplayName(d))}</span>` +
        `<span class="sift-usb-row-meta">${meta}</span>` +
        "</div>" +
        (d.has_media
          ? '<button type="button" class="sift-settings-btn" data-usb-format>Formater…</button>'
          : "");
      row.querySelector("[data-usb-format]")?.addEventListener("click", () => {
        openUsbFormatModal(d);
      });
      listEl.appendChild(row);
    }
  }

  usbBlock.querySelector("#sift-usb-refresh")?.addEventListener("click", () => void renderUsbList());
  if (usbFormatDoneHandler) {
    window.removeEventListener("sift:usb-format-done", usbFormatDoneHandler);
  }
  usbFormatDoneHandler = () => void renderUsbList();
  window.addEventListener("sift:usb-format-done", usbFormatDoneHandler);
  void renderUsbList();

  wrap.appendChild(usbBlock);
  content.appendChild(wrap);
}
