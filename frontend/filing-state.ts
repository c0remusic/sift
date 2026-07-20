import type { Canonical, Target, QueueItem, FileTags } from "../shared/contracts";

/** Shared, mutable Revue state for the current filing session. Destination-selection state
 *  (library root, bin list, selected bin, "sur place" flag) moved to filing-bins.ts's own
 *  DestState (tech-debt audit F03 — god-file split, first tranche). */
export interface RevueState {
  track: QueueItem | null; // currently open track
  canonical: Canonical | null; // reconciled (then user-edited) metadata
  target: Target | null; // format override (null = backend rail default)
  // Analysed rail of the open track ("lossless" | "lossy" | "unknown"), set in openFilingInto. The
  // single source for the default format when target is null — used by BOTH the lit chip and the
  // Final-name preview (defaultTarget) so they never disagree on open.
  rail: string;
  // Read-only Discogs release facts for the open track. NOT part of Canonical (which drives the
  // filename/tags and is a Rust-mirrored contract) — kept here so the editor can show them. Loaded
  // from `releaseCache` on open, or set from `applied` on identify; null = unknown (no display).
  label: string | null;
  year: number | null;
  // Country/format of the applied release (e.g. "UK", "Vinyl, 12\", EP") — same session-cache-only
  // scope as label/year above, except there is no persisted backend column for these two (Rust
  // TrackRelease has none): they survive a close+reopen within this session (releaseCache) but not
  // an app restart, until/unless the metadata table grows matching columns (2026-07-06 annotation:
  // previously these were shown in the candidate list, then dropped the instant a candidate got
  // selected — kept here so the read-only release line below Genres keeps showing them afterwards).
  releaseCountry: string | null;
  releaseFormat: string | null;
  // Cover of the applied/persisted release — needed to re-run restoreIdentifiedLine() outside the
  // openFilingInto cold-open path (2026-07-06 annotation: reopening the Métadonnées zone re-renders
  // the editor and must be able to redraw the "Identifié :" confirmation line the same way).
  coverPath: string | null;
  // The would-write sub-genres for the open track (DB track_genres order), shown in .sift-genres and
  // compared (joined) against the file. Set on open from track_release, or from `applied.styles`.
  genres: string[];
  // The file's REAL tags, snapshotted ONCE on open (and re-read after an Apply/File). The marker
  // compares the displayed identity to THIS in-memory snapshot — never a per-keystroke disk read.
  // null until the open-time read resolves.
  fileTags: FileTags | null;
  // After a Detail-mode filing, the just-filed track's batch_id + bin label → drives the
  // persistent "Filed ↩" confirmation in #mid (targeted revert via the journal). Null = none up.
  filedConfirm: { batchId: string; bin: string } | null;
  // True once a Discogs identity is applied to the open track (fresh fetch OR persisted-identified
  // reopen). Gates the "rebuy on Beatport" link: searching a raw filename is useless — only a
  // confirmed artist+title is worth a store search.
  identified: boolean;
}

export const state: RevueState = {
  track: null,
  canonical: null,
  target: null,
  rail: "unknown",
  label: null,
  year: null,
  releaseCountry: null,
  releaseFormat: null,
  coverPath: null,
  genres: [],
  fileTags: null,
  filedConfirm: null,
  identified: false,
};

// Bumped on every open; an in-flight open/action bails at its await points if a newer one started
// (prevents a slow analyze/reconcile/applyIdentity/applyTags/revert from clobbering the pane of a
// track opened since). `acting` guards against a double-click firing two encodes (one action at a
// time). Grouped into one object (not two module-level `let`s) — see file header comment above.
export const openState = { openSeq: 0, acting: false };
