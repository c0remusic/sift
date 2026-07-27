// Wire contract — mirror of src-tauri/src/ipc.rs serde structs.
// Keep field names and types in sync with the Rust side. Bump when the Rust side changes.

/** Sentinel `binRel` meaning "file in place" (destination = each track's own source folder).
 * Mirror of Rust `filing::FILE_IN_PLACE`; the two literals MUST stay identical. Travels through
 * the normal `binRel` channel — no separate flag — and the backend resolves it in `plan_file`. */
export const FILE_IN_PLACE = "__SOURCE__";

/** Prefix marking `binRel` as a trusted absolute path OUTSIDE the library root ("Parcourir un
 * autre dossier…"). Mirror of Rust `filing::EXTERNAL_DEST_PREFIX`; the two literals MUST stay
 * identical. Trust boundary: build this value ONLY from a path returned by the Tauri directory
 * picker dialog (an existing directory the user navigated to and selected) — never from
 * free-typed text. The backend still re-validates the path exists before use. */
export const EXTERNAL_DEST_PREFIX = "__EXTERNAL__::";

export interface AppInfo {
  name: string;
  version: string;
}

export interface DbHealth {
  schema_version: number;
  tables: number;
}

export interface Source {
  id: number;
  path: string;
  pending_count: number;
  accessible: boolean;
  watched: boolean;
  color_key: string | null;
}

export interface QueueItem {
  id: number;
  path: string;
  filename: string | null;
  source_id: number | null;
  verdict: "ok" | "fake" | "grey" | null;
  /** Declared rail, NULL until analysed. Drives batch grouping + output format. */
  rail: "lossless" | "lossy" | "unknown" | null;
  /** Identified artist/title (metadata table), NULL until identified — the "after" name. */
  artist: string | null;
  title: string | null;
  /** Shares a name with another pending/filed track (dedup name pre-filter). */
  dup: boolean;
  /** True when there's no current, usable verdict for this track: not-yet-analysed, due for
   *  re-analysis (content changed), OR a permanently-stuck decode failure the worker will never
   *  retry on its own (verdict stays null but analyzed_at/report_json get set — see
   *  queue.rs::QueueItem's own doc comment for the full backend rationale). Single source of
   *  truth for "offer a re-analyze affordance" — never re-derive this from `verdict` alone. */
  needs_analysis: boolean;
  /** Number of failed analyses so far. `>= MAX_ANALYSIS_ATTEMPTS` means terminally broken: still
   *  individually retryable (a per-row retry resets it to 0), but excluded from the count and the
   *  bulk "Réanalyser (N)" so a genuinely unrepairable file stops inflating "Non analysés (N)". */
  analysis_attempts: number;
}

/** Mirror of queue.rs::MAX_ANALYSIS_ATTEMPTS. After this many failures a stuck track drops out of
 *  the unanalysed count / bulk retry (a manual per-row retry clears the counter for a fresh try). */
export const MAX_ANALYSIS_ATTEMPTS = 3;

/** Best duplicate match for a track. kind: "name" (names agree) or "both" (name + sound). */
export interface DupMatch {
  id: number;
  status: string;
  folder: string | null;
  filename: string | null;
  kind: "name" | "both";
  score: number;
}

export interface AnalysisProgress {
  done: number;
  total: number;
}

export interface Spectrogram {
  frames: number;
  bins: number;
  hz_per_bin: number;
  sec_per_frame: number;
  /** frames*bins, row-major, 0..255 (-100..0 dBFS). Travels on the wire as an RFC1924 base85
   *  string (Rust side: `#[serde(with = "crate::b85_bytes")]` on analysis/mod.rs Spectrogram),
   *  decoded EXACTLY ONCE in frontend/ipc.ts analyzePath — nothing downstream ever sees the
   *  string form. Indexing stays `mag_db[f * bins + b]`, unchanged. */
  mag_db: Uint8Array;
}

// Mirror of src-tauri/src/analysis/mod.rs AnalysisReport (M2a).
export interface AnalysisReport {
  path: string;
  sample_rate: number;
  channels: number;
  duration_sec: number;
  declared_format: string;
  declared_bitrate: number | null;
  declared_rail: "lossless" | "lossy" | "unknown";
  cutoff_hz: number;
  verdict: "ok" | "fake" | "grey";
  /** True when declared_rail is "lossless" but the real container (magic-byte sniffed) is
   *  lossy — the specific Fake cause where the cutoff can sit near Nyquist, unlike a genuine
   *  spectral-cliff transcode. Mirrors the Rust condition, don't recompute in TS. */
  container_mismatch: boolean;
  /** Equivalent lossy bitrate estimated from cutoff_hz (FIX-11: computed in Rust, single
   *  source of truth shared with the verdict logic — don't recompute this in TS). */
  est_kbps: number;
  peaks: number[];
  spectrogram: Spectrogram;
  clip_runs: number;
  clip_pct: number;
  true_peak_dbtp: number;
  dc_offset: number;
  phase_correlation: number;
  dual_mono: boolean;
  container_ok: boolean;
  codec_error: string | null;
  truncated: boolean;
  silence_head_ms: number;
  silence_tail_ms: number;
  id3_version: string | null;
  tags_cdj_ok: boolean;
  has_cover: boolean;
}

