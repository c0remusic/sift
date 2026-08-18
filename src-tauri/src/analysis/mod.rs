//! M2a audio analysis engine. One FFmpeg decode → online accumulators → AnalysisReport.
//! Pure: no DB writes, no UI. See docs/superpowers/specs/2026-06-12-m2a-analysis-engine-design.md
use serde::{Deserialize, Serialize};

pub mod decode;
pub mod dynamics;
pub mod peaks;
pub mod phase;
pub mod spectrum;
pub mod structure;
pub mod tags;
pub mod verdict;

/// Real signal lineage, independent of the declared extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rail {
    Lossless,
    Lossy,
    Unknown,
}

/// Authenticity verdict, derived from cutoff + declared rail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Ok,
    Fake,
    Grey,
}

/// Time×frequency magnitude grid (dB, quantized to u8) for the UI spectrogram (M2c).
///
/// `Default` = the empty grid, which is a real state and not just a derive convenience: it is
/// what `analyze(path, false)` produces, and what the report cache stores (see
/// `ipc::cache_json` — the grid is computed on demand when the Revue collapse opens).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Spectrogram {
    pub frames: usize,
    pub bins: usize,
    pub hz_per_bin: f32,
    pub sec_per_frame: f32,
    /// `frames * bins` values, row-major by frame. 0 = -100 dBFS, 255 = 0 dBFS.
    ///
    /// Travels over the Tauri IPC as a base85 RFC1924 STRING, not as serde's default array of
    /// decimal integers — see `crate::b85_bytes`.
    ///
    /// PLUS au repos : depuis le 2026-08-03, cette grille n'est plus stockée dans
    /// `tracks.report_json` (`ipc::cache_json` la retire, le pool analyse avec
    /// `with_spectrogram: false`). Elle se recalcule à l'ouverture du collapse Diagnostic —
    /// 631 ms mesurées, contre ~450 ko par piste économisés, soit 4,11 Go → 119 Mo sur la base
    /// de production. Le champ vaut donc `Default` sur tout rapport lu depuis le cache.
    /// The layout and the quantization above are unchanged; only the encoding is. Consumers
    /// outside Rust must decode it (`shared/contracts.ts` mirrors the decoded type).
    #[serde(with = "crate::b85_bytes")]
    pub mag_db: Vec<u8>,
}

/// The full analysis result for one file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnalysisReport {
    pub path: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_sec: f32,
    pub declared_format: String,
    pub declared_bitrate: Option<u32>,
    pub declared_rail: Rail,
    pub cutoff_hz: f32,
    pub verdict: Verdict,
    /// True when the declared rail claims Lossless but the real container (magic-byte
    /// sniffed) is Lossy — the specific Fake cause where the spectral cutoff can sit near
    /// Nyquist (unlike a genuine spectral-cliff transcode), so the UI must caption it
    /// differently. Mirrors the same condition `verdict::verdict` short-circuits on.
    pub container_mismatch: bool,
    /// Equivalent lossy bitrate estimated from `cutoff_hz` (FIX-11: single source of truth,
    /// see `verdict::estimate_kbps` — the front no longer computes this itself).
    pub est_kbps: u32,
    pub peaks: Vec<f32>,
    /// Mono samples represented by ONE entry of `peaks`. Equals `PEAKS_WINDOW` unless the envelope
    /// was capped (`peaks::cap`), in which case it is `PEAKS_WINDOW * pooling factor`. The front
    /// needs it to convert a point count back into seconds — deriving that from PEAKS_WINDOW alone
    /// silently under-reports coverage on every capped track.
    #[serde(default = "default_peaks_step")]
    pub peaks_step: usize,
    pub spectrogram: Spectrogram,
    pub clip_runs: u32,
    pub clip_pct: f32,
    pub true_peak_dbtp: f32,
    pub dc_offset: f32,
    pub phase_correlation: f32,
    pub dual_mono: bool,
    pub container_ok: bool,
    pub codec_error: Option<String>,
    pub truncated: bool,
    pub silence_head_ms: u32,
    pub silence_tail_ms: u32,
    pub id3_version: Option<String>,
    pub tags_cdj_ok: bool,
    pub has_cover: bool,
}

