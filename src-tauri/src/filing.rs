//! Turn a reviewed track into a filed library file: ① convert (only if not conformant)
//! → ② tag + name → ③ move into the chosen bin, recording every step as one undoable
//! batch (see actions.rs). Mono-location: conformant files are moved; converted files
//! land in the bin and the original goes to `.sift-trash` (restorable via undo). Composes
//! naming/encode/tagging/library/actions/settings.

use crate::encode::{self, EncodeError, Target};
use crate::naming::{self, Canonical};
use crate::{actions, library, tagging};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Sentinel destination meaning "file in place": the track's destination is its OWN source
/// folder, not a bin under the library root. Travels through `bin_rel` like any other
/// destination (the single decision channel) — `plan_file` resolves it instead of `safe_join`.
/// The frontend mirrors this exact literal (`shared/contracts.ts` `FILE_IN_PLACE`); keep them
/// in sync. Must never reach `library::safe_join` (it would create a literal `__SOURCE__` dir).
pub const FILE_IN_PLACE: &str = "__SOURCE__";

/// Prefix marking `bin_rel` as a trusted absolute path OUTSIDE the library root, chosen via a
/// native OS directory picker ("Parcourir un autre dossier…") — the ONE deliberate hole in
/// `safe_join`'s anti-traversal boundary (`library::safe_join` rejects every other absolute or
/// `..`-containing path by design, see its tests). Trust boundary: the frontend must build this
/// value ONLY from a path the Tauri dialog plugin returned (an existing directory the user
/// navigated to and selected), never from free-typed or otherwise user-suppliable text — see
/// `shared/contracts.ts`'s mirror of this exact literal. `plan_file` still re-validates the path
/// actually exists and is a directory before use (defense in depth: the folder could have been
/// deleted or unmounted between the moment it was picked and the moment a file lands there).
pub const EXTERNAL_DEST_PREFIX: &str = "__EXTERNAL__::";

/// Why filing could not complete (nothing is left half-filed on these — see ordering).
#[derive(Debug, Clone, PartialEq)]
pub enum FilingError {
    NotFound,
    Upscale,
    /// The source's declared rail (from its extension) diverges from what its content actually
    /// is (lossy content behind a lossless extension — the BUG-1 scenario: e.g. an MP3 renamed
    /// `.flac`). Distinct from `Upscale`: this is a WARN-and-confirm case (FIX-1, option B), not
    /// a hard refusal — the caller can retry `plan_file` with `allow_rail_mismatch=true` once the
    /// user has explicitly confirmed. Stable sentinel string (`"RAIL_MISMATCH"`, mirrors the
    /// existing `"NoLibraryRoot"` convention) so the front can pattern-match it distinctly from
    /// other filing errors.
    RailMismatch,
    Encode(String),
    Tag(String),
    Io(String),
    Db(String),
}

impl std::fmt::Display for FilingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FilingError::NotFound => write!(f, "track not found"),
            FilingError::Upscale => write!(f, "refused: cannot upscale lossy to lossless"),
            FilingError::RailMismatch => write!(f, "RAIL_MISMATCH"),
            FilingError::Encode(m) => write!(f, "encode: {m}"),
            FilingError::Tag(m) => write!(f, "tag: {m}"),
            FilingError::Io(m) => write!(f, "io: {m}"),
            FilingError::Db(m) => write!(f, "db: {m}"),
        }
    }
}

impl From<rusqlite::Error> for FilingError {
    fn from(e: rusqlite::Error) -> Self {
        FilingError::Db(e.to_string())
    }
}

/// Result of filing one track.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileResult {
    pub path: String,
    pub batch_id: String,
}

/// Outcome of a batch filing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BatchResult {
    pub filed: usize,
    pub needs_validation: Vec<i64>,
    /// True when the run was stop-net cancelled before processing every id (the summary is then
    /// partial: what was filed before the stop stays filed — nothing is rolled back).
    pub cancelled: bool,
}

/// Outcome of a batch reject (re-sourcing): how many were marked, and which ids failed — so the
/// UI can flag a misfire instead of silently dropping it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectBatchResult {
    pub rejected: usize,
    pub failed: Vec<i64>,
}

/// Source path of a track by id. Exposed so an IPC command can resolve the path under the DB
/// lock and then release it before touching the file (see `ipc_filing::reconcile` /
/// `ipc_filing::trash_track`) — the same plan/execute/commit split as `file_track`.
pub fn track_path(conn: &Connection, track_id: i64) -> Result<String, FilingError> {
    conn.query_row(
        "SELECT path FROM tracks WHERE id=?1",
        params![track_id],
        |r| r.get(0),
    )
    .map_err(|_| FilingError::NotFound)
}

/// Lowercased extension (no dot) of a path.
fn ext_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Filename (with extension) component of a path.
fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string()
}

/// A unique batch id: track id + millis + a process-monotonic counter, so two filings of the
/// same track within the same millisecond (file → undo → re-file) can never share a batch_id.
/// Shared with `apply_tags` so a tag-edit batch gets the same collision-free id scheme.
pub(crate) fn new_batch_id(track_id: i64) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{track_id}-{ms}-{seq}")
}

/// Reconcile a track's canonical metadata from its embedded tags + filename. Used to pick
/// the green/yellow confidence and to seed the editable fields.
pub fn reconcile_track(conn: &Connection, track_id: i64) -> Result<Canonical, FilingError> {
    let path = track_path(conn, track_id)?;
    Ok(reconcile_path(&path))
}

/// The reconcile of an ALREADY-RESOLVED path: reads the file's embedded tags (disk I/O) and its
/// filename stem. No DB access at all, so a caller that resolved the path under the lock can
/// release it before calling this — see `ipc_filing::reconcile`.
pub fn reconcile_path(path: &str) -> Canonical {
    let (artist, title) = tagging::read_artist_title(path);
    let stem = Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    naming::reconcile(&artist, &title, &stem)
}

/// Centralised trash directory: `{Documents}/Sift/Trash` on all platforms.
/// Falls back to `{home}/Documents/Sift/Trash` if `dirs::document_dir()` returns None.
fn sift_trash_dir() -> Result<PathBuf, FilingError> {
    let base = dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .ok_or_else(|| FilingError::Io("cannot locate Documents folder".into()))?;
    Ok(base.join("Sift").join("Trash"))
}

/// Copy `source` to `dest`, verify the copy's size matches, then delete `source`. Cross-disk
/// safe (no rename). On any failure the partial `dest` is cleaned up (best-effort) and `source`
/// is left untouched.
fn copy_verify_delete(source: &str, dest: &Path) -> Result<(), FilingError> {
    let src_len = std::fs::metadata(source)
        .map_err(|e| FilingError::Io(format!("stat source: {e}")))?
        .len();

    std::fs::copy(source, dest).map_err(|e| FilingError::Io(format!("copy: {e}")))?;

    let dst_len = match std::fs::metadata(dest) {
        Ok(m) => m.len(),
        Err(e) => {
            let _ = std::fs::remove_file(dest);
            return Err(FilingError::Io(format!("stat copy: {e}")));
        }
    };

    if dst_len != src_len {
        let _ = std::fs::remove_file(dest);
        return Err(FilingError::Io(format!(
            "copy size mismatch (src {src_len} != dst {dst_len})"
        )));
    }

    std::fs::remove_file(source)
        .map_err(|e| FilingError::Io(format!("remove source after copy: {e}")))
}

/// FIX-10: move `source` to `dest`, trying `rename` first (fast, same-device) and falling back
/// to `copy_verify_delete` only on a genuine cross-device error (Windows os error 17
/// `ERROR_NOT_SAME_DEVICE`, Unix os error 18 `EXDEV`) — a conformant filing or a rollback can
/// cross from the source's disk to the library's (or back), where a plain rename hard-fails.
fn move_cross_disk_safe(source: &str, dest: &Path) -> Result<(), FilingError> {
    match std::fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(e) if matches!(e.raw_os_error(), Some(17) | Some(18)) => {
            copy_verify_delete(source, dest)
        }
        Err(e) => Err(FilingError::Io(e.to_string())),
    }
}