// ---- M4 filing loop (mirror of naming.rs / encode.rs / library.rs / actions.rs) ----

/** Output rail shapes. Serde-renamed on the Rust side (see encode.rs Target). */
export type Target = "mp3_320" | "aiff_16_44" | "wav_16_44";

/** How sure reconciliation is about the metadata — green files in one click. */
export type Confidence = "green" | "yellow";

/** Canonical {artist,title,version} that drives BOTH the output filename and the tags. */
export interface Canonical {
  artist: string;
  title: string;
  version: string | null;
  confidence: Confidence;
}

/** A destination folder under the library root (recursive). */
export interface Bin {
  rel: string; // forward-slash path relative to root, e.g. "House/Deep"
  name: string; // last component
  depth: number; // 1 = direct child
}

/** Result of filing one track. */
export interface FileResult {
  path: string;
  batch_id: string;
}

/** Result of filing a batch: how many filed, and the ids left needing validation. `cancelled` is
 *  true when the run was stop-net cancelled before processing every id (the result is then partial;
 *  nothing is rolled back). */
export interface BatchResult {
  filed: number;
  needs_validation: number[];
  cancelled: boolean;
}

/** Per-file filing progress (mirror of ipc_filing.rs FileProgress). `done` = files processed so
 *  far (filed or bounced), `total` = batch size. Drives the global progress zone's "file" row. */
export interface FileProgress {
  done: number;
  total: number;
}

/** Result of rejecting a batch: how many marked for re-sourcing, and the ids that failed. */
export interface RejectBatchResult {
  rejected: number;
  failed: number[];
}

/** One rejected/trashed track for the Écartés view. */
export interface EcarteItem {
  id: number;
  path: string;
  filename: string | null;
  status: "resourcing" | "trash";
  verdict: "ok" | "fake" | "grey" | null;
  truncated: boolean;
  artist: string;
  title: string;
}

/** One consultable undo-journal entry (a live batch, summarized by its first action). */
export interface JournalEntry {
  batch_id: string;
  track_id: number | null;
  /** First action type of the batch — determines display category.
   *  "convert"|"move" → Filés; "trash" → Jetés; "reject" → Rejetés. */
  kind: "convert" | "move" | "trash" | "reject";
  from_path: string | null;
  to_path: string | null;
  ts: string;
  session_id: string | null;
  /** Distinct track count in the batch — used to gate the last-batch confirmation on > 10. */
  track_count: number;
}

// ---- M6b library browser (mirror of library.rs) ----

export interface LibraryTrack {
  id: number;
  path: string;
  artist: string | null;
  title: string | null;
  format: string | null;
  bitrate: number | null;
  duration: number | null;
  bpm: number | null;
  year: number | null;
  label: string | null;
  genres: string[];
  discogs_release_id: string | null;
  cover_path: string | null;
  has_cover: boolean;
  verdict: string | null;
  folder: string | null;
}

/** Read-only identity + release facts for a track, from the persisted `metadata` table. Mirror of
 * Rust `ipc_filing::TrackRelease`. `identified` = a Discogs release was chosen → the front trusts
 * `artist`/`title` here over reconcile (which recomputes from the still-untouched file tags). All
 * null / `identified:false` when there is no metadata row. `version` is the remix/dub split off the
 * chosen Discogs title and persisted in the `metadata.version` column, so the picked release survives
 * a close+reopen; the front falls back to reconcile's version when it is null. NOT folded into
 * `Canonical`. */
export interface TrackRelease {
  artist: string | null;
  title: string | null;
  version: string | null;
  label: string | null;
  year: number | null;
  cover_path: string | null;
  /** The track's sub-genres in stored order — the same list write_tags_full joins into the file's
   * Genre field. Shown on open; the joined form feeds the file-vs-display discrepancy check. */
  genres: string[];
  identified: boolean;
}

