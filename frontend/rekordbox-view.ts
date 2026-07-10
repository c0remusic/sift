// Rekordbox integration screen — extracted from sift-live.ts (clean-architecture audit F1,
// 2026-07-09). Click handling for mdb*/mds*/rkbreexport actions stays in sift-live.ts's
// delegated #pa handler (same split as ecartes-view.ts: render+state live here, dispatch stays
// centralized) — it mutates the Set/Map state below via method calls (add/delete/set), which
// works fine across the module boundary; only bare reassigned primitives would need boxing, and
// none of this module's exported state is bare-reassigned from outside it.
import {
  rekordboxStatus,
  rekordboxMasterdbPendingRepairs,
  rekordboxMasterdbScanPlaylistDuplicates,
  rekordboxMasterdbPendingMetadataSyncs,
  rekordboxMasterdbPendingArtworkSyncs,
} from "./ipc";
import type {
  RekordboxLinkStatus,
  PendingMasterdbRepair,
  CandidateTrack,
  PlaylistDuplicateGroupDto,
  PendingMetadataSync,
  PendingArtworkSync,
} from "../shared/contracts";
import { requireEl } from "./dom";
import { emptyStateHtml, wireEmptyState } from "./empty-state";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

// M8 Tier 1 repairs section state — module-level, NOT reset on every render. Filtered against
// the live pending/ambiguous rows each render so a stale id (one that got applied/dismissed
// elsewhere) drops out without touching the rest of the selection.
export const mdbRepairSel = new Set<number>();
// Per-row apply failure message, transient (never persisted) — cleared when the row is
// reselected or the next apply_repairs batch touches it again.
export const mdbErrorById = new Map<number, string>();
// M8 Tier 2 playlist-dedup section state — stateless on the backend (no server-side id, see the
// IPC wiring plan's Architecture note), so the frontend keeps the last scan result itself and
// references entries by array index from the DOM. Re-populated on every renderRekordboxLive()
// call. Only ever reassigned here (renderRekordboxLive) — the click handler in sift-live.ts only
// reads it by index, which is a live-binding read and works fine through the import.
export let lastScannedDuplicateGroups: PlaylistDuplicateGroupDto[] = [];
// Per-group dedup failure message, keyed by "playlistId::contentId" (no numeric id exists for a
// duplicate group) — same transient, never-persisted contract as mdbErrorById.
export const mdbDedupErrorByKey = new Map<string, string>();
// M8 Tier 3 metadata-syncs section state — same module-level, filtered-not-reset discipline as
// mdbRepairSel.
export const mdsSyncSel = new Set<number>();
export const mdsErrorById = new Map<number, string>();
// M8 Tier 3 (pochette) artwork-syncs section state — same module-level, filtered-not-reset
// discipline as mdsSyncSel.
export const masSyncSel = new Set<number>();
export const masErrorById = new Map<number, string>();

// Session-group expand/collapse state for the 3 M8 candidate sections — groups are collapsed by
// default (nothing in the set), same module-level/filtered-not-reset discipline as the Sel sets
// above. Keyed by `session_id ?? SESSION_GROUP_NONE` (a real session_id can't collide with this
// sentinel since Sift's session ids are timestamp-based numeric strings).
const SESSION_GROUP_NONE = "__none__";
export const mdbExpandedGroups = new Set<string>();
export const mdsExpandedGroups = new Set<string>();
export const masExpandedGroups = new Set<string>();

// Last-rendered *pending* rows per section, refreshed at the top of each section's render call —
// same "cache so the delegated click handler can read it synchronously" pattern as
// lastScannedDuplicateGroups above. A group-select click needs the full id list for its
// session_id at click time, before the next renderRekordboxLive() refetch resolves.
export let lastPendingRepairs: PendingMasterdbRepair[] = [];
export let lastPendingMetadataSyncs: PendingMetadataSync[] = [];
export let lastPendingArtworkSyncs: PendingArtworkSync[] = [];

/** Ids of every pending row in `rows` whose `session_id` matches `sessionKey`
 * (`SESSION_GROUP_NONE` for null) — shared by the 3 group-select click handlers in sift-live.ts. */
export function idsInSessionGroup<T extends { id: number; session_id: string | null }>(
  rows: T[],
  sessionKey: string,
): number[] {
  return rows.filter((r) => (r.session_id ?? SESSION_GROUP_NONE) === sessionKey).map((r) => r.id);
}