/// FS-only: copy `source` into `<Documents>/Sift/Trash/<track_id>__<name>` (collision-free),
/// verify the copy size, then delete the source. Cross-disk safe (no rename) — the trash dir is
/// virtually always on a different disk than the library, so skip straight to copy_verify_delete
/// instead of trying (and failing) rename first every time.
/// Returns the trash path. No DB — journaling is the caller's job.
/// FIX-6: no `root` param — the trash dir is centralized under Documents, never under the
/// library root, so a `root` argument was resolved and threaded through 3 callers for nothing.
///
/// This is the EXECUTE phase of trashing a track (`ipc_filing::trash_track`): the copy is
/// unbounded I/O — a lossless track is tens of megabytes and the trash dir is virtually always
/// on another disk — so it runs with the DB lock released, exactly like `execute_file`'s encode.
/// `commit_trash` then journals the result under the lock.
pub fn trash_file_fs(track_id: i64, source: &str) -> Result<String, FilingError> {
    let trash_dir = sift_trash_dir()?;
    std::fs::create_dir_all(&trash_dir).map_err(|e| FilingError::Io(e.to_string()))?;
    let dest = library::ensure_unique(
        &trash_dir.join(format!("{track_id}__{}", file_name_of(source))),
        None,
    );
    copy_verify_delete(source, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

/// COMMIT phase of trashing a track (under the DB lock): journal the move as a revertable
/// `trash` action and flip the status. `dest` is what `trash_file_fs` returned, so the file is
/// already moved when this runs — which was ALREADY the ordering inside the pre-split
/// `move_to_trash` (FS first, journal second), so the split adds no new "moved but unjournaled"
/// window beyond the lock re-acquisition itself. Both writes here are fast row updates.
pub fn commit_trash(
    conn: &Connection,
    track_id: i64,
    source: &str,
    dest: &str,
) -> Result<(), FilingError> {
    let batch_id = new_batch_id(track_id);
    actions::record(
        conn,
        &batch_id,
        Some(track_id),
        "trash",
        Some(source),
        Some(dest),
    )
    .map_err(|e| FilingError::Db(e.to_string()))?;
    conn.execute(
        "UPDATE tracks SET status='trash' WHERE id=?1",
        params![track_id],
    )?;
    Ok(())
}

/// Persist canonical metadata for a track (upsert into `metadata`).
fn save_metadata(conn: &Connection, track_id: i64, c: &Canonical) -> Result<(), FilingError> {
    conn.execute(
        "INSERT INTO metadata(track_id, artist, title, version) VALUES(?1,?2,?3,?4)
         ON CONFLICT(track_id) DO UPDATE SET artist=excluded.artist, title=excluded.title, version=excluded.version",
        params![track_id, c.artist, c.title, c.version],
    )?;
    Ok(())
}

/// Enrichment tag fields loaded once (under the lock) so phase 2 writes them without DB access.
#[derive(Default, Clone)]
pub struct TagExtras {
    pub label: Option<String>,
    pub year: Option<i64>,
    pub genres: Vec<String>,
    pub cover_path: Option<String>,
}

/// Load the enrichment tag fields (label, year, genres, cover) for a track from the DB. The single
/// source of these values for tag writes — used by both `plan_file` (filing) and `apply_tags` (the
/// in-place ID3 write), so the two write the SAME label/year/genres/cover a track carries.
pub fn load_tag_extras(conn: &Connection, track_id: i64) -> TagExtras {
    TagExtras {
        label: conn
            .query_row(
                "SELECT label FROM metadata WHERE track_id=?1",
                params![track_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten(),
        year: conn
            .query_row(
                "SELECT year FROM metadata WHERE track_id=?1",
                params![track_id],
                |r| r.get::<_, Option<i64>>(0),
            )
            .ok()
            .flatten(),
        genres: crate::genres::get_genres(conn, track_id).unwrap_or_default(),
        cover_path: conn
            .query_row(
                "SELECT cover_path FROM metadata WHERE track_id=?1",
                params![track_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten(),
    }
}

/// A filing decided under the DB lock (phase 1), ready to run lock-free (phase 2) and then
/// be committed under the lock (phase 3). Holding the connection across the multi-second
/// ffmpeg encode would freeze every other DB user (analysis workers + all IPC); splitting
/// lets the slow encode run lock-free. See `ipc_filing::file_track`.
pub struct FilePlan {
    track_id: i64,
    batch_id: String,
    source: String,
    dest: String,
    conformant: bool,
    target: Target,
    canonical: Canonical,
    bin_rel: String,
    extras: TagExtras,
}

impl FilePlan {
    /// The resolved destination path (as it will land on disk). Exposed so the batch dispatcher can
    /// reserve each planned dest across in-flight plans (phase 2 writes it later) — see
    /// `ipc_filing::run_file_batch`.
    pub fn dest_path(&self) -> &str {
        &self.dest
    }

    /// The journal batch id this filing will be recorded under. Settled at PLAN time (not at
    /// commit), which is what lets the interactive path hand it to the front as its acknowledgement
    /// before phase 2/3 have run — see `ipc_filing::file_track`.
    pub fn batch_id(&self) -> &str {
        &self.batch_id
    }

    /// The track this plan files. Read by the asynchronous interactive path to name the track in
    /// its completion event once the plan itself has been moved onto the background thread.
    pub fn track_id(&self) -> i64 {
        self.track_id
    }
}

/// One filesystem effect performed in phase 2, to be journaled in phase 3. `meta` carries the
/// optional JSON payload of the journal's `meta` column — used by the conformant filing's `tag_edit`
/// row to stash the OLD tags (so a revert can restore them); `None` for the plain move/convert/trash.
pub struct FsLog {
    kind: &'static str,
    from: String,
    to: String,
    meta: Option<String>,
}

/// The string value persisted in `tracks.target_format`.
fn target_str(target: Target) -> &'static str {
    match target {
        Target::Mp3320 => "mp3_320",
        Target::Aiff1644 => "aiff_16_44",
        Target::Wav1644 => "wav_16_44",
    }
}

/// Phase 1 (under the DB lock): resolve metadata + the collision-free destination and apply
/// the no-upscale guard. No slow work — only fast DB reads and a `create_dir_all`.
/// `allow_rail_mismatch`: when false (the default from IPC), a source whose extension claims
/// lossless but whose CONTENT is actually lossy (FIX-1 / BUG-1) is refused with
/// `FilingError::RailMismatch` instead of silently filed — the front shows a confirmation and
/// retries with `true` if the user proceeds anyway.
/// Like `library::ensure_unique`, but also treats every path in `reserved` as taken. In a
/// parallel batch, phase 1 (`plan_file`) is resolved serially under the DB lock, yet the file it
/// names is only WRITTEN in the concurrent phase 2 — so a plain `ensure_unique` (FS-existence
/// only) could hand the SAME destination to two tracks that reconcile to the same name (e.g. two
/// copies of one song filed into one bin), because neither file exists on disk yet when the
/// second plan resolves. Reserving each planned dest closes that window: the second plan skips
/// past the first's not-yet-written path. `ignore` keeps the conformant "file in place" self-name
/// exemption. Bounded bump identical to `ensure_unique`'s (" (N)" before the extension).
fn ensure_unique_reserved(
    path: &Path,
    ignore: Option<&Path>,
    reserved: &HashSet<String>,
) -> PathBuf {
    let taken = |p: &Path| reserved.contains(&p.to_string_lossy().to_string());
    // First let ensure_unique settle FS collisions; then bump further past any reserved sibling.
    let mut candidate = library::ensure_unique(path, ignore);
    if !taken(&candidate) {
        return candidate;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str());
    for n in 2..10_000 {
        candidate = match ext {
            Some(e) => parent.join(format!("{stem} ({n}).{e}")),
            None => parent.join(format!("{stem} ({n})")),
        };
        // Not on disk AND not reserved by an earlier in-flight plan.
        if (!candidate.exists() || ignore.is_some_and(|ig| ig == candidate)) && !taken(&candidate) {
            return candidate;
        }
    }
    parent.join(format!("{stem} ({}).bak", std::process::id()))
}

#[allow(clippy::too_many_arguments)] // each param is an independent, orthogonal input to the
                                     // plan (DB handle, library context, track identity, user overrides) — bundling them into a
                                     // struct here would just move the same 8 fields one level up without reducing real complexity.
pub fn plan_file(
    conn: &Connection,
    root: &Path,
    template: &str,
    track_id: i64,
    bin_rel: &str,
    override_target: Option<Target>,
    edited: Option<Canonical>,
    allow_rail_mismatch: bool,
    // Destinations already claimed by earlier plans whose files aren't written yet (phase 2 is
    // deferred/concurrent). Non-empty for the interactive path too since P5: `file_track` is
    // detached, so its phase 2 has not run by the time the next plan is computed (see
    // `ipc_filing::InFlightFilings`). See `ensure_unique_reserved`.
    reserved: &HashSet<String>,
) -> Result<FilePlan, FilingError> {
    let source = track_path(conn, track_id)?;
    let canonical = match edited {
        Some(c) => c,
        None => reconcile_track(conn, track_id)?,
    };

    let source_rail = crate::analysis::tags::rail_from_ext(&ext_of(&source));
    // BUG-1 guard: the extension says lossless, but is the CONTENT actually lossy? (an MP3
    // renamed `.flac` would otherwise sail through and get "converted" into a fabricated
    // lossless AIFF/WAV — exactly what guard_no_upscale below exists to block, except it never
    // sees the real codec because `source_rail` here is extension-derived, not content-derived.)
    // Only probe content when it matters (declared lossless) — skip the extra I/O for a
    // declared-lossy source, where a content mismatch only means an unnecessary downscale, not
    // a fabricated-lossless risk.
    if source_rail == crate::analysis::Rail::Lossless
        && !allow_rail_mismatch
        && crate::analysis::tags::rail_from_content(&source) == crate::analysis::Rail::Lossy
    {
        return Err(FilingError::RailMismatch);
    }
    let target = override_target.unwrap_or_else(|| encode::target_for(source_rail));
    if encode::guard_no_upscale(source_rail, target).is_err() {
        return Err(FilingError::Upscale);
    }

    // A conformant file is MOVED as-is (no transcode), so its container is unchanged — keep its own
    // extension instead of forcing target.ext(). This stops a `.aif` source from being renamed to
    // `.aiff`: with a single possible output name, a blocked revert (external lock, os error 32 —
    // proved in the revert-duplicate relevé) can no longer strand a `.aif` beside a `.aiff`. The
    // conversion path produces a genuinely new file, which keeps the canonical target extension.
    let conformant = encode::is_conformant(&source, target);
    let out_ext = if conformant {
        ext_of(&source)
    } else {
        target.ext().to_string()
    };

    // The single point where the destination directory is decided. The `FILE_IN_PLACE` sentinel
    // means "file into the track's own source folder" — resolve it to `source.parent()` and NEVER
    // route it through `safe_join` (which would sanitize it into a literal `root/__SOURCE__` dir).
    let dest_dir = if bin_rel == FILE_IN_PLACE {
        Path::new(&source)
            .parent()
            .ok_or_else(|| FilingError::Io("source file has no parent directory".into()))?
            .to_path_buf()
    } else if let Some(abs) = bin_rel.strip_prefix(EXTERNAL_DEST_PREFIX) {
        // Trusted external folder (see EXTERNAL_DEST_PREFIX doc) — still re-checked here, not
        // taken on faith: fail loudly if it's gone rather than silently recreating it elsewhere
        // (create_dir_all below would otherwise happily conjure a new, wrong directory).
        let p = PathBuf::from(abs);
        if !p.is_dir() {
            return Err(FilingError::Io(format!(
                "external destination no longer exists: {abs}"
            )));
        }
        p
    } else {
        library::safe_join(root, bin_rel).map_err(FilingError::Io)?
    };
    std::fs::create_dir_all(&dest_dir).map_err(|e| FilingError::Io(e.to_string()))?;
    let filename = naming::render_filename(template, &canonical, &out_ext);
    // Ignore the source itself as a collision ONLY for the conformant (move) path: filing a
    // conformant track in place onto its own (already-correct) name must keep that name, not bump
    // it to " (2)". The non-conformant path ENCODES source → dest, so dest must never equal source
    // (FFmpeg reading and writing the same file would corrupt it) — keep the normal collision bump.
    let ignore_self = if conformant {
        Some(Path::new(&source))
    } else {
        None
    };
    let dest = ensure_unique_reserved(&dest_dir.join(&filename), ignore_self, reserved);

    let extras = load_tag_extras(conn, track_id);

    Ok(FilePlan {
        conformant,
        source,
        dest: dest.to_string_lossy().to_string(),
        target,
        canonical,
        bin_rel: bin_rel.to_string(),
        batch_id: new_batch_id(track_id),
        track_id,
        extras,
    })
}

/// Phase 2 (NO DB lock): the slow work — tag + move, or encode + tag + trash. Leaves the
/// filesystem clean on its own failure (no orphan transcode). Returns the effects to journal.
pub fn execute_file(plan: &FilePlan) -> Result<Vec<FsLog>, FilingError> {
    let mut log = Vec::new();
    if plan.conformant {
        // A conformant filing tags the file IN PLACE then MOVES it — no trashed original to restore
        // from. So capture the OLD tags FIRST (fail clear if unreadable — never file without the net),
        // and journal them as a `tag_edit` row BEFORE the `move`. revert_batch undoes newest-first, so
        // it reverses the move (file back at `source`) THEN restores the old tags at `source` — the
        // exact path the tag_edit row points at. Reuses the B4 snapshot/restore mechanism verbatim.
        let old_tags = tagging::read_tags_full(&plan.source).map_err(FilingError::Tag)?;
        let snapshot = serde_json::to_string(&old_tags)
            .map_err(|e| FilingError::Tag(format!("serialize tag snapshot: {e}")))?;
        log.push(FsLog {
            kind: "tag_edit",
            from: plan.source.clone(),
            to: plan.source.clone(),
            meta: Some(snapshot),
        });
        tagging::write_tags_full(
            &plan.source,
            &plan.canonical.artist,
            &naming::tag_title(&plan.canonical),
            plan.extras.label.as_deref(),
            plan.extras.year,
            &plan.extras.genres,
            plan.extras.cover_path.as_deref(),
        )
        .map_err(FilingError::Tag)?;
        // Le `?` nu manquait ici, et c'etait la seule fenetre du chemin conformant ou les tags
        // etaient DEJA ecrases sur le fichier de l'utilisateur sans que rien ne puisse les
        // remettre. Le deplacement echoue (disque plein, destination verrouillee, permission) et
        // la fonction sortait en laissant le fichier a sa place SOURCE, avec les nouveaux tags
        // ecrits en place — et sans ligne de journal, puisque le journal n'est ecrit qu'en phase 3
        // depuis le `log` RETOURNE. Donc: aucun revert possible depuis l'app, aucune trace, et des
        // tags que l'utilisateur n'a pas demandes sur un fichier qu'il croit intact.
        //
        // `log` porte deja la ligne `tag_edit` avec l'instantane des anciens tags (poussee juste
        // au-dessus, AVANT l'ecriture, precisement pour ce cas). `rollback_fs` sait la rejouer.
        // C'est le meme filet que celui de la phase 3 (commit_file), applique a la seule etape qui
        // en etait privee. Audit 2026-07-28, CR-3.
        if let Err(e) = move_cross_disk_safe(&plan.source, Path::new(&plan.dest)) {
            log::error!(
                "execute_file: move a echoue pour {}, restauration des tags d'origine: {e:?}",
                plan.source
            );
            rollback_fs(&log);
            return Err(e);
        }
        log.push(FsLog {
            kind: "move",
            from: plan.source.clone(),
            to: plan.dest.clone(),
            meta: None,
        });
    } else {
        // transcode into the bin, tag the result, then trash the original (mono-location)
        encode::encode(&plan.source, &plan.dest, plan.target).map_err(|e| match e {
            EncodeError::Upscale => FilingError::Upscale,
            EncodeError::Ffmpeg(m) => FilingError::Encode(m),
        })?;
        if let Err(e) = tagging::write_tags_full(
            &plan.dest,
            &plan.canonical.artist,
            &naming::tag_title(&plan.canonical),
            plan.extras.label.as_deref(),
            plan.extras.year,
            &plan.extras.genres,
            plan.extras.cover_path.as_deref(),
        ) {
            let _ = std::fs::remove_file(&plan.dest); // drop the orphan transcode
            return Err(FilingError::Tag(e));
        }
        log.push(FsLog {
            kind: "convert",
            from: plan.source.clone(),
            to: plan.dest.clone(),
            meta: None,
        });
        match trash_file_fs(plan.track_id, &plan.source) {
            Ok(trash) => log.push(FsLog {
                kind: "trash",
                from: plan.source.clone(),
                to: trash,
                meta: None,
            }),
            Err(e) => {
                let _ = std::fs::remove_file(&plan.dest);
                return Err(e);
            }
        }
    }
    Ok(log)
}

/// Reverse phase-2 filesystem effects (newest first) — used when phase 3 cannot commit.
fn rollback_fs(log: &[FsLog]) {
    for fs in log.iter().rev() {
        match fs.kind {
            // FIX-10: same cross-disk-safe fallback as the forward move — a rollback of the
            // conformant path's rename can cross disks too.
            "move" | "trash" => {
                let _ = move_cross_disk_safe(&fs.to, Path::new(&fs.from));
            }
            "convert" => {
                let _ = std::fs::remove_file(&fs.to);
            }
            // Conformant filing: undo the in-place tag write by restoring the captured old tags at
            // `from` (the file is back there — the move row, newer, was reversed just above). Reuses
            // the B4 restore; best-effort like the rest of this rollback (errors are swallowed).
            "tag_edit" => {
                if let Some(meta) = &fs.meta {
                    if let Ok(snap) = serde_json::from_str::<tagging::TagsSnapshot>(meta) {
                        let _ = tagging::restore_tags(&fs.from, &snap);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Phase 3 (under the DB lock): journal the effects + mark the track filed. On any DB error,
/// reverse the filesystem effects so nothing is left half-filed.
///
/// All DB writes for the track (its journal rows + the `tracks` UPDATE + the `metadata` upsert)
/// run in ONE SQLite transaction (`unchecked_transaction`, since we only hold `&Connection`)
/// instead of 4-5 implicit auto-commits per track — one WAL fsync per track instead of several.
/// A DB error rolls the whole transaction back (no partial journal) AND reverses the filesystem
/// effects, then returns `Db` — the fail-fast contract callers already handle per track.
///
/// The linked-Rekordbox-XML repair (read+parse+rewrite of an external file — disk I/O) is
/// DEFERRED until AFTER the transaction commits, via `actions::maybe_repair_rekordbox_xml`, so
/// the slow file I/O never runs inside the write transaction. Its behaviour is unchanged
/// (`move`/`convert` rows only, `from != to`) — only its timing moves from mid-insert to
/// post-commit. It cannot fail the filing (errors are logged and swallowed, as before).
///
/// `xml_repair_sink`: when `Some`, move/convert `(from, to)` pairs needing an XML repair are
/// pushed here INSTEAD OF being repaired immediately — the caller (`ipc_filing::run_file_batch`)
/// collects them across every track in a batch and repairs the linked XML ONCE via
/// `actions::repair_rekordbox_xml_batch`, instead of once per track (audited 2026-07-05, finding
/// P4: up to 200 independent read+parse+write cycles of the same file on a 200-track batch). `None`
/// preserves the original immediate-repair behaviour, used by the single-file commit path
/// (`ipc_filing::file_track`) where there is only ever one pair, so batching buys nothing.
pub fn commit_file(
    conn: &Connection,
    plan: &FilePlan,
    log: Vec<FsLog>,
    xml_repair_sink: Option<&mut Vec<(String, String)>>,
) -> Result<FileResult, FilingError> {
    let conf = match plan.canonical.confidence {
        naming::Confidence::Green => "green",
        naming::Confidence::Yellow => "yellow",
    };

    // One transaction for every DB write of this track. Dropping it without `commit()` (the `?`
    // early-returns below) rolls back all inserts/updates automatically — no manual DELETE needed.
    let db_result: Result<Vec<i64>, FilingError> = (|| {
        let tx = conn.unchecked_transaction()?;
        let mut action_ids = Vec::with_capacity(log.len());
        for fs in &log {
            let id = actions::record_row_only(
                &tx,
                &plan.batch_id,
                Some(plan.track_id),
                fs.kind,
                Some(&fs.from),
                Some(&fs.to),
                fs.meta.as_deref(),
            )?;
            action_ids.push(id);
        }
        tx.execute(
            "UPDATE tracks SET status='filed', folder=?2, target_format=?3, confidence=?4 WHERE id=?1",
            params![plan.track_id, plan.bin_rel, target_str(plan.target), conf],
        )?;
        save_metadata(&tx, plan.track_id, &plan.canonical)?;
        tx.commit()?;
        Ok(action_ids)
    })();

    let action_ids = match db_result {
        Ok(ids) => ids,
        Err(e) => {
            // Transaction already rolled back the DB rows; reverse the filesystem effects too so
            // nothing is left half-filed.
            rollback_fs(&log);
            return Err(FilingError::Db(e.to_string()));
        }
    };

    // A track just became 'filed' — invalidate the dashboard duplicate-count cache. The cache key
    // (COUNT, MAX(id) of filed) misses an in-place re-filing that leaves both unchanged, so we
    // invalidate explicitly rather than rely on the key changing (coordination with R1's cache).
    crate::library::invalidate_duplicate_count_cache();

    // Committed — now (and only now) patch a linked Rekordbox XML for the move/convert rows, and
    // detect (read-only) any master.db repair candidates for the same rows (M8 Tier 1 IPC wiring),
    // plus (M8 Tier 3) any metadata sync candidate for the tags this commit just wrote. Both
    // detectors need the same decrypted `master.db` index — read it ONCE per commit (not once per
    // detector per row) rather than have each detector independently decrypt the file.
    let masterdb_index = actions::resolve_masterdb_index_if_linked(conn);
    let mut xml_repair_sink = xml_repair_sink;
    for (fs, action_id) in log.iter().zip(action_ids.iter()) {
        match xml_repair_sink.as_mut() {
            Some(sink) => {
                if matches!(fs.kind, "move" | "convert") && fs.from != fs.to {
                    sink.push((fs.from.clone(), fs.to.clone()));
                }
            }
            None => {
                actions::maybe_repair_rekordbox_xml(conn, fs.kind, Some(&fs.from), Some(&fs.to))
            }
        }
        if let Some(index) = &masterdb_index {
            actions::maybe_detect_masterdb_repair_with_index(
                conn,
                index,
                fs.kind,
                Some(&fs.from),
                Some(&fs.to),
                *action_id,
            );
            if matches!(fs.kind, "move" | "convert") {
                let (genre, label) = actions::sanitize_genre_label(
                    &plan.extras.genres,
                    plan.extras.label.as_deref(),
                );
                let values = actions::MetadataSyncValues {
                    artist: Some(plan.canonical.artist.clone()),
                    title: Some(naming::tag_title(&plan.canonical)),
                    label,
                    year: plan.extras.year,
                    genre,
                };
                actions::detect_masterdb_metadata_sync_with_index(
                    conn,
                    index,
                    &fs.from,
                    plan.track_id,
                    &values,
                    *action_id,
                );
                if let Some(cover_path) = &plan.extras.cover_path {
                    actions::detect_masterdb_artwork_sync_with_index(
                        conn,
                        index,
                        &fs.from,
                        plan.track_id,
                        cover_path,
                        *action_id,
                    );
                }
            }
        }
    }
    Ok(FileResult {
        path: plan.dest.clone(),
        batch_id: plan.batch_id.clone(),
    })
}

/// File one track into `bin_rel` under `root`, holding `conn` throughout — a synchronous test
/// convenience that chains the three phases under a single lock. Production never holds the lock
/// across the encode: the interactive path (`ipc_filing::file_track`) and the detached batch
/// (`ipc_filing::run_file_batch`) run the phases with the lock released around it. See module docs
/// for the ordering and the mono-location / undo contract.
#[cfg(test)]
#[allow(clippy::too_many_arguments)] // mirrors plan_file's shape (test-only convenience wrapper)
pub fn file_track(
    conn: &Connection,
    root: &Path,
    template: &str,
    track_id: i64,
    bin_rel: &str,
    override_target: Option<Target>,
    edited: Option<Canonical>,
    allow_rail_mismatch: bool,
) -> Result<FileResult, FilingError> {
    let plan = plan_file(
        conn,
        root,
        template,
        track_id,
        bin_rel,
        override_target,
        edited,
        allow_rail_mismatch,
        &HashSet::new(),
    )?;
    let log = execute_file(&plan)?;
    commit_file(conn, &plan, log, None)
}

/// Canonical metadata persisted by an earlier Discogs identification (the `metadata` table),
/// if present and usable. A Discogs/manual match is a high-confidence name, so it's returned
/// Green — this is what lets a per-track identity applied in Review feed `file_batch` (whose
/// tag-based reconcile would otherwise ignore the applied identity). `None` = no usable row,
/// fall back to reconcile.
fn canonical_from_metadata(
    conn: &Connection,
    track_id: i64,
) -> rusqlite::Result<Option<Canonical>> {
    let row = conn.query_row(
        "SELECT artist, title FROM metadata WHERE track_id=?1",
        params![track_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
            ))
        },
    );
    match row {
        Ok((Some(a), Some(t))) if !a.trim().is_empty() && !t.trim().is_empty() => {
            Ok(Some(Canonical {
                artist: a,
                title: t,
                version: None,
                confidence: naming::Confidence::Green,
            }))
        }
        Ok(_) => Ok(None),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Pick the canonical name to AUTO-file a batch track on, or `None` if it must stay pending for
/// manual review. A track identified via Discogs (persisted in `metadata`) files on that
/// high-confidence name; otherwise the tag/filename reconcile must come out Green. Pure DB read —
/// the detached batch loop (`ipc_filing::file_batch`) calls this under the per-file lock, before
/// planning the file, then runs the same plan/execute/commit phases as the interactive path.
pub fn batch_canonical(conn: &Connection, track_id: i64) -> Option<Canonical> {
    match canonical_from_metadata(conn, track_id) {
        Ok(Some(c)) => Some(c),
        Ok(None) => match reconcile_track(conn, track_id) {
            Ok(c) if c.confidence == naming::Confidence::Green => Some(c),
            _ => None,
        },
        Err(_) => None,
    }
}

/// Mark a track for re-sourcing (goes to Écartés, M4b): status `resourcing` + a `reject`
/// action. The file is not moved at this milestone.
pub fn reject_track(conn: &Connection, track_id: i64) -> Result<(), FilingError> {
    let source = track_path(conn, track_id)?;
    let batch_id = new_batch_id(track_id);
    actions::record(
        conn,
        &batch_id,
        Some(track_id),
        "reject",
        Some(&source),
        None,
    )
    .map_err(|e| FilingError::Db(e.to_string()))?;
    conn.execute(
        "UPDATE tracks SET status='resourcing' WHERE id=?1",
        params![track_id],
    )?;
    Ok(())
}

/// Reject every track of `track_ids` for re-sourcing (each → Écartés, status-only like
/// `reject_track`). A track that errors is reported in `failed` rather than aborting the batch,
/// so one bad id never strands the rest — mirroring `file_batch`'s fail-soft, no-panic shape.
pub fn reject_batch(conn: &Connection, track_ids: &[i64]) -> RejectBatchResult {
    let mut rejected = 0usize;
    let mut failed = Vec::new();
    for &id in track_ids {
        match reject_track(conn, id) {
            Ok(()) => rejected += 1,
            Err(_) => failed.push(id),
        }
    }
    RejectBatchResult { rejected, failed }
}

// NOTE: the former one-shot `trash_track(conn, track_id)` is gone on purpose. It did the whole
// sequence — path lookup, byte-for-byte copy to the trash dir, journal, status flip — against a
// single `&Connection`, so `ipc_filing::trash_track` necessarily held the global connection mutex
// across the copy. It is now the explicit three phases `track_path` → `trash_file_fs` →
// `commit_trash`, which is the only way the copy can provably sit outside the lock.

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn fixture(name: &str) -> Option<String> {
        let p = format!("fixtures/{name}");
        if std::path::Path::new(&p).exists() {
            Some(p)
        } else {
            None
        }
    }

    /// Copy a fixture into `dir` and insert a pending track row pointing at the copy.
    fn seed_track(
        conn: &Connection,
        dir: &Path,
        fixture_name: &str,
        as_name: &str,
    ) -> Option<(i64, std::path::PathBuf)> {
        let src = fixture(fixture_name)?;
        let copy = dir.join(as_name);
        std::fs::copy(&src, &copy).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status) VALUES(?1, 'pending')",
            params![copy.to_str().unwrap()],
        )
        .unwrap();
        Some((conn.last_insert_rowid(), copy))
    }

    #[test]
    fn canonical_from_metadata_prefers_persisted_identity() {
        let conn = db();
        conn.execute(
            "INSERT INTO tracks(id, path, status) VALUES(1,'/x.flac','pending')",
            [],
        )
        .unwrap();
        // No metadata row → None (file_batch then falls back to the tag/filename reconcile).
        assert!(canonical_from_metadata(&conn, 1).unwrap().is_none());

        // A Discogs identity → a Green canonical on that name (what lets a per-track applied identity feed file_batch).
        conn.execute(
            "INSERT INTO metadata(track_id, artist, title, source) VALUES(1,'Larry Heard','Can You Feel It','discogs')",
            [],
        )
        .unwrap();
        let c = canonical_from_metadata(&conn, 1)
            .unwrap()
            .expect("metadata present");
        assert_eq!(c.artist, "Larry Heard");
        assert_eq!(c.title, "Can You Feel It");
        assert_eq!(c.confidence, crate::naming::Confidence::Green);

        // A blank-name row must be treated as absent (never file on an empty name).
        conn.execute(
            "UPDATE metadata SET artist='', title='' WHERE track_id=1",
            [],
        )
        .unwrap();
        assert!(canonical_from_metadata(&conn, 1).unwrap().is_none());
    }

    #[test]
    fn reconcile_track_reads_filename_when_tags_absent() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let Some((id, _)) = seed_track(
            &conn,
            dir.path(),
            "real_lossless.flac",
            "Robert Owens - Bring Down the Walls.flac",
        ) else {
            eprintln!("skip: no fixture");
            return;
        };
        let c = reconcile_track(&conn, id).unwrap();
        assert_eq!(c.artist, "Robert Owens");
        assert_eq!(c.title, "Bring Down the Walls");
    }

    fn seed_pioneer_dir_with_fixture(dir: &std::path::Path) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/rekordbox_master.db"
            ),
            dir.join("master.db"),
        )
        .unwrap();
        crate::actions::set_pioneer_dir_override_for_test(dir.to_path_buf());
        let xml_path = dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        xml_path
    }

    /// Patches the fixture's track_id "40000001" FolderPath to `path` — same technique as
    /// actions.rs's detect_masterdb_repair_ambiguous_on_two_matches test.
    fn patch_fixture_folder_path(pioneer_dir: &std::path::Path, path: &str) {
        let raw = std::fs::read(pioneer_dir.join("master.db")).unwrap();
        let plaintext = crate::rekordbox_masterdb::decrypt_masterdb_for_test(&raw);
        let len = plaintext.len();
        let mut conn2 = rusqlite::Connection::open_in_memory().unwrap();
        conn2
            .deserialize_read_exact(
                rusqlite::MAIN_DB,
                std::io::Cursor::new(plaintext),
                len,
                false,
            )
            .unwrap();
        conn2
            .execute(
                "UPDATE djmdContent SET FolderPath=?1 WHERE ID='40000001'",
                params![path],
            )
            .unwrap();
        let plaintext2 = conn2.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let raw2 = crate::rekordbox_masterdb::encrypt_masterdb_for_test(&plaintext2);
        std::fs::write(pioneer_dir.join("master.db"), raw2).unwrap();
    }

    #[test]
    fn commit_file_conformant_detects_masterdb_metadata_sync() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            xml_path.to_str().unwrap(),
        )
        .unwrap();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();
        let _ = res;

        let (new_artist, status): (Option<String>, String) = conn
            .query_row(
                "SELECT new_artist, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected a metadata sync candidate");
        assert_eq!(status, "pending");
        assert_eq!(new_artist.as_deref(), Some("Larry Heard"));
    }

    #[test]
    fn commit_file_non_conformant_detects_masterdb_metadata_sync() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_lossless.flac", "src.flac")
        else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            xml_path.to_str().unwrap(),
        )
        .unwrap();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Theo Parrish".into(),
                title: "Falling Up".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();
        let _ = res;

        let (new_artist, status): (Option<String>, String) = conn
            .query_row(
                "SELECT new_artist, status FROM rekordbox_masterdb_metadata_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected a metadata sync candidate on the non-conformant (convert) path");
        assert_eq!(status, "pending");
        assert_eq!(new_artist.as_deref(), Some("Theo Parrish"));
    }

    #[test]
    fn files_conformant_mp3_by_moving() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();

        // moved into bin, original gone (mono-location), one move action
        assert!(std::path::Path::new(&res.path).exists());
        assert!(!src.exists());
        assert!(res.path.ends_with("Larry Heard - Can You Feel It.mp3"));
        let (status, folder): (String, Option<String>) = conn
            .query_row(
                "SELECT status, folder FROM tracks WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "filed");
        assert_eq!(folder.as_deref(), Some("House"));
        let moves: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='move' AND undone=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(moves, 1);
    }

    /// Reverting a CONFORMANT filing must remove the Discogs tags FROM THE FILE (restore the old
    /// ones), not just move the file back — else the file still carries the applied tags and the B9
    /// "not written" marker would wrongly stay hidden. The conformant filing journals tag_edit+move;
    /// revert undoes the move (file → source) THEN restores the captured old tags at source.
    #[test]
    fn revert_of_conformant_filing_restores_old_file_tags() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        // Give the source file KNOWN old tags before filing.
        crate::tagging::write_tags_full(
            src.to_str().unwrap(),
            "OLD Artist",
            "OLD Title",
            None,
            None,
            &[],
            None,
        )
        .unwrap();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "NEW Artist".into(),
                title: "NEW Title".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();
        // Filed: file moved into the bin, carrying the NEW tags.
        let after = crate::tagging::read_tags_full(&res.path).unwrap();
        assert_eq!(
            after.artist.as_deref(),
            Some("NEW Artist"),
            "filing wrote the new tags"
        );

        // Revert the whole filing batch (move undone, then old tags restored).
        crate::actions::revert_batch(&conn, &res.batch_id).unwrap();

        assert!(src.exists(), "the file is moved back to its source");
        assert!(
            !std::path::Path::new(&res.path).exists(),
            "nothing left at the bin destination"
        );
        let restored = crate::tagging::read_tags_full(src.to_str().unwrap()).unwrap();
        assert_eq!(
            restored.artist.as_deref(),
            Some("OLD Artist"),
            "old file tags restored on revert"
        );
        assert_eq!(restored.title.as_deref(), Some("OLD Title"));
    }

    /// CR-3 (audit multi-passes du 2026-07-28) — un échec du `move` sur le chemin CONFORMANT
    /// laissait les nouveaux tags écrits en place sur le fichier source, sans rien pour les
    /// défaire.
    ///
    /// Le chemin conformant tague le fichier À SA PLACE puis le déplace. Si le déplacement échoue
    /// (disque plein, destination verrouillée, permission, dossier disparu), la fonction sortait
    /// par un `?` nu : le fichier restait à sa source, porteur de tags que l'utilisateur n'avait
    /// pas demandés, et SANS ligne de journal — le journal n'est écrit qu'en phase 3, depuis le
    /// `log` retourné. Donc aucun revert possible depuis l'app, et aucune trace. La ligne
    /// `tag_edit` avec l'instantané des anciens tags existait pourtant déjà dans `log`, poussée
    /// avant l'écriture précisément pour ce cas ; personne ne la rejouait.
    ///
    /// L'échec est provoqué en supprimant le dossier de destination APRÈS le plan : `std::fs::rename`
    /// échoue alors sur un chemin introuvable, ce qui n'est ni 17 ni 18 et ne déclenche donc pas le
    /// repli copy_verify_delete — l'erreur remonte, comme un vrai échec disque.
    #[test]
    fn move_failure_restores_the_tags_it_had_already_overwritten() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::tagging::write_tags_full(
            src.to_str().unwrap(),
            "OLD Artist",
            "OLD Title",
            None,
            None,
            &[],
            None,
        )
        .unwrap();

        let plan = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "NEW Artist".into(),
                title: "NEW Title".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
            &HashSet::new(),
        )
        .unwrap();
        assert!(
            plan.conformant,
            "ce test ne vaut que pour le chemin conformant (tag en place puis move)"
        );

        // Fait echouer le deplacement, apres que le plan a fige la destination.
        std::fs::remove_dir_all(root.join("House")).unwrap();

        // `FsLog` ne derive pas Debug (et ce n'est pas a ce test de le lui ajouter): on teste donc
        // la variante d'erreur, pas la valeur complete.
        let err = execute_file(&plan).err();
        assert!(
            err.is_some(),
            "le deplacement doit echouer une fois le dossier de destination supprime"
        );

        assert!(
            src.exists(),
            "le fichier source doit etre encore la: rien ne l'a deplace"
        );
        assert!(
            !std::path::Path::new(&plan.dest).exists(),
            "rien ne doit avoir ete ecrit a la destination"
        );
        let after = crate::tagging::read_tags_full(src.to_str().unwrap()).unwrap();
        assert_eq!(
            after.artist.as_deref(),
            Some("OLD Artist"),
            "les tags ecrits avant le move rate doivent avoir ete defaits: le fichier de \
             l'utilisateur ne doit pas garder des tags issus d'un rangement qui n'a pas eu lieu"
        );
        assert_eq!(after.title.as_deref(), Some("OLD Title"));
    }

    /// FIX-15: `rollback_fs` (the "nothing is left half-filed" guarantee) had no test forcing
    /// `commit_file` to fail AFTER `execute_file` already moved the file. Deleting the track row
    /// between the two phases makes the actions insert's FK (track_id REFERENCES tracks(id))
    /// fail — the same shape of failure `commit_file` guards against (a real DB error mid-commit).
    #[test]
    fn commit_failure_rolls_back_the_conformant_move() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let plan = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
            &HashSet::new(),
        )
        .unwrap();
        let log = execute_file(&plan).unwrap();
        // Phase 2 already ran: the file really moved.
        assert!(!src.exists());
        assert!(std::path::Path::new(&plan.dest).exists());

        conn.execute("DELETE FROM tracks WHERE id=?1", params![id])
            .unwrap();
        assert!(
            commit_file(&conn, &plan, log, None).is_err(),
            "commit must fail once its track row is gone"
        );

        // Nothing left half-filed: the file is back at its original path, gone from the bin.
        assert!(
            src.exists(),
            "rollback must restore the file at its original path"
        );
        assert!(
            !std::path::Path::new(&plan.dest).exists(),
            "rollback must remove it from the bin"
        );
    }

    #[test]
    fn files_flac_by_converting_to_aiff_and_trashing_original() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_lossless.flac", "src.flac")
        else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Theo Parrish".into(),
                title: "Falling Up".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();

        // converted AIFF lands in the bin; conformant to target
        assert!(res.path.ends_with("Theo Parrish - Falling Up.aiff"));
        assert!(crate::encode::is_conformant(
            &res.path,
            crate::encode::Target::Aiff1644
        ));
        // original is in .sift-trash, not at its source location (mono-location)
        assert!(!src.exists());
        let convert_rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='convert' AND undone=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let trash_rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='trash' AND undone=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(convert_rows, 1);
        assert_eq!(trash_rows, 1);
    }

    /// Root fix for the `.aif`/`.aiff` revert-duplicate: a CONFORMANT AIFF is moved (no transcode),
    /// so it must keep its own extension instead of being forced to the canonical `.aiff`. We build a
    /// conformant 3-letter `.aif` by encoding the lossless fixture to AIFF 16/44.1, then file it and
    /// assert the destination stays `.aif` and the action was a `move` (not `convert`). With a single
    /// possible output name, a later blocked revert can no longer leave a `.aif` next to a `.aiff`.
    #[test]
    fn files_conformant_aif_preserving_its_extension() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some(flac) = fixture("real_lossless.flac") else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();

        // A conformant source whose extension is the 3-letter `.aif` (the case formerly forced to `.aiff`).
        let aif_src = dir.path().join("src.aif");
        crate::encode::encode(
            &flac,
            aif_src.to_str().unwrap(),
            crate::encode::Target::Aiff1644,
        )
        .unwrap();
        assert!(
            crate::encode::is_conformant(
                aif_src.to_str().unwrap(),
                crate::encode::Target::Aiff1644
            ),
            "the built .aif is conformant"
        );
        conn.execute(
            "INSERT INTO tracks(path, status) VALUES(?1, 'pending')",
            params![aif_src.to_str().unwrap()],
        )
        .unwrap();
        let id = conn.last_insert_rowid();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();

        // Moved keeping `.aif` — NOT forced to the 4-letter `.aiff`.
        assert!(
            res.path.ends_with("Larry Heard - Can You Feel It.aif"),
            "dest keeps .aif: {}",
            res.path
        );
        assert!(
            !res.path.ends_with(".aiff"),
            "must not force .aiff on a moved conformant file"
        );
        assert!(std::path::Path::new(&res.path).exists());
        assert!(!aif_src.exists(), "moved out of source (mono-location)");
        // It was a pure MOVE: no conversion, no trash.
        let moves: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='move' AND undone=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let converts: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='convert' AND undone=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(moves, 1, "conformant .aif is moved");
        assert_eq!(converts, 0, "no conversion for an already-conformant file");
    }

    #[test]
    fn file_track_refuses_lossy_to_aiff() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let Some((id, _)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let err = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "",
            Some(Target::Aiff1644),
            Some(Canonical {
                artist: "X".into(),
                title: "Y".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        );
        assert_eq!(err, Err(FilingError::Upscale));
    }

    #[test]
    fn plan_file_external_dest_resolves_outside_root_when_directory_exists() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let external = dir.path().join("elsewhere");
        std::fs::create_dir_all(&external).unwrap();
        let Some((id, _)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let bin_rel = format!("{EXTERNAL_DEST_PREFIX}{}", external.to_str().unwrap());
        let plan = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            &bin_rel,
            None,
            Some(Canonical {
                artist: "X".into(),
                title: "Y".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
            &HashSet::new(),
        )
        .unwrap();
        let dest = Path::new(&plan.dest);
        assert!(
            dest.starts_with(&external),
            "dest {dest:?} should land under the external dir, not the library root"
        );
        assert!(
            !dest.starts_with(&root),
            "dest {dest:?} must NOT be under the library root"
        );
    }

    #[test]
    fn plan_file_external_dest_fails_loudly_when_directory_is_gone() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let Some((id, _)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let missing = dir.path().join("never-created");
        let bin_rel = format!("{EXTERNAL_DEST_PREFIX}{}", missing.to_str().unwrap());
        let err = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            &bin_rel,
            None,
            Some(Canonical {
                artist: "X".into(),
                title: "Y".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
            &HashSet::new(),
        );
        assert_eq!(
            err.err(),
            Some(FilingError::Io(format!(
                "external destination no longer exists: {}",
                missing.to_str().unwrap()
            )))
        );
    }

    #[test]
    fn reject_track_sets_resourcing_and_records() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let Some((id, _)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        reject_track(&conn, id).unwrap();
        let status: String = conn
            .query_row("SELECT status FROM tracks WHERE id=?1", params![id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "resourcing");
        let rejects: i64 = conn
            .query_row(
                "SELECT count(*) FROM actions WHERE type='reject'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rejects, 1);
    }

    #[test]
    fn reject_batch_marks_all_and_collects_bad_ids() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let (Some((a, _)), Some((b, _))) = (
            seed_track(&conn, dir.path(), "real_320.mp3", "a.mp3"),
            seed_track(&conn, dir.path(), "real_320.mp3", "b.mp3"),
        ) else {
            eprintln!("skip: no fixture");
            return;
        };
        // 999 is not a real track id → reject_track errors → reported in `failed`, batch not aborted.
        let res = reject_batch(&conn, &[a, b, 999]);
        assert_eq!(
            res,
            RejectBatchResult {
                rejected: 2,
                failed: vec![999]
            }
        );
        let resourced: i64 = conn
            .query_row(
                "SELECT count(*) FROM tracks WHERE status='resourcing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(resourced, 2);
    }

    #[test]
    fn trash_track_moves_to_sift_trash() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        // The three phases in the order `ipc_filing::trash_track` runs them (path under the lock,
        // copy off it, journal + status back under it).
        let source = track_path(&conn, id).unwrap();
        let dest = trash_file_fs(id, &source).unwrap();
        commit_trash(&conn, id, &source, &dest).unwrap();
        assert!(!src.exists());
        let status: String = conn
            .query_row("SELECT status FROM tracks WHERE id=?1", params![id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "trash");
        // Trash is centralized to <Documents>/Sift/Trash/ (cross-disk safe), not under `root`.
        // The moved file is named `<track_id>__<original_name>` there (ensure_unique may suffix it
        // if a prior run left one behind, so match on the `<id>__` prefix, not an exact name).
        let trash_dir = sift_trash_dir().unwrap();
        let prefix = format!("{id}__");
        let entries: Vec<std::path::PathBuf> = trash_dir
            .read_dir()
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(&prefix))
            })
            .collect();
        assert!(
            !entries.is_empty(),
            "trashed file should land in the central Sift trash dir"
        );
        for p in entries {
            std::fs::remove_file(&p).ok();
        }
    }

    #[test]
    fn filing_writes_applied_genres_to_the_file() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, _src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };

        // seed a Discogs identity for the track BEFORE filing
        let cand = crate::metadata::Candidate {
            artist: "Larry Heard".into(),
            title: "Mystery of Love".into(),
            label: Some("Alleviated".into()),
            year: Some(1986),
            styles: vec!["Deep House".into()],
            country: None,
            format: None,
            cover_url: None,
            release_id: "12345".into(),
            source: "discogs".into(),
        };
        crate::metadata::apply_identity(&conn, id, &cand, None).unwrap();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Mystery of Love".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();

        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;
        use lofty::tag::ItemKey;
        let tagged = Probe::open(&res.path).unwrap().read().unwrap();
        let tag = tagged.primary_tag().unwrap();
        let genre = tag.get_string(ItemKey::Genre).unwrap_or("");
        assert!(
            genre.contains("Deep House"),
            "filed file has applied genre; got {genre:?}"
        );
    }

    /// FIX-1 (BUG-1): an MP3 disguised with a `.flac` extension must be REFUSED by default
    /// (`RailMismatch`, not silently converted into a fabricated lossless AIFF), and must succeed
    /// once the caller explicitly passes `allow_rail_mismatch=true` (the confirmed-by-the-user
    /// path). A genuine FLAC must file normally either way — no false positive.
    #[test]
    fn plan_file_blocks_a_disguised_lossy_source_unless_allowed() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let Some(mp3) = fixture("real_320.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        let disguised = dir.path().join("disguised.flac");
        std::fs::copy(&mp3, &disguised).unwrap();
        conn.execute(
            "INSERT INTO tracks(path, status) VALUES(?1, 'pending')",
            params![disguised.to_str().unwrap()],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        let canonical = Some(Canonical {
            artist: "X".into(),
            title: "Y".into(),
            version: None,
            confidence: crate::naming::Confidence::Green,
        });

        // Default (allow_rail_mismatch=false): refused, nothing touched.
        let blocked = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            canonical.clone(),
            false,
            &HashSet::new(),
        );
        assert_eq!(blocked.err(), Some(FilingError::RailMismatch));
        assert!(
            disguised.exists(),
            "refused plan must not touch the source file"
        );

        // Explicit confirmation (allow_rail_mismatch=true): proceeds normally.
        crate::ffmpeg::init_ffmpeg_path();
        let allowed = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            canonical,
            true,
            &HashSet::new(),
        );
        assert!(
            allowed.is_ok(),
            "an explicitly confirmed mismatch must proceed: {:?}",
            allowed.err()
        );
    }

    /// No false positive: a genuine FLAC must never trip the mismatch guard.
    #[test]
    fn plan_file_does_not_flag_a_genuine_lossless_source() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(&root).unwrap();
        let Some((id, _src)) = seed_track(&conn, dir.path(), "real_lossless.flac", "src.flac")
        else {
            eprintln!("skip: no fixture");
            return;
        };
        crate::ffmpeg::init_ffmpeg_path();
        let res = plan_file(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "X".into(),
                title: "Y".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
            &HashSet::new(),
        );
        assert!(
            res.is_ok(),
            "a genuine FLAC must not be blocked: {:?}",
            res.err()
        );
    }

    #[test]
    fn commit_file_detects_masterdb_repair_with_correct_action_id() {
        let conn = db();
        let tmp = tempfile::tempdir().unwrap();

        let pioneer_dir = tmp.path().join("pioneer");
        std::fs::create_dir_all(&pioneer_dir).unwrap();
        std::fs::copy(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/rekordbox_master.db"
            ),
            pioneer_dir.join("master.db"),
        )
        .unwrap();
        crate::actions::set_pioneer_dir_override_for_test(pioneer_dir.clone());
        let xml_path = pioneer_dir.join("masterPlaylists6.xml");
        std::fs::write(&xml_path, b"<DJ_PLAYLISTS/>").unwrap();
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            xml_path.to_str().unwrap(),
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tracks(path, status) VALUES('irrelevant', 'pending')",
            [],
        )
        .unwrap();
        let track_id = conn.last_insert_rowid();

        let plan = FilePlan {
            track_id,
            batch_id: "b1".to_string(),
            source: "irrelevant-source".to_string(),
            dest: "irrelevant-dest".to_string(),
            conformant: false,
            target: Target::Mp3320,
            canonical: Canonical {
                artist: "A".to_string(),
                title: "T".to_string(),
                version: None,
                confidence: naming::Confidence::Green,
            },
            bin_rel: "House".to_string(),
            extras: TagExtras {
                label: None,
                year: None,
                genres: vec![],
                cover_path: None,
            },
        };
        let log = vec![FsLog {
            kind: "move",
            from: "D:/FIXTURE/track1.mp3".to_string(),
            to: "D:/FIXTURE/renamed/track1.flac".to_string(),
            meta: None,
        }];

        commit_file(&conn, &plan, log, None).expect("commit_file");

        let action_id: i64 = conn
            .query_row(
                "SELECT id FROM actions WHERE type='move' AND from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| r.get(0),
            )
            .expect("move action row exists");

        let (repair_action_id, repair_track_id, status): (i64, String, String) = conn
            .query_row(
                "SELECT action_id, track_id, status FROM rekordbox_masterdb_repairs WHERE from_path='D:/FIXTURE/track1.mp3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("repair row created");
        assert_eq!(
            repair_action_id, action_id,
            "the repair row must reference the SAME action_id commit_file just created for this row"
        );
        assert_eq!(repair_track_id, "40000001");
        assert_eq!(status, "pending");
    }

    #[test]
    fn commit_file_conformant_detects_masterdb_artwork_sync_only_when_cover_changes() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            xml_path.to_str().unwrap(),
        )
        .unwrap();

        // No cover_path set on this track's metadata row — commit must NOT create an artwork
        // sync candidate, only a metadata one (already covered by the sibling test).
        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();
        let _ = res;

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 0,
            "no cover_path on this track — must not create an artwork sync candidate"
        );
    }

    #[test]
    fn commit_file_conformant_detects_masterdb_artwork_sync_when_cover_present() {
        let conn = db();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join("House")).unwrap();
        let Some((id, src)) = seed_track(&conn, dir.path(), "real_320.mp3", "src.mp3") else {
            eprintln!("skip: no fixture");
            return;
        };
        conn.execute(
            "INSERT INTO metadata(track_id, cover_path) VALUES (?1, '/cache/covers/999.jpg')
             ON CONFLICT(track_id) DO UPDATE SET cover_path=excluded.cover_path",
            params![id],
        )
        .unwrap();

        let pioneer_dir = dir.path().join("pioneer");
        let xml_path = seed_pioneer_dir_with_fixture(&pioneer_dir);
        patch_fixture_folder_path(&pioneer_dir, src.to_str().unwrap());
        crate::settings::set(
            &conn,
            crate::settings::REKORDBOX_XML_PATH,
            xml_path.to_str().unwrap(),
        )
        .unwrap();

        let res = file_track(
            &conn,
            &root,
            "{artist} - {title}",
            id,
            "House",
            None,
            Some(Canonical {
                artist: "Larry Heard".into(),
                title: "Can You Feel It".into(),
                version: None,
                confidence: crate::naming::Confidence::Green,
            }),
            false,
        )
        .unwrap();
        let _ = res;

        let (cover_path, status): (String, String) = conn
            .query_row(
                "SELECT cover_path, status FROM rekordbox_masterdb_artwork_syncs WHERE track_id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("commit_file must have detected an artwork sync candidate");
        assert_eq!(cover_path, "/cache/covers/999.jpg");
        assert_eq!(status, "pending");
    }

    // Contract tests (Phase 2) — see
    // docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md. No codegen: these parse
    // shared/contracts.ts's source text directly and assert the Rust constant's literal value
    // appears in it. Inline here (not a separate integration test file) because `filing` is a
    // private module — src-tauri/tests/*.rs compiles as an external crate and can't see it.
    const CONTRACTS_TS: &str = include_str!("../../shared/contracts.ts");

    #[test]
    fn file_in_place_constant_matches_contracts_ts() {
        let expected = format!("\"{}\"", FILE_IN_PLACE);
        assert!(
            CONTRACTS_TS.contains(&expected),
            "shared/contracts.ts must contain FILE_IN_PLACE = {expected}"
        );
    }

    #[test]
    fn external_dest_prefix_constant_matches_contracts_ts() {
        let expected = format!("\"{}\"", EXTERNAL_DEST_PREFIX);
        assert!(
            CONTRACTS_TS.contains(&expected),
            "shared/contracts.ts must contain EXTERNAL_DEST_PREFIX = {expected}"
        );
    }

    /// Mirrors shared/contracts.ts's `BatchResult`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn batch_result_shape_matches_contracts_ts() {
        let v = BatchResult {
            filed: 0,
            needs_validation: Vec::new(),
            cancelled: false,
        };
        let BatchResult {
            filed,
            needs_validation,
            cancelled,
        } = v;
        let _ = (filed, needs_validation, cancelled);
    }
}