/// Bump whenever a change alters what `analyze()` produces WITHOUT changing `AnalysisReport`'s
/// JSON shape — e.g. spectrogram resolution constants (spectrum.rs), cutoff-detection tuning,
/// the kbps table — so rows cached under the old behavior (structurally still valid JSON) are
/// treated as stale and recomputed, instead of silently serving outdated data forever. Struct
/// field additions/removals are already caught by `serde_json::from_str` failing outright; this
/// constant is for the content changes that a schema check can't see.
///
/// A change to the ENCODING of an existing field counts too (v6: `mag_db` moved to base85), even
/// when the tolerant deserializer would still read the old rows — bumping makes the invalidation
/// explicit instead of leaving inflated rows served forever.
pub const REPORT_CACHE_VERSION: i64 = 6;

use dynamics::{ClipAccumulator, DcAccumulator, TruePeakAccumulator};
use peaks::PeaksAccumulator;
use phase::PhaseAccumulator;
use spectrum::SpectrumAccumulator;
use structure::{SilenceAccumulator, TruncationAccumulator};

const FFT_SIZE: usize = 4096;
const PEAKS_WINDOW: usize = 512; // ~11.6 ms @ 44.1k
/// Ceiling on the number of envelope points kept in the report. At PEAKS_WINDOW a 6.5-minute track
/// produced ~33 500 of them — 21% of report_json — to draw a waveform a few hundred pixels wide.
/// 4 000 still gives several points per pixel at any realistic canvas width.
const MAX_PEAKS: usize = 4_000;

/// Serde fallback for reports written before `peaks_step` existed: they were never capped, so their
/// step is exactly PEAKS_WINDOW. Keeps such a report readable instead of failing the whole parse.
fn default_peaks_step() -> usize {
    PEAKS_WINDOW
}
const CLIP_THRESHOLD: f32 = 0.99;
const CLIP_MIN_RUN: usize = 3;
const SILENCE_THRESHOLD: f32 = 0.001; // ~ -60 dBFS