/** Groups pending rows by `session_id` (insertion order, `SESSION_GROUP_NONE` for null — pre-v8
 * rows), mirroring journal.ts's session-grouping convention (`sessionGroupHtml`). Shared by the 3
 * M8 candidate sections instead of tripling the loop. */
function groupBySession<T extends { id: number; session_id: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.session_id ?? SESSION_GROUP_NONE;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

/** Renders one collapsible session-group wrapper: header (label, count, expand toggle, "tout
 * sélectionner/désélectionner pour cette session") + its rows when expanded. `groupAction` and
 * `toggleAction` are the `data-sift` values sift-live.ts's delegated handler dispatches on
 * (`mdb*`/`mds*`/`mas*`, one pair per section — see the click handling note at the top of this
 * file for why the mutation itself lives there, not here). */
function sessionGroupHtml<T extends { id: number; session_id: string | null }>(
  sessionKey: string,
  rows: T[],
  sel: Set<number>,
  expanded: Set<string>,
  toggleAction: string,
  groupAction: string,
  rowHtml: (r: T) => string,
): string {
  const isOpen = expanded.has(sessionKey);
  const label = sessionKey === SESSION_GROUP_NONE ? "Antérieur" : sessionKey;
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  return (
    `<div class="rb-session-group">` +
    `<div class="rb-session-hd">` +
    `<button data-sift="${toggleAction}" data-session="${esc(sessionKey)}" class="rb-session-toggle">` +
    `${isOpen ? "▾" : "▸"} ${esc(label)} (${rows.length})</button>` +
    `<button data-sift="${groupAction}" data-session="${esc(sessionKey)}" class="rb-session-selectall">` +
    `${allSelected ? "Tout désélectionner" : "Tout sélectionner"}</button>` +
    `</div>` +
    (isOpen ? rows.map(rowHtml).join("") : "") +
    `</div>`
  );
}

export function duplicateGroupKey(g: PlaylistDuplicateGroupDto): string {
  return `${g.playlist_id}::${g.content_id}`;
}

/** Rekordbox link-status card, the Rekordbox page's centerpiece (moved out of Bibliothèque, audit
 * 2026-07-05 — see docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md). Same
 * visual family as the M6b stat cards (border+radius token, no accent stripe per the CSS ban on
 * border-left/-right accents). Only called for `s.linked === true` — the not-linked case is a
 * full empty-state (see renderRekordboxLive). */
function rekordboxCardHtml(s: RekordboxLinkStatus): string {
  const body = s.error
    ? `<div style="font-size:var(--text-md);color:var(--color-text-danger)">XML Rekordbox illisible — relie un fichier.</div>`
    : `<div style="font-size:var(--text-md)">${esc(s.path || "")}</div>` +
      `<div style="font-size:var(--text-sm);color:var(--color-text-tertiary)">${s.playlist_count} playlists · ${s.track_count} pistes</div>`;
  // No "Réexporter" while the linked file is unreadable — the backend already refuses the export
  // in that case (export_rekordbox_xml_inner reads the same path before merging).
  const reexport = s.error
    ? ""
    : `<button data-sift="rkbreexport" style="flex:none">Réexporter maintenant</button>`;
  return (
    `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px">` +
    `<div style="min-width:0">${body}</div>` +
    `<div style="display:flex;gap:8px;flex:none">${reexport}<button data-bib="rkblink" style="flex:none">Changer de XML lié</button></div>` +
    `</div>`
  );
}

/** M8 Tier 1 section: lists master.db path-repair candidates detected passively at filing time
 * (`rekordbox_masterdb_repairs`, actions.rs::detect_masterdb_repair_if_linked) and lets the user
 * resolve/apply/dismiss them. Independent of `driftBanner` (XML repair signal, unrelated
 * mechanism) — see docs/superpowers/specs/2026-07-06-m8-tier1-ui-screen-design.md. Renders "" when
 * there is nothing pending/ambiguous, same show-nothing-when-empty rule as driftBanner. */
function masterdbRepairsSectionHtml(rows: PendingMasterdbRepair[]): string {
  if (rows.length === 0) return "";
  // Drop stale selection ids without touching the rest — same discipline as batchSel's own
  // re-filter in sift-live.ts.
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdbRepairSel]) if (!liveIds.has(id)) mdbRepairSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingRepairs = pending;

  const pathBlock = (r: PendingMasterdbRepair) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.to_path)}</div>` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="opacity:.55">was</span> ${esc(r.from_path)}</div>` +
    (mdbErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdbErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingMasterdbRepair): CandidateTrack[] =>
    r.candidate_tracks && r.candidate_tracks.length
      ? r.candidate_tracks
      : (r.candidate_track_ids || "")
          .split(",")
          .filter(Boolean)
          .map((track_id) => ({ track_id, folder_path: null }));

  const ambiguousRows = ambiguous
    .map((r) => {
      const candidateBtns = candidateList(r)
        .map(
          (c) =>
            `<button data-sift="mdbresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${pathBlock(r)}` +
        `<button data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRowHtml = (r: PendingMasterdbRepair) => {
    const checked = mdbRepairSel.has(r.id);
    return (
      // Audit-ref G3 (Rekordbox, 2026-07-09) : ligne-checkbox sans clavier — tabindex/role/
      // aria-checked ajoutés, clavier via installNavKeyboard() étendu. Le bouton "Ignorer" imbriqué
      // est déjà protégé par la garde anti-double-déclenchement (Bibliothèque, audit-ref B1).
      `<div class="bx-row" data-sift="mdbpick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
        checked ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
      pathBlock(r) +
      `<button data-sift="mdbdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
      `</div>`
    );
  };

  const pendingRows = [...groupBySession(pending).entries()]
    .map(([sid, rows]) => sessionGroupHtml(sid, rows, mdbRepairSel, mdbExpandedGroups, "mdbgrouptoggle", "mdbgroupselect", pendingRowHtml))
    .join("");

  const applyBar =
    mdbRepairSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="mdbapply" style="font-weight:500">Appliquer la sélection (${mdbRepairSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Réparations master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}

/** M8 Tier 3 section: lists master.db metadata sync candidates detected passively whenever Sift
 * writes ID3 tags on a file linked to Rekordbox (filing, "Appliquer les tags", édition
 * Bibliothèque — see docs/superpowers/plans/2026-07-09-m8-tier3-metadata-sync-ipc-ui.md).
 * Independent of masterdbRepairsSectionHtml/playlistDuplicatesSectionHtml — 3 separate sections,
 * never merged. Renders "" when nothing pending/ambiguous. */
function metadataSyncsSectionHtml(rows: PendingMetadataSync[]): string {
  if (rows.length === 0) return "";
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...mdsSyncSel]) if (!liveIds.has(id)) mdsSyncSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingMetadataSyncs = pending;

  const diffLine = (label: string, value: string | number | null) =>
    value == null ? "" : `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${label}: ${esc(String(value))}</div>`;

  const infoBlock = (r: PendingMetadataSync) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.sift_path)}</div>` +
    diffLine("Artiste", r.new_artist) +
    diffLine("Titre", r.new_title) +
    diffLine("Label", r.new_label) +
    diffLine("Année", r.new_year) +
    diffLine("Genre", r.new_genre) +
    (mdsErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdsErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingMetadataSync): CandidateTrack[] =>
    r.candidate_tracks && r.candidate_tracks.length
      ? r.candidate_tracks
      : (r.candidate_track_ids || "")
          .split(",")
          .filter(Boolean)
          .map((track_id) => ({ track_id, folder_path: null }));

  const ambiguousRows = ambiguous
    .map((r) => {
      const candidateBtns = candidateList(r)
        .map(
          (c) =>
            `<button data-sift="mdsresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${infoBlock(r)}` +
        `<button data-sift="mdsdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRowHtml = (r: PendingMetadataSync) => {
    const checked = mdsSyncSel.has(r.id);
    return (
      `<div class="bx-row" data-sift="mdspick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
        checked ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
      infoBlock(r) +
      `<button data-sift="mdsdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
      `</div>`
    );
  };

  const pendingRows = [...groupBySession(pending).entries()]
    .map(([sid, rows]) => sessionGroupHtml(sid, rows, mdsSyncSel, mdsExpandedGroups, "mdsgrouptoggle", "mdsgroupselect", pendingRowHtml))
    .join("");

  const applyBar =
    mdsSyncSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="mdsapply" style="font-weight:500">Appliquer la sélection (${mdsSyncSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Synchros metadata master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}

/** M8 Tier 3 (pochette) section: lists master.db artwork sync candidates detected passively
 * whenever Sift writes a NEW cover onto a file linked to Rekordbox. Independent of
 * metadataSyncsSectionHtml (separate table, separate detector — a text-only retag never lands
 * here). Renders "" when nothing pending/ambiguous. */
function artworkSyncsSectionHtml(rows: PendingArtworkSync[]): string {
  if (rows.length === 0) return "";
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of [...masSyncSel]) if (!liveIds.has(id)) masSyncSel.delete(id);

  const ambiguous = rows.filter((r) => r.status === "ambiguous");
  const pending = rows.filter((r) => r.status === "pending");
  lastPendingArtworkSyncs = pending;

  const coverFileName = (p: string) => p.split(/[\\/]/).pop() || p;

  const infoBlock = (r: PendingArtworkSync) =>
    `<div style="min-width:0;flex:1">` +
    `<div style="font-family:var(--font-mono);font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.sift_path)}</div>` +
    `<div style="font-size:var(--text-xs);color:var(--color-text-tertiary)">Nouvelle pochette : ${esc(coverFileName(r.cover_path))}</div>` +
    (masErrorById.has(r.id)
      ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(masErrorById.get(r.id)!)}</div>`
      : "") +
    `</div>`;

  const candidateList = (r: PendingArtworkSync): CandidateTrack[] =>
    r.candidate_tracks && r.candidate_tracks.length
      ? r.candidate_tracks
      : (r.candidate_track_ids || "")
          .split(",")
          .filter(Boolean)
          .map((track_id) => ({ track_id, folder_path: null }));

  const ambiguousRows = ambiguous
    .map((r) => {
      const candidateBtns = candidateList(r)
        .map(
          (c) =>
            `<button data-sift="masresolve" data-id="${r.id}" data-track="${esc(c.track_id)}" style="display:block;text-align:left;font-family:var(--font-mono);font-size:var(--text-xs)">` +
            `Choisir cette piste — ${esc(c.folder_path || c.track_id)}</button>`,
        )
        .join("");
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px">` +
        `<div style="display:flex;gap:10px;align-items:flex-start">${infoBlock(r)}` +
        `<button data-sift="masdismiss" data-id="${r.id}" style="flex:none">Ignorer</button></div>` +
        `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${candidateBtns}</div>` +
        `</div>`
      );
    })
    .join("");

  const pendingRowHtml = (r: PendingArtworkSync) => {
    const checked = masSyncSel.has(r.id);
    return (
      `<div class="bx-row" data-sift="maspick" data-id="${r.id}" tabindex="0" role="checkbox" aria-checked="${checked}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--border-radius-md);cursor:pointer;${
        checked ? "background:var(--overlay-hover)" : ""
      }">` +
      `<input type="checkbox" class="sift-batch-ck" ${checked ? "checked" : ""} tabindex="-1">` +
      infoBlock(r) +
      `<button data-sift="masdismiss" data-id="${r.id}" style="flex:none">Ignorer</button>` +
      `</div>`
    );
  };

  const pendingRows = [...groupBySession(pending).entries()]
    .map(([sid, rows]) => sessionGroupHtml(sid, rows, masSyncSel, masExpandedGroups, "masgrouptoggle", "masgroupselect", pendingRowHtml))
    .join("");

  const applyBar =
    masSyncSel.size > 0
      ? `<div style="margin-top:8px"><button data-sift="masapply" style="font-weight:500">Appliquer la sélection (${masSyncSel.size})</button></div>`
      : "";

  return (
    `<div style="margin-bottom:12px">` +
    `<div class="col-h">Synchros pochette master.db en attente</div>` +
    (ambiguousRows ? `<div style="margin-bottom:8px">${ambiguousRows}</div>` : "") +
    pendingRows +
    applyBar +
    `</div>`
  );
}

/** M8 Tier 2 section: lists playlists where the same track appears more than once
 * (rekordbox_masterdb_scan_playlist_duplicates, read-only, scanned fresh on every render — no
 * persistence, see docs/superpowers/plans/2026-07-08-m8-tier2-ipc-wiring.md). One button per
 * group, no multi-select (unlike Tier 1's masterdbRepairsSectionHtml): each dedup is a complete,
 * independent action, and there are typically 0-2 groups at a time. Renders "" when there is
 * nothing to dedup, same show-nothing-when-empty rule as masterdbRepairsSectionHtml. */
function playlistDuplicatesSectionHtml(groups: PlaylistDuplicateGroupDto[]): string {
  if (groups.length === 0) return "";
  const rows = groups
    .map((g, i) => {
      const key = duplicateGroupKey(g);
      const playlistLabel = g.playlist_name || `Playlist ${g.playlist_id}`;
      const trackLabel = g.track_path ? g.track_path.split(/[\\/]/).pop() || g.track_path : `Piste ${g.content_id}`;
      const count = g.remove.length;
      return (
        `<div style="border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:9px 11px;margin-bottom:6px;display:flex;gap:10px;align-items:center">` +
        `<div style="min-width:0;flex:1">` +
        `<div style="font-size:var(--text-sm)">${esc(playlistLabel)}</div>` +
        `<div style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(trackLabel)} — ${count} doublon${count > 1 ? "s" : ""}</div>` +
        (mdbDedupErrorByKey.has(key)
          ? `<div style="font-size:var(--text-xs);color:var(--color-text-danger);margin-top:2px">${esc(mdbDedupErrorByKey.get(key)!)}</div>`
          : "") +
        `</div>` +
        `<button data-sift="mdbdedup" data-idx="${i}" style="flex:none">Dédupliquer</button>` +
        `</div>`
      );
    })
    .join("");
  return `<div style="margin-bottom:12px"><div class="col-h">Doublons dans les playlists</div>${rows}</div>`;
}

/** Rekordbox integration page (data-view="rkb") — real screen replacing the old one-click nav
 * export (audit 2026-07-05, docs/superpowers/specs/2026-07-05-rekordbox-integration-page-design.md).
 * Renders the whole page fresh each call, same pattern as renderBiblioLive/renderJournal — no mock
 * DOM survives. `drift_detected` is independent of linked/error, so the banner can appear on top
 * of either linked state (never modeled as a 4-way exclusive if/else). */
export async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
  } catch (e) {
    console.error("rekordbox_status failed", e);
    content.innerHTML =
      `<div class="h1">Rekordbox</div>` +
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary)">Statut Rekordbox indisponible.</div>`;
    return;
  }

  const intro =
    `<div class="h1">Rekordbox</div>` +
    `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);margin-bottom:12px">` +
    `Sift convertit tes morceaux → l'export fusionne les nouveaux dans le XML lié → réimporte-le dans Rekordbox pour les voir apparaître.` +
    `</div>`;

  if (!status.linked) {
    content.innerHTML =
      intro +
      emptyStateHtml({
        title: "Aucun XML Rekordbox lié",
        note: "Relie le fichier XML exporté depuis Rekordbox pour commencer à synchroniser tes conversions.",
        actionHtml: `<button data-bib="rkblink">Lier un fichier XML Rekordbox</button>`,
      });
    wireEmptyState(content);
    return;
  }

  const driftBanner = status.drift_detected
    ? `<div class="sift-dup-banner" style="background:var(--color-background-warning)">` +
      `<i class="ti ti-alert-triangle" style="color:var(--color-text-warning)"></i>` +
      `<div class="sift-dup-banner-body">` +
      `<div class="sift-dup-banner-head" style="color:var(--color-text-warning)">Une correction de chemin a échoué lors d'une conversion récente</div>` +
      // .sift-dup-banner-where is built for a truncated file path (nowrap+ellipsis) — this is a
      // full sentence, the entire payload of a warning that was previously invisible anywhere in
      // the UI, so it must never silently clip on a narrow window.
      `<div class="sift-dup-banner-where" style="white-space:normal;overflow:visible;text-overflow:clip">Vérifie les pistes déplacées dans Rekordbox.</div>` +
      `</div></div>`
    : "";

  let masterdbSection = "";
  try {
    const repairs = await rekordboxMasterdbPendingRepairs();
    masterdbSection = masterdbRepairsSectionHtml(repairs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_repairs failed", e);
  }

  let dedupSection = "";
  try {
    lastScannedDuplicateGroups = await rekordboxMasterdbScanPlaylistDuplicates();
    dedupSection = playlistDuplicatesSectionHtml(lastScannedDuplicateGroups);
  } catch (e) {
    console.error("rekordbox_masterdb_scan_playlist_duplicates failed", e);
    lastScannedDuplicateGroups = [];
  }

  let metadataSyncSection = "";
  try {
    const syncs = await rekordboxMasterdbPendingMetadataSyncs();
    metadataSyncSection = metadataSyncsSectionHtml(syncs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_metadata_syncs failed", e);
  }

  let artworkSyncSection = "";
  try {
    const artworkSyncs = await rekordboxMasterdbPendingArtworkSyncs();
    artworkSyncSection = artworkSyncsSectionHtml(artworkSyncs);
  } catch (e) {
    console.error("rekordbox_masterdb_pending_artwork_syncs failed", e);
  }

  content.innerHTML = intro + driftBanner + rekordboxCardHtml(status) + masterdbSection + dedupSection + metadataSyncSection + artworkSyncSection;
}