/** The file's REAL tag values (the fields write_tags_full owns), read once on open via
 * `track_file_tags`. Compared IN MEMORY against the displayed identity to flag tags not yet written
 * to the file (no per-keystroke disk read). `genre_joined` is the single Genre field exactly as the
 * file holds it (write_tags_full's joined "A; B" form). Mirror of Rust `ipc_filing::FileTags`. */
export interface FileTags {
  artist: string | null;
  title: string | null;
  label: string | null;
  year: number | null;
  genre_joined: string | null;
}

export interface LibraryFolder { name: string; count: number; }
export interface LibraryFacets { folders: LibraryFolder[]; genres: LibraryFolder[]; artists: LibraryFolder[]; }

export interface LibraryFilter {
  folder?: string | null;
  quality?: "lossless" | "mp3" | null;
  genre?: string | null;
  q?: string | null;
  verdict?: "fake" | null;
  artist?: string | null;
}

/** User-edited metadata for a filed track (Bibliothèque inline edit). Mirror of
 * src-tauri/src/metadata/mod.rs MetadataEdit. The backend writes the file tags first,
 * then the DB — and preserves discogs_release_id/source (a manual edit never wipes the link). */
export interface MetadataEdit {
  artist: string;
  title: string;
  label: string | null;
  year: number | null;
  genres: string[];
  cover_path: string | null;
}

// ---- M6b Lot 3: internal duplicates (mirror of src-tauri/src/dedup.rs) ----

export interface DupGroupMember {
  id: number;
  path: string;
  filename: string | null;
  folder: string | null;
  format: string | null;
  bitrate: number | null;
  duration: number | null;
  truncated: boolean;
  recommend_keep: boolean;
  reason: string | null;
}

export interface DupGroup {
  members: DupGroupMember[];
  similarity: number;
}

// ---- M6b Lot 4: dashboard (mirror of src-tauri/src/library.rs) ----

export interface GenreCount { genre: string; count: number; }

export interface DashboardStats {
  total: number;
  lossless: number;
  mp3: number;
  duplicates: number;
  fake: number;
  genres: GenreCount[];
}

// ---- M7 Rekordbox XML export + playlist path repair (mirror of src-tauri/src/ipc_library.rs) ----

export interface RekordboxLinkStatus {
  path: string | null;
  linked: boolean;
  playlist_count: number;
  track_count: number;
  error: string | null;
  /** True when a prior filing/move's Rekordbox repair hit an ambiguous match and could not
   *  safely patch the linked XML — surfaced as a warning banner (see Task 3). */
  drift_detected: boolean;
}

// ---- M8 Tier 1 master.db path-repair candidates (mirror of src-tauri/src/ipc_library.rs) ----

export interface CandidateTrack {
  track_id: string;
  folder_path: string | null;
}

export interface PendingMasterdbRepair {
  id: number;
  track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  from_path: string;
  to_path: string;
  status: "pending" | "ambiguous";
  detected_at: string;
  /** The Sift app session that produced this candidate — null for pre-migration rows. */
  session_id: string | null;
}

export interface ApplyRepairOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}

// ---- M8 Tier 3 master.db metadata sync candidates (mirror of src-tauri/src/ipc_library.rs) ----

export interface PendingMetadataSync {
  id: number;
  track_id: number;
  sift_path: string;
  rekordbox_track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  new_artist: string | null;
  new_title: string | null;
  new_label: string | null;
  new_year: number | null;
  new_genre: string | null;
  status: "pending" | "ambiguous";
  detected_at: string;
  /** The Sift app session that produced this candidate — null for pre-migration rows. */
  session_id: string | null;
}

export interface ApplyMetadataSyncOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}

// ---- M8 Tier 3 master.db artwork sync candidates (mirror of src-tauri/src/rekordbox_repairs.rs) ----

export interface PendingArtworkSync {
  id: number;
  track_id: number;
  sift_path: string;
  rekordbox_track_id: string | null;
  candidate_track_ids: string | null;
  candidate_tracks: CandidateTrack[] | null;
  cover_path: string;
  status: "pending" | "ambiguous";
  detected_at: string;
  /** The Sift app session that produced this candidate — null for pre-migration rows. */
  session_id: string | null;
}

export interface ApplyArtworkSyncOutcome {
  id: number;
  ok: boolean;
  error: string | null;
}

// ---- M8 Tier 2 playlist duplicate-entry dedup (mirror of src-tauri/src/ipc_library.rs) ----

export interface PlaylistDuplicateEntryDto {
  song_playlist_id: string;
  track_no: number;
}

export interface PlaylistDuplicateGroupDto {
  playlist_id: string;
  playlist_name: string | null;
  content_id: string;
  track_path: string | null;
  keep: PlaylistDuplicateEntryDto;
  remove: PlaylistDuplicateEntryDto[];
}
