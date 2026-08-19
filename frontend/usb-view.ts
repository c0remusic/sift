// Live "Clé USB" screen (Tauri only) — its own nav destination since 2026-07-31. It used to be a
// card inside Réglages (#sift-reglages-usb) with the nav item redirecting there (finding F5,
// audit-heuristique-visuel.md), so the "Clé USB" item lit up "Réglages" and led to a page about
// something else. Everything USB-related now lives here; Réglages no longer carries any of it.
import { listRemovableDrives, driveUsage, ejectDrive } from "./ipc";
import type { RemovableDrive } from "./ipc";
import { requireEl, esc } from "./dom";
import { openUsbFormatModal } from "./usb-format-modal";
import { usbRowHtml } from "./usb-row";
import { renderUsageChart } from "./usage-chart";

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
  // A single block on its own screen, so no divider hairline: a divider needs a visible sibling to
  // divide from, and one item alone in a list is just chrome (CLAUDE.md § Front — CSS). Réglages a
  // fini par apprendre la même chose — son filet .sift-settings-list-row a été retiré le 2026-08-19,
  // parce qu'une seule catégorie y est visible à la fois.
  const usbBlock = document.createElement("div");
  usbBlock.id = "sift-usb-card";
  usbBlock.dataset.section = "usb";
  usbBlock.className = "sift-settings-card sift-ui-card-soft sift-ui-card-soft-pad";
  usbBlock.innerHTML =
    '<div class="sift-settings-title">Formater une clé USB</div>' +
    // Ne promet plus de "contourner la limite 32 Go de l'assistant Windows" : c'était faux, la
    // limite est dans le pilote de formatage et diskpart la subit comme l'explorateur (vérifié
    // 2026-07-31). La modale refuse déjà FAT32 au-delà — laisser les deux textes se contredire
    // serait pire que l'un ou l'autre.
    '<div class="sift-settings-desc">Formate un disque amovible en exFAT, ou en FAT32 jusqu\'à ' +
    "32 Go — au-delà, Windows ne sait pas créer de volume FAT32. Seuls les disques amovibles " +
    "sont proposés — aucun disque interne n'apparaît ici.</div>" +
    '<div id="sift-usb-list" class="sift-usb-list"></div>' +
    '<div class="sift-settings-subactions"><button id="sift-usb-refresh" class="sift-settings-btn sift-settings-btn-quiet">Actualiser la liste</button></div>';

  /** Remplit `slot` avec le graphique d'occupation de `d`. Le parcours peut prendre quelques
   * secondes au premier passage (ensuite le backend sert son cache), donc le slot annonce
   * l'attente au lieu de rester vide — un blanc se lit comme une panne. */
  async function mountUsage(slot: HTMLElement, d: RemovableDrive, force = false): Promise<void> {
    slot.innerHTML = '<div class="sift-usb-empty">Analyse de l\'occupation…</div>';
    let report;
    try {
      report = await driveUsage(d.id, force);
    } catch (e) {
      console.error("driveUsage failed", e);
      slot.innerHTML =
        '<div class="sift-usb-empty">Occupation indisponible.<br>' + esc(String(e)) + "</div>";
      return;
    }
    const sizeGb = (d.size_bytes / 1_000_000_000).toFixed(1).replace(".", ",");
    slot.innerHTML = "";
    slot.appendChild(
      renderUsageChart({
        report,
        title: d.mount ? `${d.mount} — ${d.label}` : d.label,
        subtitle: `Disque USB externe · ${d.current_fs}`,
        // Ni capacité ni connexion : la ligne au-dessus et l'encadré de capacité les portent déjà.
        info: [
          ["Espace libre", `${(d.free_bytes / 1_000_000_000).toFixed(1).replace(".", ",")} Go`],
          ["Système de fichiers", d.current_fs],
          ["Fichiers", String(report.file_count)],
          ["Périphérique", d.id.replace(/^\\\\\.\\/, "")],
          ["Taille totale", `${sizeGb} Go`],
          // Non OK = mis en alerte. C'est la seule information de cet encadre qui appelle une
          // action de la part d'Antoine, elle ne doit pas se fondre dans les autres.
          ["Santé", d.health || "Inconnue", d.health === "OK" ? undefined : "warn"],
        ],
        onRefresh: async () => {
          await mountUsage(slot, d, true);
        },
        onEject: async () => {
          await ejectDrive(d.id);
          // Éjecté : la ligne comme le graphique n'ont plus d'objet. On repart d'une liste
          // fraîche plutôt que de retirer la ligne à la main et risquer de mentir.
          await renderUsbList();
        },
      }),
    );
  }

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
      row.innerHTML = usbRowHtml(d);
      row.querySelector("[data-usb-format]")?.addEventListener("click", () => {
        openUsbFormatModal(d);
      });
      listEl.appendChild(row);
      // Le graphique d'occupation vit sous SA ligne, pas dans une carte flottante qui
      // réafficherait la même identité. Un disque sans média n'a rien à parcourir.
      if (d.has_media) {
        const slot = document.createElement("div");
        slot.className = "sift-usb-usage-slot";
        listEl.appendChild(slot);
        void mountUsage(slot, d);
      }
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
