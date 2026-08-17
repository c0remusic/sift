//! Windowed FFT (rustfft) → long-term average spectrum (LTAS), cutoff-frequency detection,
//! and a downsampled spectrogram. Online over mono f32 blocks.

use crate::analysis::Spectrogram;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::f32::consts::PI;
use std::sync::{Arc, OnceLock};

/// The FFT size is fixed for the whole app (4096). Planning is not free, so the forward
/// plan is built once and shared across every file's accumulator. `rustfft`'s plans are
/// `Send + Sync`, so an `Arc` behind a `OnceLock` is safe to hand out to the worker threads.
const FFT_SIZE: usize = 4096;
static FFT_PLAN: OnceLock<Arc<dyn Fft<f32>>> = OnceLock::new();

/// Plafond de colonnes temporelles du spectrogramme d'affichage. Au-delà, les colonnes sources
/// sont poolées (voir `build_spectrogram`) : la charge utile reste bornée quelle que soit la
/// durée du morceau.
///
/// ⚠️ **Ce nombre est dupliqué dans `frontend/styles.css`**, où il est déclaré comme
/// `--measure-data` — la mesure « donnée » tranchée par l'issue #9 borne à cette même largeur
/// toute surface qui porte de la donnée mesurée, pour qu'un pixel de spectrogramme reste un
/// pixel de spectrogramme.
///
/// Le désaccord serait **silencieux**, et c'est le mode de défaillance qui compte :
/// - si cette constante baisse et que le CSS reste à 1200, la surface est plus large que sa
///   donnée — le spectrogramme est interpolé et se présente comme mesuré. Pour une app dont le
///   métier est de détecter du faux lossless, afficher du lissé comme du réel est un problème
///   de véracité, pas d'esthétique ;
/// - si elle monte et que le CSS reste à 1200, de l'information analysée n'est jamais montrée.
///
/// Dans les deux cas : aucune erreur, aucun test rouge, rien dans la console.
///
/// D'où [`tests::css_data_measure_matches_max_cols`], qui **lit le fichier CSS réel** et
/// compare. Le motif n'est pas neuf ici : la frontière IPC est un miroir manuel tenu par des
/// tests et non par la discipline (`analysis/mod.rs::spectrogram_shape_matches_contracts_ts`),
/// et `dev_locate.rs` a déjà un test qui va lire dans `frontend/`.
///
/// Tranché le 2026-08-14 (issue #30) contre deux alternatives : faire voyager la valeur par
/// l'IPC — écarté, le contrat `Spectrogram` expose `frames` (le nombre réel de colonnes de CE
/// morceau, donc ≤ 1200 et pas le plafond), donc il aurait fallu AJOUTER un champ au miroir
/// manuel, puis l'épingler à son tour, et accepter une largeur qui dépend d'un appel IPC donc
/// un saut de layout au premier rendu ; assumer la duplication avec un simple commentaire
/// croisé — écarté, un commentaire ne tombe pas.
pub(crate) const MAX_COLS: usize = 1200;

fn shared_fft(fft_size: usize) -> Arc<dyn Fft<f32>> {
    // The shared plan is only valid for the canonical size; any other size (tests) plans ad hoc.
    if fft_size == FFT_SIZE {
        FFT_PLAN
            .get_or_init(|| FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE))
            .clone()
    } else {
        FftPlanner::<f32>::new().plan_fft_forward(fft_size)
    }
}

/// Result of the spectral pass.
pub struct SpectrumResult {
    pub cutoff_hz: f32,
    pub spectrogram: Spectrogram,
}

