// Écartés (Discarded) view (Tauri only): the real rejected/trashed tracks with re-source links.
// Extracted from sift-live.ts (audit P-3). Row actions (copy query / send-to-bin / restore /
// empty-bin / store link) are handled by the delegated #pa click handler in sift-live, which
// re-renders via this module's renderEcartes.
import { listEcartes } from "./ipc";
import type { EcarteItem } from "../shared/contracts";
import { requireEl } from "./dom";
import { createVirtualList, type VirtualList } from "./list-virtual";
import { emptyStateHtml, wireEmptyState } from "./empty-state";

// Virtualized list controllers for the two Écartés sections (à re-sourcer / corbeille). Both scroll
// container is the permanent #content, so a stale listener would leak across re-renders — destroyed
// at the top of every renderEcartes. Kept apart because the two lists have different row heights
// (a resourcing row has a second action line; a trash row is single-line).
let resVirtual: VirtualList<EcarteItem> | null = null;
let trashVirtual: VirtualList<EcarteItem> | null = null;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

// Reason chip for an écarté track (truncated → tronqué, fake → faux, else à re-sourcer). Uses
// the shared .sift-vchip component so tone/shape stay consistent across screens.
function ecReason(it: EcarteItem): string {
  if (it.truncated)
    return '<span class="sift-vchip" style="background:var(--color-background-warning);color:var(--color-text-warning);flex:none"><i class="ti ti-cut" style="font-size:var(--text-2xs)"></i> tronqué</span>';
  if (it.verdict === "fake")
    return '<span class="sift-vchip" style="background:var(--color-background-danger);color:var(--color-text-danger);flex:none"><i class="ti ti-alert-triangle" style="font-size:var(--text-2xs)"></i> faux</span>';
  return '<span class="sift-vchip" style="background:var(--overlay-selected);color:var(--color-text-secondary);flex:none"><i class="ti ti-alert-circle" style="font-size:var(--text-2xs)"></i> à re-sourcer</span>';
}

// Neutral re-source query string (single space; no dash).
function ecQuery(it: EcarteItem): string {
  if (it.artist && it.title) return `${it.artist} ${it.title}`;
  return (it.filename || it.path).replace(/\.[^.]+$/, "");
}

// Buy-link stores: a search URL built from the track's query (q is already encoded).
const EC_STORES: [string, (q: string) => string][] = [
  ["Beatport", (q) => `https://www.beatport.com/search?q=${q}`],
  ["Traxsource", (q) => `https://www.traxsource.com/search?term=${q}`],
  ["Juno", (q) => `https://www.junodownload.com/search/?q%5Ball%5D%5B%5D=${q}`],
  ["Bandcamp", (q) => `https://bandcamp.com/search?q=${q}`],
  ["Amazon", (q) => `https://www.amazon.fr/s?k=${q}&i=digital-music`],
  ["Apple Music", (q) => `https://music.apple.com/fr/search?term=${q}`],
];

// Buy-link row for a track: store names that open a search in the default browser.
function ecStoreLinks(it: EcarteItem): string {
  const q = encodeURIComponent(ecQuery(it));
  return EC_STORES.map(
    ([label, fn]) =>
      `<a data-ec="store" data-url="${encodeURIComponent(fn(q))}" style="font-size:var(--text-xs);color:var(--color-text-info);cursor:pointer;text-decoration:none;white-space:nowrap">${label}</a>`,
  ).join('<span style="color:var(--color-border-secondary);margin:0 3px">·</span>');
}

const ecName = (it: EcarteItem) =>
  esc(it.artist && it.title ? `${it.artist} — ${it.title}` : it.filename || it.path);
const ecFileLine = (it: EcarteItem) =>
  `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(
    it.filename || it.path,
  )}</div>`;