/// Runs the full analysis: one decode, all analyzers in a single streaming pass.
/// `with_spectrogram`: build the (heavy) display spectrogram grid. The verdict and all
/// scalar signals are identical either way — only the display grid is gated. Batch (M2b)
/// passes false; the Revue UI / debug overlay pass true on demand.
pub fn analyze(path: &str, with_spectrogram: bool) -> Result<AnalysisReport, String> {
    let started = std::time::Instant::now();
    // declared properties / tags (no decode)
    let tag = tags::read(path);
    let target_ch = if tag.channels >= 2 { 2 } else { 1 };

    // Native sample rate from the header — drives every frequency-domain accumulator so the
    // cutoff/spectrogram map bins → Hz correctly (no resample, no hardcoded-rate skew).
    let sr = decode::probe(path)?.sample_rate;
    let mut dc = DcAccumulator::new();
    let mut clip = ClipAccumulator::new(CLIP_THRESHOLD, CLIP_MIN_RUN);
    let mut tp = TruePeakAccumulator::new();
    let mut sil = SilenceAccumulator::new(sr, SILENCE_THRESHOLD);
    let mut trunc = TruncationAccumulator::new(sr);
    let mut pk = PeaksAccumulator::new(PEAKS_WINDOW);
    let mut spec = SpectrumAccumulator::new(sr, FFT_SIZE, with_spectrogram);
    let mut ph = PhaseAccumulator::new();

    let info = decode::decode_pcm(path, target_ch, |block| {
        if target_ch == 2 {
            ph.push(block); // interleaved L,R
            let mono: Vec<f32> = block
                .chunks_exact(2)
                .map(|lr| 0.5 * (lr[0] + lr[1]))
                .collect();
            dc.push(&mono);
            clip.push(&mono);
            tp.push(&mono);
            sil.push(&mono);
            trunc.push(&mono);
            pk.push(&mono);
            spec.push(&mono);
        } else {
            dc.push(block);
            clip.push(block);
            tp.push(block);
            sil.push(block);
            trunc.push(block);
            pk.push(block);
            spec.push(block);
        }
    })?;

    let (clip_runs, clip_pct) = clip.finish();
    let (silence_head_ms, silence_tail_ms) = sil.finish();
    let truncated = trunc.finish(info.codec_error.is_some());
    let spec_res = spec.finish();
    let phase_correlation = if target_ch == 2 {
        ph.correlation()
    } else {
        0.0
    };
    let dual_mono = target_ch == 2 && ph.dual_mono();

    let declared_format = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let cutoff_hz = spec_res.cutoff_hz;
    // Content-rail sniffing (magic bytes, independent of the declared extension) comes from the
    // same lofty probe `tags::read` already did — no second file open/read pass. Only matters
    // when the declared rail is Lossless — that's the only case verdict() short-circuits on a
    // mismatch.
    let content_rail = tag.content_rail;
    // content_rail is now sniffed unconditionally in tags::read() (no longer gated on
    // declared_rail here) — both sides of this comparison are load-bearing.
    let container_mismatch = tag.declared_rail == Rail::Lossless && content_rail == Rail::Lossy;
    let verdict = verdict::verdict(
        cutoff_hz,
        tag.declared_rail,
        tag.declared_bitrate,
        content_rail,
    );
    let est_kbps = verdict::estimate_kbps(cutoff_hz);
    let (capped_peaks, peaks_factor) = peaks::cap(pk.finish(), MAX_PEAKS);

    log::info!(
        "analyze {} : {} ms (decode+dsp, {} ch, {:.1}s, spectro={})",
        path,
        started.elapsed().as_millis(),
        info.channels,
        tag.duration_sec,
        with_spectrogram
    );

    Ok(AnalysisReport {
        path: path.to_string(),
        sample_rate: info.sample_rate,
        channels: info.channels,
        duration_sec: tag.duration_sec,
        declared_format,
        declared_bitrate: tag.declared_bitrate,
        declared_rail: tag.declared_rail,
        cutoff_hz,
        verdict,
        container_mismatch,
        est_kbps,
        peaks: capped_peaks,
        peaks_step: PEAKS_WINDOW * peaks_factor,
        spectrogram: spec_res.spectrogram,
        clip_runs,
        clip_pct,
        true_peak_dbtp: tp.finish(),
        dc_offset: dc.finish(),
        phase_correlation,
        dual_mono,
        container_ok: info.codec_error.is_none(),
        codec_error: info.codec_error,
        truncated,
        silence_head_ms,
        silence_tail_ms,
        id3_version: tag.id3_version,
        tags_cdj_ok: tag.tags_cdj_ok,
        has_cover: tag.has_cover,
    })
}