/// Online windowed-FFT accumulator. Buffers samples into `fft_size` Hann frames (50% hop),
/// accumulates the LTAS, and stores time-downsampled spectrogram columns.
pub struct SpectrumAccumulator {
    sr: u32,
    fft_size: usize,
    hop: usize,
    fft: Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    buf: Vec<f32>,
    /// Reused per-frame FFT input/output buffer (len `fft_size`) — avoids one alloc per frame.
    scratch: Vec<Complex<f32>>,
    /// Reused per-frame magnitude buffer (len `bins`) — avoids one alloc per frame.
    mags: Vec<f32>,
    ltas: Vec<f64>,
    frames_total: u64,
    spec_stride: u64,
    spec_cols: Vec<Vec<u8>>,
    collect_display: bool,
    bins: usize,
    /// `norm_sqr()` of a full-scale sine at this window's coherent gain — the 0 dBFS
    /// reference for the display-only `db` conversion in `process_frame`. Unnormalized FFT
    /// output scales with `fft_size`, so without this a full-scale signal reads as +50 to
    /// +100 dB and gets clipped straight to the `.clamp(-100.0, 0.0)` ceiling.
    ref_mag_sqr: f32,
}

impl SpectrumAccumulator {
    /// `collect_display`: when false, skips storing spectrogram columns entirely (the FFT
    /// still runs for the LTAS/cutoff, so the verdict is unchanged — only the heavy display
    /// grid is not built). The batch worker (M2b) passes false; the UI passes true.
    pub fn new(sr: u32, fft_size: usize, collect_display: bool) -> Self {
        let fft = shared_fft(fft_size);
        let window: Vec<f32> = (0..fft_size)
            .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / (fft_size as f32 - 1.0)).cos())
            .collect();
        let bins = fft_size / 2;
        // Coherent gain = mean window value; a full-scale sine's FFT peak magnitude is
        // `coherent_gain * fft_size / 2` (the /2 from splitting energy across +/- frequency).
        let coherent_gain = window.iter().sum::<f32>() / fft_size as f32;
        let ref_mag = coherent_gain * fft_size as f32 / 2.0;
        Self {
            sr,
            fft_size,
            hop: fft_size / 2,
            fft,
            window,
            buf: Vec::with_capacity(fft_size * 2),
            scratch: vec![Complex { re: 0.0, im: 0.0 }; fft_size],
            mags: vec![0.0f32; bins],
            ltas: vec![0.0; bins],
            frames_total: 0,
            spec_stride: 2,
            spec_cols: Vec::new(),
            collect_display,
            bins,
            ref_mag_sqr: ref_mag * ref_mag,
        }
    }

    pub fn push(&mut self, mono: &[f32]) {
        self.buf.extend_from_slice(mono);
        while self.buf.len() >= self.fft_size {
            self.process_frame();
            self.buf.drain(0..self.hop);
        }
    }

    fn process_frame(&mut self) {
        for i in 0..self.fft_size {
            self.scratch[i] = Complex {
                re: self.buf[i] * self.window[i],
                im: 0.0,
            };
        }
        self.fft.process(&mut self.scratch);
        for k in 0..self.bins {
            let m2 = self.scratch[k].norm_sqr();
            self.ltas[k] += m2 as f64;
            self.mags[k] = m2;
        }
        if self.collect_display && self.frames_total % self.spec_stride == 0 {
            let col: Vec<u8> = self
                .mags
                .iter()
                .map(|&m2| {
                    let db = if m2 <= 1e-12 {
                        -100.0
                    } else {
                        10.0 * (m2 / self.ref_mag_sqr).log10()
                    };
                    let clamped = db.clamp(-100.0, 0.0);
                    ((clamped + 100.0) / 100.0 * 255.0) as u8
                })
                .collect();
            self.spec_cols.push(col);
        }
        self.frames_total += 1;
    }

    /// Detect the cutoff as the **highest sharp relative cliff** in the LTAS.
    ///
    /// A lossy lowpass (MP3/AAC, or an encoder brickwall) leaves a steep drop from real
    /// content down to a much quieter residual. We scan from just below Nyquist downward
    /// and return the highest frequency where the level drops by `DROP_DB` across a ~500 Hz
    /// band. If no such cliff exists, the energy tapers all the way up → genuine full-band
    /// → Nyquist.
    ///
    /// This keys off the *shape* (a relative cliff), not an absolute level relative to the (bass)
    /// spectral peak — which used to make quiet but real treble look "absent" and under-report
    /// the cutoff.
    ///
    /// ⚠️ Cette ligne a longtemps dit « This is robust to bass-heavy music ». **C'était faux, et
    /// mesuré faux le 2026-08-17** : la même propriété de forme qui rattrape un aigu discret rend
    /// aussi le PIED DE BASSE éligible, parce qu'un plateau de graves suivi du médium satisfait
    /// littéralement « chute de `DROP_DB` sur 500 Hz qui ne récupère jamais » — rien au-dessus ne
    /// remonte au niveau des graves. Dix fichiers authentiques de la bibliothèque étaient marqués
    /// FAKE pour cette raison. Ce qui rend maintenant l'affirmation vraie est le
    /// `SEARCH_FLOOR_HZ` ci-dessous, pas la nature relative du critère.
    ///
    /// Deliberately does NOT require the level above the cliff to collapse near the file's
    /// absolute quietest bin (a prior version did — see BUG-2). A real encoder's residual
    /// noise above its lowpass decays gradually over several kHz rather than dropping
    /// straight to true digital silence, so that extra check silently missed real cliffs on
    /// genuine files (measured: -37dB right after a real ~16kHz cliff, only reaching -95dB
    /// ~4kHz later) — only a synthetic true-silence test signal ever satisfied it.
    ///
    /// A relative drop alone isn't enough either, though: a candidate is only accepted if
    /// content never climbs back near the pre-drop level anywhere further up (persistence,
    /// checked relative to `below`, not to an absolute floor). A genuine encoder lowpass
    /// never recovers — its residual keeps decaying or holds low all the way to Nyquist. A
    /// mid-spectrum notch (an EQ dip, a comb-filter null) does recover, which is exactly
    /// what distinguishes "the real cutoff" from "a dip with real content on both sides".
    fn detect_cutoff(&self) -> f32 {
        if self.frames_total == 0 || self.bins < 8 {
            return 0.0;
        }
        let hz_per_bin = self.sr as f32 / self.fft_size as f32;
        let nyq_hz = self.bins as f32 * hz_per_bin;

        let avg_db: Vec<f32> = self
            .ltas
            .iter()
            .map(|&s| {
                let avg = s / self.frames_total as f64;
                if avg <= 1e-12 {
                    -120.0
                } else {
                    10.0 * (avg as f32).log10()
                }
            })
            .collect();

        // small moving-average smoother (~5 bins) to ignore spectral spikes
        let win = 5usize;
        let smooth = |k: usize| -> f32 {
            let lo = k.saturating_sub(win);
            let hi = (k + win + 1).min(self.bins);
            avg_db[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        };

        let band = ((500.0 / hz_per_bin).ceil() as usize).max(2);
        const DROP_DB: f32 = 18.0; // a real cliff drops at least this much across the band
                                   // How close to `below` counts as "recovered" — real encoder residual sits tens of dB
                                   // below the passband (measured: -37dB or lower vs. a ~0dB passband), so recovering to
                                   // within half the required drop is a generous, unambiguous signal of real content
                                   // resuming, not encoder noise jitter.
        const RECOVERY_TOL: f32 = DROP_DB / 2.0;

        let guard = band + win + 1;
        if self.bins <= 2 * guard {
            return nyq_hz;
        }
        // Plancher de balayage — sans lui, le PIED DE BASSE de n'importe quel morceau satisfait le
        // critère de falaise et se fait rendre comme une coupure.
        //
        // Mesuré le 2026-08-17 sur la bibliothèque réelle (2705 pistes analysées) : 10 fichiers
        // rendaient un cutoff entre 571 et 1367 Hz, dont 4 exactement à 571,0 Hz — soit le bin 53,
        // c'est-à-dire `guard` lui-même, le plus bas testable. Un morceau house de 5 minutes n'a
        // pas zéro contenu au-dessus de 571 Hz : c'étaient des faux positifs, tous marqués FAKE.
        //
        // La sonde `ltas_probe` a montré le mécanisme exact, et il n'y avait AUCUNE falaise dans
        // ces fichiers : spectre lisse jusqu'à 21 kHz. La seule chute de 18 dB sur 500 Hz s'y
        // trouve au passage grave->médium (+24 dB à 120 Hz, -0,1 dB à 800 Hz), et rien au-dessus
        // ne remonte à moins de `RECOVERY_TOL` du niveau des GRAVES — donc `recovers` est faux et
        // la boucle rend son propre plancher. Comparé au témoin sain de la même mesure, la seule
        // différence est 4 dB de pente : 17 dB de chute (sous le seuil) contre 21 (au-dessus).
        // Le verdict d'un fichier authentique se jouait à ça.
        //
        // 2 kHz, et pas une valeur ajustée aux fichiers observés : aucun passe-bas d'encodeur ne
        // descend là — le plus bas que ce module ait à juger est le palier 12 000 Hz de
        // `min_cutoff_hz_for_bitrate`, et un MP3 64 kbps coupe encore vers 10-11 kHz. Le plancher
        // est donc au moins cinq fois sous toute coupure réelle, et bien au-dessus du pied de
        // basse. Contrôle sur la même bibliothèque : **zéro fichier** n'a de cutoff entre 1400 et
        // 8400 Hz, donc n'importe quelle valeur de ce trou retire les 10 faux positifs et ne
        // déplace aucune autre mesure. Ce n'est pas un seuil calibré sur un corpus — c'est une
        // borne physique, et le corpus ne fait que confirmer qu'elle ne coûte rien.
        const SEARCH_FLOOR_HZ: f32 = 2000.0;
        let floor_bin = (SEARCH_FLOOR_HZ / hz_per_bin).ceil() as usize;
        let lowest = guard.max(floor_bin);
        if self.bins <= lowest + guard {
            return nyq_hz;
        }
        for k in (lowest..self.bins - guard).rev() {
            let above = (k + 1..=k + band).map(smooth).sum::<f32>() / band as f32;
            let below = (k - band..k).map(smooth).sum::<f32>() / band as f32;
            if below - above < DROP_DB {
                continue;
            }
            let recovers = (k + band + 1..self.bins)
                .step_by(band.max(1))
                .any(|j| smooth(j) >= below - RECOVERY_TOL);
            if !recovers {
                return k as f32 * hz_per_bin;
            }
        }
        // no cliff anywhere → content reaches the top → genuine full-band
        nyq_hz
    }

    pub fn finish(self) -> SpectrumResult {
        let cutoff_hz = self.detect_cutoff();
        SpectrumResult {
            cutoff_hz,
            spectrogram: self.build_spectrogram(),
        }
    }

    /// Builds a display-sized spectrogram: caps time columns to [`MAX_COLS`] and pools the
    /// frequency bins down to ~`DISPLAY_BINS` (max-pool). Keeps the UI payload small and
    /// bounded regardless of track length. Cutoff detection is unaffected — it runs on the
    /// full-resolution LTAS, not on these display columns.
    fn build_spectrogram(&self) -> Spectrogram {
        const DISPLAY_BINS: usize = 384;

        let src_cols = self.spec_cols.len();
        if src_cols == 0 || self.bins == 0 {
            return Spectrogram {
                frames: 0,
                bins: 0,
                hz_per_bin: 0.0,
                sec_per_frame: 0.0,
                mag_db: vec![],
            };
        }

        let col_stride = src_cols.div_ceil(MAX_COLS).max(1);
        let bin_pool = self.bins.div_ceil(DISPLAY_BINS).max(1);
        let out_bins = self.bins.div_ceil(bin_pool);

        let src_hz_per_bin = self.sr as f32 / self.fft_size as f32;
        let hz_per_bin = src_hz_per_bin * bin_pool as f32;
        let sec_per_frame =
            (self.hop as f32 / self.sr as f32) * self.spec_stride as f32 * col_stride as f32;

        let mut out_cols: Vec<Vec<u8>> = Vec::with_capacity(src_cols.div_ceil(col_stride));
        let mut ci = 0;
        while ci < src_cols {
            let col = &self.spec_cols[ci];
            let mut pooled = vec![0u8; out_bins];
            for (b, &v) in col.iter().enumerate().take(self.bins) {
                let ob = b / bin_pool;
                if v > pooled[ob] {
                    pooled[ob] = v;
                }
            }
            out_cols.push(pooled);
            ci += col_stride;
        }

        let frames = out_cols.len();
        let mut mag_db = Vec::with_capacity(frames * out_bins);
        for col in &out_cols {
            mag_db.extend_from_slice(col);
        }
        Spectrogram {
            frames,
            bins: out_bins,
            hz_per_bin,
            sec_per_frame,
            mag_db,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const SR: u32 = 44100;

    /// Sonde de diagnostic — imprime le LTAS lissé d'un fichier RÉEL et ce que `detect_cutoff`
    /// en tire. Ne teste rien : elle existe pour établir un mécanisme au lieu de le déduire du
    /// code, et c'est elle qui a servi à mesurer le plancher de balayage (2026-08-17).
    ///
    /// `SIFT_PROBE_FILE=<chemin> cargo test --manifest-path src-tauri/Cargo.toml --release
    ///   ltas_probe -- --ignored --nocapture`
    ///
    /// `--release` n'est pas décoratif : le décodage complet d'un morceau de 5 minutes en debug
    /// prend des minutes.
    #[test]
    #[ignore]
    fn ltas_probe() {
        let Ok(path) = std::env::var("SIFT_PROBE_FILE") else {
            eprintln!("SIFT_PROBE_FILE non défini — rien à sonder");
            return;
        };
        // Mono (1 canal) : c'est ce que consomme `push`, et le LTAS ne dépend pas de la stéréo.
        // `acc` est construit APRÈS le décodage parce que le taux d'échantillonnage natif n'est
        // connu qu'au retour — le construire à 44100 d'avance fausserait le mapping bin -> Hz sur
        // un fichier 48 k, ce que le test `analysis_uses_native_sample_rate_for_frequency_mapping`
        // épingle par ailleurs.
        let mut blocks: Vec<f32> = Vec::new();
        let info = crate::analysis::decode::decode_pcm(&path, 1, |b| blocks.extend_from_slice(b))
            .expect("décodage");
        let mut acc = SpectrumAccumulator::new(info.sample_rate, FFT_SIZE, false);
        acc.push(&blocks);

        let hz_per_bin = acc.sr as f32 / acc.fft_size as f32;
        let avg_db: Vec<f32> = acc
            .ltas
            .iter()
            .map(|&s| {
                let avg = s / acc.frames_total as f64;
                if avg <= 1e-12 {
                    -120.0
                } else {
                    10.0 * (avg as f32).log10()
                }
            })
            .collect();
        let win = 5usize;
        let smooth = |k: usize| -> f32 {
            let lo = k.saturating_sub(win);
            let hi = (k + win + 1).min(acc.bins);
            avg_db[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        };

        println!("--- {path}");
        println!(
            "sr={} bins={} hz_per_bin={:.3} frames={} cutoff={:.0} Hz",
            acc.sr,
            acc.bins,
            hz_per_bin,
            acc.frames_total,
            acc.detect_cutoff()
        );
        println!("   Hz      dB(lissé)");
        for hz in [
            60.0f32, 120.0, 250.0, 500.0, 571.0, 800.0, 1000.0, 2000.0, 4000.0, 8000.0, 12000.0,
            14000.0, 16000.0, 18000.0, 19000.0, 20000.0, 21000.0,
        ] {
            let k = (hz / hz_per_bin).round() as usize;
            if k < acc.bins {
                println!("{hz:8.0}   {:8.1}", smooth(k));
            }
        }
    }

    /// Épingle la duplication de [`MAX_COLS`] entre le Rust et `frontend/styles.css` (issue #30).
    ///
    /// Le test lit le fichier CSS **réel** — pas une copie, pas une constante recopiée ici, ce
    /// qui ne prouverait rien — et compare la valeur du token `--measure-data` à `MAX_COLS`.
    /// Éditer l'un sans l'autre fait tomber ce test, ce qui est exactement le point : le
    /// désaccord des deux déclarations est autrement silencieux (voir le commentaire de
    /// `MAX_COLS` pour les deux modes de défaillance).
    ///
    /// Chemin résolu comme dans `dev_locate::frontend_dir` : `CARGO_MANIFEST_DIR` est
    /// `src-tauri/`, donc le dépôt est son parent. Volontairement pas de `unwrap()` masqué —
    /// un fichier introuvable doit dire lequel, pas paniquer sur un `Option` nu.
    #[test]
    fn css_data_measure_matches_max_cols() {
        let css_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri/ a toujours un parent (la racine du dépôt)")
            .join("frontend")
            .join("styles.css");
        let css = std::fs::read_to_string(&css_path)
            .unwrap_or_else(|e| panic!("lecture de {} impossible: {e}", css_path.display()));

        // `--measure-data:1200px` — on tolère les espaces autour du `:` mais pas l'absence du
        // token : sa disparition doit casser, pas passer inaperçue.
        let decl = css
            .split("--measure-data")
            .nth(1)
            .unwrap_or_else(|| panic!("token --measure-data absent de {}", css_path.display()));
        let value: String = decl
            .trim_start()
            .strip_prefix(':')
            .unwrap_or_else(|| panic!("--measure-data n'est pas suivi de ':' dans styles.css"))
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();

        let css_px: usize = value.parse().unwrap_or_else(|e| {
            panic!("valeur de --measure-data illisible ({value:?}) dans styles.css: {e}")
        });

        assert_eq!(
            css_px, MAX_COLS,
            "--measure-data ({css_px}px) et analysis::spectrum::MAX_COLS ({MAX_COLS}) ont \
             divergé. Les deux bornent la MÊME chose — la largeur utile d'une surface de \
             donnée. Les remettre d'accord, ou changer la décision de l'issue #9 explicitement."
        );
    }

    /// Hard band-limited signal: a dense sum of equal-amplitude sine tones spaced every
    /// 100 Hz from 100 Hz up to `top_hz`. There is **no** energy above `top_hz`, so the
    /// detector should report a cutoff at ~`top_hz` — this models the sharp lowpass cliff
    /// of a lossy transcode (the real fake-detection target), not a gentle analog rolloff.
    fn band_limited_tones(sr: u32, secs: f32, top_hz: f32) -> Vec<f32> {
        let n = (sr as f32 * secs) as usize;
        let freqs: Vec<f32> = (1..)
            .map(|k| k as f32 * 100.0)
            .take_while(|&f| f <= top_hz)
            .collect();
        let amp = 0.5 / freqs.len() as f32;
        (0..n)
            .map(|i| {
                let t = i as f32 / sr as f32;
                freqs.iter().map(|&f| (2.0 * PI * f * t).sin()).sum::<f32>() * amp
            })
            .collect()
    }

    #[test]
    fn cutoff_detected_near_hard_band_edge() {
        let sig = band_limited_tones(SR, 2.0, 6000.0);
        let mut a = SpectrumAccumulator::new(SR, 4096, true);
        a.push(&sig);
        let report = a.finish();
        assert!(
            report.cutoff_hz > 5000.0 && report.cutoff_hz < 7500.0,
            "cutoff {} should sit at the ~6 kHz hard edge",
            report.cutoff_hz
        );
        assert!(report.spectrogram.frames > 0);
        assert!(report.spectrogram.bins > 0);
    }

    #[test]
    fn full_band_noise_reports_high_cutoff() {
        let n = (SR as f32 * 2.0) as usize;
        let mut seed = 777u32;
        let mut sig = Vec::with_capacity(n);
        for _ in 0..n {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            sig.push((seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0);
        }
        let mut a = SpectrumAccumulator::new(SR, 4096, true);
        a.push(&sig);
        let report = a.finish();
        assert!(
            report.cutoff_hz > 18000.0,
            "cutoff {} should be near Nyquist",
            report.cutoff_hz
        );
    }

    /// Reproduces the exact LTAS shape measured on a real, honestly-labelled 320kbps MP3
    /// with a genuine ~16kHz encoder cliff (BUG-2 field case: "Sven Dohse - All In.mp3").
    /// A real lossy encoder's residual noise above its lowpass does NOT collapse to true
    /// digital silence — it decays gradually over several kHz (measured: -2.7dB just before
    /// the cliff, -37.3dB right after it, only reaching -95dB roughly 4kHz later). The
    /// previous detector required the level right after the cliff to already sit within
    /// 10dB of the file's absolute quietest bin, which this real, gradually-decaying shape
    /// never satisfies — so it fell through and reported Nyquist (no cliff found) instead of
    /// the obvious ~16kHz drop. The detector must catch the cliff by its RELATIVE drop alone.
    #[test]
    fn cutoff_detected_on_real_world_gradual_decay_shape() {
        // (freq_hz, dB) control points measured directly from the real file's LTAS.
        const POINTS: &[(f32, f32)] = &[
            (10121.0, 2.7),
            (10627.0, 3.6),
            (11133.0, 1.2),
            (11639.0, 1.0),
            (12145.0, 0.8),
            (12651.0, 0.4),
            (13157.0, 0.2),
            (13663.0, -0.6),
            (14169.0, -1.4),
            (14675.0, -1.6),
            (15181.0, -2.1),
            (15687.0, -2.7),
            (16193.0, -37.3),
            (16699.0, -57.7),
            (17205.0, -66.4),
            (17711.0, -71.4),
            (18217.0, -74.3),
            (18723.0, -78.7),
            (19229.0, -72.1),
            (19735.0, -83.0),
            (20241.0, -94.4),
            (20747.0, -76.3),
            (21253.0, -93.3),
            (21759.0, -92.4),
        ];
        fn interp_db(freq: f32) -> f32 {
            if freq <= POINTS[0].0 {
                return POINTS[0].1;
            }
            for w in POINTS.windows(2) {
                let (f0, d0) = w[0];
                let (f1, d1) = w[1];
                if freq <= f1 {
                    let t = (freq - f0) / (f1 - f0);
                    return d0 + t * (d1 - d0);
                }
            }
            POINTS.last().unwrap().1
        }

        let mut a = SpectrumAccumulator::new(SR, 4096, false);
        let hz_per_bin = a.sr as f32 / a.fft_size as f32;
        a.frames_total = 1;
        for k in 0..a.bins {
            let db = interp_db(k as f32 * hz_per_bin);
            a.ltas[k] = 10f64.powf(db as f64 / 10.0);
        }
        let report = a.finish();
        assert!(
            report.cutoff_hz > 15500.0 && report.cutoff_hz < 17000.0,
            "cutoff {} should sit at the ~16.2kHz cliff despite gradual residual decay above it \
             (a real encoder never collapses to true digital silence within one averaging band)",
            report.cutoff_hz
        );
    }

    /// Un master lossless authentique à BASSES DOMINANTES ne doit pas voir son pied de basse
    /// rendu comme une coupure.
    ///
    /// Forme LTAS **mesurée** (sonde `ltas_probe`, 2026-08-17) sur
    /// `[0012] QA 0-127 - Millennium.aif` — un morceau house de 4 min que le détecteur rendait à
    /// **571 Hz**, donc marqué FAKE. Il n'y a aucune falaise dans ce fichier : le spectre descend
    /// sans rupture jusqu'à 21 kHz. La seule chute de 18 dB sur 500 Hz est le passage
    /// grave->médium, et rien au-dessus ne remonte à moins de `RECOVERY_TOL` du niveau des graves,
    /// donc `recovers` était faux et la boucle rendait son propre plancher (bin 53 = 571 Hz —
    /// quatre fichiers de la bibliothèque atterrissaient sur cette valeur exacte).
    ///
    /// Le test ne vérifie pas seulement « pas 571 » mais « au moins 20 kHz » : rendre une valeur
    /// intermédiaire serait tout aussi faux, et un `assert_ne!` laisserait passer ça.
    ///
    /// ⚠️ **La forme ci-dessous est synthétique, pas le relevé du fichier.** Une première version
    /// de ce test rejouait les 18 points mesurés tels quels et **passait aussi sans le
    /// correctif** — donc ne gardait rien. Raison, calculée : `below` et `above` sont des moyennes
    /// sur des bandes de 47 bins, et une interpolation linéaire entre des points espacés de
    /// 130 à 250 Hz adoucit la transition grave->médium à **16,3 dB** de chute, sous le seuil de
    /// 18 — là où le fichier réel donne 21. Le relevé grossier ne reproduit pas sa propre panne.
    ///
    /// La forme retenue garde donc les niveaux mesurés (plateau de basse ~+25 dB, médium à 0,
    /// descente continue jusqu'à -35 dB au Nyquist) mais place la transition sur une largeur
    /// serrée, pour que la condition de falaise soit franchement satisfaite au pied de basse. Ce
    /// que le test épingle est la **classe** de panne — un plateau de basse dominant suivi d'une
    /// pente douce sans rupture — pas un fichier particulier.
    #[test]
    fn bass_heavy_lossless_master_does_not_report_its_bass_shelf_as_a_cutoff() {
        const POINTS: &[(f32, f32)] = &[
            (0.0, 25.0),
            (450.0, 25.0),
            (700.0, 0.0),
            (2000.0, -4.9),
            (4000.0, -7.1),
            (8000.0, -9.2),
            (12000.0, -9.7),
            (14000.0, -12.6),
            (16000.0, -16.9),
            (18000.0, -23.6),
            (19000.0, -28.7),
            (20000.0, -30.4),
            (21000.0, -36.4),
            (22050.0, -38.0),
        ];
        fn interp_db(freq: f32) -> f32 {
            if freq <= POINTS[0].0 {
                return POINTS[0].1;
            }
            for w in POINTS.windows(2) {
                let (f0, d0) = w[0];
                let (f1, d1) = w[1];
                if freq <= f1 {
                    let t = (freq - f0) / (f1 - f0);
                    return d0 + t * (d1 - d0);
                }
            }
            POINTS.last().expect("POINTS non vide").1
        }

        let mut a = SpectrumAccumulator::new(SR, 4096, false);
        let hz_per_bin = a.sr as f32 / a.fft_size as f32;
        a.frames_total = 1;
        for k in 0..a.bins {
            a.ltas[k] = 10f64.powf(interp_db(k as f32 * hz_per_bin) as f64 / 10.0);
        }
        let report = a.finish();
        assert!(
            report.cutoff_hz >= 20000.0,
            "cutoff {} : ce master n'a aucune falaise, sa pente est continue jusqu'a 21 kHz — \
             tout ce qui est sous 20 kHz est le pied de basse pris pour une coupure",
            report.cutoff_hz
        );
    }

    /// A genuine full-band lossless master with a mid-spectrum notch (a mastering EQ dip, a
    /// comb-filter null, a de-esser working across a wide band) must NOT be reported as
    /// having a cutoff at the notch — real content resumes above it, unlike a genuine
    /// encoder lowpass where nothing meaningful ever returns. A relative-drop-only check
    /// (no persistence requirement) latches onto the notch's lower edge instead: flat 0dB,
    /// dip to -25dB across ~18.0-18.5kHz, recovered to 0dB from 19kHz to Nyquist.
    #[test]
    fn full_band_content_with_a_mid_spectrum_notch_is_not_a_cutoff() {
        const POINTS: &[(f32, f32)] = &[
            (0.0, 0.0),
            (17500.0, 0.0),
            (18000.0, -25.0),
            (18500.0, -25.0),
            (19000.0, 0.0),
            (22050.0, 0.0),
        ];
        fn interp_db(freq: f32) -> f32 {
            if freq <= POINTS[0].0 {
                return POINTS[0].1;
            }
            for w in POINTS.windows(2) {
                let (f0, d0) = w[0];
                let (f1, d1) = w[1];
                if freq <= f1 {
                    let t = (freq - f0) / (f1 - f0);
                    return d0 + t * (d1 - d0);
                }
            }
            POINTS.last().unwrap().1
        }

        let mut a = SpectrumAccumulator::new(SR, 4096, false);
        let hz_per_bin = a.sr as f32 / a.fft_size as f32;
        a.frames_total = 1;
        for k in 0..a.bins {
            let db = interp_db(k as f32 * hz_per_bin);
            a.ltas[k] = 10f64.powf(db as f64 / 10.0);
        }
        let report = a.finish();
        assert!(
            report.cutoff_hz > 20000.0,
            "cutoff {} should report near Nyquist (genuine full-band content resumes above \
             the notch) instead of latching onto the notch's lower edge as a false cutoff",
            report.cutoff_hz
        );
    }
}
