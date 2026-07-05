// Écartés (Discarded) view (Tauri only): the real rejected/trashed tracks with re-source links.
// Extracted from sift-live.ts (audit P-3). Row actions (Soulseek copy / send-to-bin / restore /
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

/** Reason chip for an écarté track (truncated → tronqué, fake → faux, else à re-sourcer). Uses the
 *  shared `.sift-vchip` component (Revue-Détail's evidence chips) so tone/shape stay consistent
 *  across screens instead of ad-hoc inline styles. */
function ecReason(it: EcarteItem): string {
  if (it.truncated)
    return '<span class="sift-vchip" style="background:var(--color-background-warning);color:var(--color-text-warning);flex:none"><i class="ti ti-cut" style="font-size:var(--text-2xs)"></i> tronqué</span>';
  if (it.verdict === "fake")
    return '<span class="sift-vchip" style="background:var(--color-background-danger);color:var(--color-text-danger);flex:none"><i class="ti ti-alert-triangle" style="font-size:var(--text-2xs)"></i> faux</span>';
  // FIX-8: neutral tone, not danger — "à re-sourcer" is a routine outcome (source missing/
  // low-quality), not an anomaly detection like "faux" above.
  return '<span class="sift-vchip" style="background:var(--overlay-selected);color:var(--color-text-secondary);flex:none"><i class="ti ti-alert-circle" style="font-size:var(--text-2xs)"></i> à re-sourcer</span>';
}

/** The "Artiste Titre" string to paste into Soulseek (single space; no dash). */
function ecSlsk(it: EcarteItem): string {
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

/** Buy-link row for a track: store names that open a search in the default browser. */
function ecStoreLinks(it: EcarteItem): string {
  const q = encodeURIComponent(ecSlsk(it));
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
// rendering them open on every row was a wall of links; "Copier le nom" (the one action most
// re-sourcing starts with) stays always visible (audit UI/UX 2026-07-03, fix 6). Fixed height per
// row (the store span is visibility:hidden, so it still occupies its line) — required by the
// virtualized windowing, which relies on one measured row height.
function resRowHtml(it: EcarteItem): string {
  return `<div class="sift-ec-row" style="padding:8px 4px;border-bottom:0.5px solid var(--color-border-tertiary)"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--text-md);font-weight:500">${ecName(
    it,
  )}</div>${ecFileLine(it)}</div>${ecReason(
    it,
  )}<button class="lk" data-ec="requeue" data-id="${it.id}" title="Restaurer — remettre en file" aria-label="Restaurer — remettre en file"><i class="ti ti-arrow-back-up" style="font-size:var(--text-base);color:var(--color-text-tertiary)"></i></button><button class="lk" data-ec="trash" data-id="${it.id}" title="Envoyer à la corbeille" aria-label="Envoyer à la corbeille"><i class="ti ti-trash" style="font-size:var(--text-md);color:var(--color-text-tertiary)"></i></button></div><div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:4px"><button data-ec="slsk" data-q="${esc(
    ecSlsk(it),
  )}" title="Copier « Artiste Titre » pour chercher sur Soulseek" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-secondary)"><i class="ti ti-copy" style="font-size:var(--text-xs);vertical-align:-1px"></i> Copier le nom</button><span class="sift-ec-stores" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px"><span style="color:var(--color-border-secondary)">·</span>${ecStoreLinks(
    it,
  )}</span></div></div>`;
}

function trashRowHtml(it: EcarteItem): string {
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:0.5px solid var(--color-border-tertiary)"><div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:var(--text-md)">${ecName(
    it,
  )}</div>${ecFileLine(it)}</div><button data-ec="restore" data-id="${it.id}" title="Restaurer — remettre en file" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-info)">Restaurer</button></div>`;
}

/** Live Écartés view: replaces #content with the real rejected (à re-sourcer) + trashed
 * tracks. Soulseek copy + send-to-bin / restore / empty-bin wired via the #pa handler. */
export async function renderEcartes() {
  const content = requireEl("#content", "renderEcartes");
  // Tear down previous virtual lists first: their scroll listeners sit on the permanent #content,
  // which this render overwrites — leaving them attached would leak + double-render.
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
      : '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">' +
        `<span class="pill" style="background:var(--overlay-selected);color:var(--color-text-secondary)"><i class="ti ti-alert-circle" style="font-size:var(--text-xs)"></i> ${res.length} à re-sourcer</span>` +
        `<span class="pill"><i class="ti ti-trash" style="font-size:var(--text-xs)"></i> ${trash.length} en corbeille</span>` +
        (trash.length
          ? `<button data-ec="purge" title="Purger — suppression définitive" style="font-size:var(--text-xs);padding:2px 8px;color:var(--color-text-danger)">Purger la corbeille (${trash.length})</button>`
          : "") +
        "</div>" +
        // Both lists are virtualized (createVirtualList below) — these are just the mount hosts,
        // filled with only the visible window after innerHTML. Rendering all ~thousands of rows
        // here would reintroduce the freeze (audit 2026-07-05 P2). #content is the scroll container.
        (res.length ? `<div class="col-h">À re-sourcer</div><div id="ec-res-list"></div>` : "") +
        (trash.length ? `<div class="col-h" style="margin-top:14px">Corbeille</div><div id="ec-trash-list"></div>` : ""));
  wireEmptyState(content);

  if (items.length === 0) return;

  const resHost = document.getElementById("ec-res-list");
  if (resHost) {
    resVirtual = createVirtualList<EcarteItem>({
      host: resHost,
      scrollContainer: content,
      items: res,
      rowHtml: resRowHtml,
      // Probe = a real resRowHtml row (res[0], guaranteed present since res.length gated this
      // block) so the measured height matches mounted rows EXACTLY — including the second action
      // line with its .sift-ec-stores span (visibility:hidden, still occupies its height, and may
      // wrap: all res rows share the identical store list, so they wrap identically → uniform).
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
      probeHtml: trashRowHtml(trash[0]), // real row (trash[0] present — trash.length gated this)
      fallbackRowH: 42,
    });
  }
}
