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
            self.scratch[i] = Complex { re: self.buf[i] * self.window[i], im: 0.0 };
        }
        self.fft.process(&mut self.scratch);
        for k in 0..self.bins {
            let m2 = self.scratch[k].norm_sqr();
            self.ltas[k] += m2 as f64;
            self.mags[k] = m2;
        }
        if self.collect_display && self.frames_total % self.spec_stride == 0 {
            let col: Vec<u8> = self.mags.iter().map(|&m2| {
                let db = if m2 <= 1e-12 {
                    -100.0
                } else {
                    10.0 * (m2 / self.ref_mag_sqr).log10()
                };
                let clamped = db.clamp(-100.0, 0.0);
                ((clamped + 100.0) / 100.0 * 255.0) as u8
            }).collect();
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
    /// This is robust to bass-heavy music: it keys off the *shape* (a relative cliff), not
    /// an absolute level relative to the (bass) spectral peak — which used to make quiet but
    /// real treble look "absent" and under-report the cutoff.
    ///
    /// Deliberately does NOT require the level above the cliff to collapse near the file's
    /// absolute quietest bin (a prior version did — see BUG-2). A real encoder's residual
    /// noise above its lowpass decays gradually over several kHz rather than dropping
    /// straight to true digital silence, so that extra check silently missed real cliffs on
    /// genuine files (measured: -37dB right after a real ~16kHz cliff, only reaching -95dB
    /// ~4kHz later) — only a synthetic true-silence test signal ever satisfied it.
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
                if avg <= 1e-12 { -120.0 } else { 10.0 * (avg as f32).log10() }
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

        let guard = band + win + 1;
        if self.bins <= 2 * guard {
            return nyq_hz;
        }
        for k in (guard..self.bins - guard).rev() {
            let above = (k + 1..=k + band).map(smooth).sum::<f32>() / band as f32;
            let below = (k - band..k).map(smooth).sum::<f32>() / band as f32;
            if below - above >= DROP_DB {
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

    /// Builds a display-sized spectrogram: caps time columns to `MAX_COLS` and pools the
    /// frequency bins down to ~`DISPLAY_BINS` (max-pool). Keeps the UI payload small and
    /// bounded regardless of track length. Cutoff detection is unaffected — it runs on the
    /// full-resolution LTAS, not on these display columns.
    fn build_spectrogram(&self) -> Spectrogram {
        const MAX_COLS: usize = 1200;
        const DISPLAY_BINS: usize = 384;

        let src_cols = self.spec_cols.len();
        if src_cols == 0 || self.bins == 0 {
            return Spectrogram { frames: 0, bins: 0, hz_per_bin: 0.0, sec_per_frame: 0.0, mag_db: vec![] };
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
                if v > pooled[ob] { pooled[ob] = v; }
            }
            out_cols.push(pooled);
            ci += col_stride;
        }

        let frames = out_cols.len();
        let mut mag_db = Vec::with_capacity(frames * out_bins);
        for col in &out_cols { mag_db.extend_from_slice(col); }
        Spectrogram { frames, bins: out_bins, hz_per_bin, sec_per_frame, mag_db }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const SR: u32 = 44100;

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
        assert!(report.cutoff_hz > 5000.0 && report.cutoff_hz < 7500.0,
            "cutoff {} should sit at the ~6 kHz hard edge", report.cutoff_hz);
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
        assert!(report.cutoff_hz > 18000.0, "cutoff {} should be near Nyquist", report.cutoff_hz);
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
            (10121.0, 2.7), (10627.0, 3.6), (11133.0, 1.2), (11639.0, 1.0),
            (12145.0, 0.8), (12651.0, 0.4), (13157.0, 0.2), (13663.0, -0.6),
            (14169.0, -1.4), (14675.0, -1.6), (15181.0, -2.1), (15687.0, -2.7),
            (16193.0, -37.3), (16699.0, -57.7), (17205.0, -66.4), (17711.0, -71.4),
            (18217.0, -74.3), (18723.0, -78.7), (19229.0, -72.1), (19735.0, -83.0),
            (20241.0, -94.4), (20747.0, -76.3), (21253.0, -93.3), (21759.0, -92.4),
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
        assert!(report.cutoff_hz > 15500.0 && report.cutoff_hz < 17000.0,
            "cutoff {} should sit at the ~16.2kHz cliff despite gradual residual decay above it \
             (a real encoder never collapses to true digital silence within one averaging band)",
            report.cutoff_hz);
    }
}