#[cfg(test)]
mod corpus {
    /// Mesure le détecteur sur un dossier RÉEL et imprime du CSV — le harnais de l'étape 2 du
    /// chantier « le détecteur de faux marche-t-il » (2026-08-17).
    ///
    /// Existe parce que le corpus de fixtures du dépôt descend entièrement d'UN sinus balayé passé
    /// par UN encodeur à deux débits : vert dessus ne dit rien de la vraie musique. Ce test ne
    /// vérifie rien lui-même — il produit la mesure, et c'est le corpus étiqueté qui porte le
    /// jugement.
    ///
    /// `SIFT_CORPUS_DIR=<dossier> cargo test --manifest-path src-tauri/Cargo.toml --release
    ///   corpus_scan -- --ignored --nocapture`
    ///
    /// `--release` obligatoire en pratique : le décodage d'un morceau de 6 minutes en debug se
    /// compte en minutes.
    #[test]
    #[ignore]
    fn corpus_scan() {
        let Ok(dir) = std::env::var("SIFT_CORPUS_DIR") else {
            eprintln!("SIFT_CORPUS_DIR non défini — rien à mesurer");
            return;
        };
        // Compte positif obligatoire : une liste vide et un dossier illisible se ressemblent, et
        // c'est exactement le défaut que ce dépôt passe son temps à corriger.
        let mut seen = 0usize;
        let mut failed = 0usize;
        // Le nom de fichier passe EN DERNIER, et ce n'est pas cosmétique : mesuré le 2026-08-18
        // sur 967 fichiers d'une vraie clé USB, 4 lignes étaient tordues parce que le nom
        // contenait le séparateur — « Jacob Todd - Nevermore (Original ;… ».wav » décalait toutes
        // les colonnes suivantes, et le verdict lu était un bout de titre. En dernière position,
        // un `;` dans le nom ne peut plus déplacer quoi que ce soit : les cinq champs qui
        // précèdent se lisent par position, et le nom est « tout ce qui reste ».
        println!("rail;debit_declare;cutoff_hz;verdict;est_kbps;fichier");
        for e in walkdir::WalkDir::new(&dir).into_iter().flatten() {
            if !e.file_type().is_file() {
                continue;
            }
            let path = e.path();
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(
                ext.as_str(),
                "aif" | "aiff" | "flac" | "wav" | "mp3" | "m4a" | "ogg" | "opus" | "wma"
            ) {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("(illisible)");
            seen += 1;
            match super::analyze(&path.to_string_lossy(), false) {
                Ok(r) => println!(
                    "{:?};{};{:.0};{:?};{};{name}",
                    r.declared_rail,
                    r.declared_bitrate
                        .map(|b| b.to_string())
                        .unwrap_or_else(|| "-".into()),
                    r.cutoff_hz,
                    r.verdict,
                    r.est_kbps
                ),
                Err(err) => {
                    failed += 1;
                    // Un échec d'analyse est une LIGNE du résultat, pas un silence : c'est
                    // précisément le cas qui, non dit, ferait passer un corpus incomplet pour
                    // un corpus propre.
                    println!("ERREUR;-;-;-;{err};{name}");
                }
            }
        }
        println!("-- {seen} fichiers audio parcourus, {failed} en echec");
        assert!(seen > 0, "aucun fichier audio dans {dir} — mesure vide");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors shared/contracts.ts's `Spectrogram`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn spectrogram_shape_matches_contracts_ts() {
        let v = Spectrogram {
            frames: 0,
            bins: 0,
            hz_per_bin: 0.0,
            sec_per_frame: 0.0,
            // NOTE: this destructure only checks the field's PRESENCE. It compiles unchanged when
            // the wire type diverges (Rust `Vec<u8>` ↔ base85 string ↔ `Uint8Array` in
            // shared/contracts.ts:84) — it will NOT catch a type mismatch with the TS mirror.
            mag_db: Vec::new(),
        };
        let Spectrogram {
            frames,
            bins,
            hz_per_bin,
            sec_per_frame,
            mag_db,
        } = v;
        let _ = (frames, bins, hz_per_bin, sec_per_frame, mag_db);
    }

    /// Mirrors shared/contracts.ts's `AnalysisReport`. Exhaustive destructure (no `..`): fails to
    /// compile if a field is added/removed/renamed on the Rust struct — the forcing function to
    /// also update contracts.ts. Phase 2 — docs/superpowers/plans/2026-07-13-phase2-ipc-contract-tests.md.
    #[test]
    fn analysis_report_shape_matches_contracts_ts() {
        let v = AnalysisReport {
            path: String::new(),
            sample_rate: 0,
            channels: 0,
            duration_sec: 0.0,
            declared_format: String::new(),
            declared_bitrate: None,
            declared_rail: Rail::Unknown,
            cutoff_hz: 0.0,
            verdict: Verdict::Ok,
            container_mismatch: false,
            est_kbps: 0,
            peaks: Vec::new(),
            peaks_step: PEAKS_WINDOW,
            spectrogram: Spectrogram {
                frames: 0,
                bins: 0,
                hz_per_bin: 0.0,
                sec_per_frame: 0.0,
                mag_db: Vec::new(),
            },
            clip_runs: 0,
            clip_pct: 0.0,
            true_peak_dbtp: 0.0,
            dc_offset: 0.0,
            phase_correlation: 0.0,
            dual_mono: false,
            container_ok: false,
            codec_error: None,
            truncated: false,
            silence_head_ms: 0,
            silence_tail_ms: 0,
            id3_version: None,
            tags_cdj_ok: false,
            has_cover: false,
        };
        let AnalysisReport {
            path,
            sample_rate,
            channels,
            duration_sec,
            declared_format,
            declared_bitrate,
            declared_rail,
            cutoff_hz,
            verdict,
            container_mismatch,
            est_kbps,
            peaks,
            peaks_step,
            spectrogram,
            clip_runs,
            clip_pct,
            true_peak_dbtp,
            dc_offset,
            phase_correlation,
            dual_mono,
            container_ok,
            codec_error,
            truncated,
            silence_head_ms,
            silence_tail_ms,
            id3_version,
            tags_cdj_ok,
            has_cover,
        } = v;
        let _ = (
            path,
            sample_rate,
            channels,
            duration_sec,
            declared_format,
            declared_bitrate,
            declared_rail,
            cutoff_hz,
            verdict,
            container_mismatch,
            est_kbps,
            peaks,
            peaks_step,
            spectrogram,
            clip_runs,
            clip_pct,
            true_peak_dbtp,
            dc_offset,
            phase_correlation,
            dual_mono,
            container_ok,
            codec_error,
            truncated,
            silence_head_ms,
            silence_tail_ms,
            id3_version,
            tags_cdj_ok,
            has_cover,
        );
    }

    #[test]
    fn report_serializes_to_json() {
        let r = AnalysisReport {
            path: "x.flac".into(),
            sample_rate: 44100,
            channels: 2,
            duration_sec: 1.0,
            declared_format: "flac".into(),
            declared_bitrate: None,
            declared_rail: Rail::Lossless,
            cutoff_hz: 21000.0,
            verdict: Verdict::Ok,
            container_mismatch: false,
            est_kbps: 320,
            peaks: vec![0.0, 1.0],
            peaks_step: PEAKS_WINDOW,
            spectrogram: Spectrogram {
                frames: 1,
                bins: 3,
                hz_per_bin: 10.0,
                sec_per_frame: 0.1,
                mag_db: vec![0, 127, 255],
            },
            clip_runs: 0,
            clip_pct: 0.0,
            true_peak_dbtp: -1.0,
            dc_offset: 0.0,
            phase_correlation: 1.0,
            dual_mono: false,
            container_ok: true,
            codec_error: None,
            truncated: false,
            silence_head_ms: 0,
            silence_tail_ms: 0,
            id3_version: None,
            tags_cdj_ok: true,
            has_cover: false,
        };
        let j = serde_json::to_string(&r).unwrap();
        assert!(j.contains("\"verdict\":\"ok\""));
        assert!(j.contains("\"declared_rail\":\"lossless\""));
        assert!(j.contains("\"container_mismatch\":false"));
        // mag_db must be a base85 STRING, never the historic array of decimal integers — that
        // encoding is the whole point of REPORT_CACHE_VERSION 6 (see crate::b85_bytes).
        assert!(
            j.contains("\"mag_db\":\""),
            "mag_db must serialize as a string: {j}"
        );
        assert!(!j.contains("\"mag_db\":["), "mag_db regressed to an array");
        let back: AnalysisReport = serde_json::from_str(&j).unwrap();
        assert_eq!(back.spectrogram.mag_db, vec![0u8, 127, 255]);
        assert_eq!(back, r);
    }

    /// BUG-1 end-to-end: an MP3 renamed with a `.flac` extension must be caught by
    /// `analyze()` as Fake, via `tags::rail_from_content` sniffing the real magic bytes
    /// (not just the declared/extension rail, which is fooled).
    #[test]
    fn analyze_catches_a_renamed_mp3_as_fake() {
        let p = "fixtures/real_320.mp3";
        if !std::path::Path::new(p).exists() {
            eprintln!("skip: no fixture");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let disguised = dir.path().join("disguised.flac");
        std::fs::copy(p, &disguised).unwrap();
        let path = disguised.to_str().unwrap();

        let report = analyze(path, false).unwrap();
        assert_eq!(report.verdict, Verdict::Fake);
    }

    /// A genuine, honestly-extensioned MP3 must never report `container_mismatch`. Content
    /// sniffing runs unconditionally in `tags::read()` regardless of declared rail, so
    /// `content_rail == Rail::Lossy` alone is true for every ordinary MP3 too — the
    /// `declared_rail == Rail::Lossless` half of the check is load-bearing, not redundant.
    #[test]
    fn analyze_does_not_flag_a_genuine_mp3_as_container_mismatch() {
        let p = "fixtures/real_320.mp3";
        if !std::path::Path::new(p).exists() {
            eprintln!("skip: no fixture");
            return;
        }
        let report = analyze(p, false).unwrap();
        assert_eq!(report.declared_rail, Rail::Lossy);
        assert!(!report.container_mismatch);
    }
}