// The 6 store links only show on hover/focus of the row (.sift-ec-stores, styled in styles.css) —
// rendering them open on every row was a wall of links; "Copié" stays always visible.
// Fixed height per row (the store span is visibility:hidden, so it still occupies its line) —
// required by the virtualized windowing, which relies on one measured row height.
function resRowHtml(it: EcarteItem): string {
  return `<div class="sift-ec-row" style="padding:8px 4px;border-bottom:0.5px solid var(--color-border-tertiary)"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--text-md);font-weight:500">${ecName(
    it,
  )}</div>${ecFileLine(it)}</div>${ecReason(
    it,
  )}<button class="lk-icon" data-ec="requeue" data-id="${it.id}" title="Restaurer — remettre en file" aria-label="Restaurer — remettre en file"><i class="ti ti-arrow-back-up" style="font-size:var(--text-base);color:var(--color-text-tertiary)"></i></button><button class="lk-icon" data-ec="trash" data-id="${it.id}" title="Envoyer à la corbeille" aria-label="Envoyer à la corbeille"><i class="ti ti-trash" style="font-size:var(--text-md);color:var(--color-text-tertiary)"></i></button></div><div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:4px"><button data-ec="copy-query" data-q="${esc(
    ecQuery(it),
  )}" title="Copier" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-secondary)"><i class="ti ti-copy" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copié</button><span class="sift-ec-stores" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px"><span style="color:var(--color-border-secondary)">·</span>${ecStoreLinks(
    it,
  )}</span></div></div>`;
}

function trashRowHtml(it: EcarteItem): string {
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:0.5px solid var(--color-border-tertiary)"><div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--text-md)">${ecName(
    it,
  )}</div>${ecFileLine(it)}</div><button data-ec="restore" data-id="${it.id}" title="Restaurer — remettre en file" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-info)">Restaurer</button></div>`;
}

function sectionCardHtml(title: string, hostId: string): string {
  return `<section class="sift-ui-card sift-ui-card-pad sift-ec-section"><div class="col-h">${title}</div><div id="${hostId}"></div></section>`;
}

// Live Écartés view: replaces #content with the real rejected (à re-sourcer) + trashed tracks.
// Copy-query + send-to-bin / restore / empty-bin wired via the #pa handler.
export async function renderEcartes() {
  const content = requireEl("#content", "renderEcartes");
  resVirtual?.destroy();
  trashVirtual?.destroy();
  resVirtual = null;
  trashVirtual = null;

  let items: EcarteItem[] = [];
  try {
    items = await listEcartes();
  } catch (e) {
    console.error("listEcartes failed", e);
    return;
  }
  const res = items.filter((i) => i.status === "resourcing");
  const trash = items.filter((i) => i.status === "trash");

  content.innerHTML =
    '<div class="h1">Écartés</div>' +
    (items.length === 0
      ? emptyStateHtml({
          title: "Rien dans Écartés",
          note: "Les pistes que tu écartes depuis Revue apparaissent ici, avec possibilité de les restaurer.",
          backToRevue: true,
        })
      : '<div class="sift-screen-stack">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        `<span class="pill" style="background:var(--overlay-selected);color:var(--color-text-secondary)"><i class="ti ti-alert-circle" style="font-size:var(--text-xs)"></i> ${res.length} à re-sourcer</span>` +
        `<span class="pill"><i class="ti ti-trash" style="font-size:var(--text-xs)"></i> ${trash.length} en corbeille</span>` +
        (trash.length
          ? `<button data-ec="purge" title="Purger — suppression définitive" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-danger)">Purger la corbeille (${trash.length})</button>`
          : "") +
        "</div>" +
        '<div class="sift-ec-sections">' +
        (res.length ? sectionCardHtml("À re-sourcer", "ec-res-list") : "") +
        (trash.length ? sectionCardHtml("Corbeille", "ec-trash-list") : "") +
        "</div></div>");
  wireEmptyState(content);

  if (items.length === 0) return;

  const resHost = document.getElementById("ec-res-list");
  if (resHost) {
    resVirtual = createVirtualList<EcarteItem>({
      host: resHost,
      scrollContainer: content,
      items: res,
      rowHtml: resRowHtml,
      probeHtml: resRowHtml(res[0]),
      fallbackRowH: 58,
    });
  }
  const trashHost = document.getElementById("ec-trash-list");
  if (trashHost) {
    trashVirtual = createVirtualList<EcarteItem>({
      host: trashHost,
      scrollContainer: content,
      items: trash,
      rowHtml: trashRowHtml,
      probeHtml: trashRowHtml(trash[0]),
      fallbackRowH: 42,
    });
  }
}
