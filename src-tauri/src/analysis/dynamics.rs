//! Online dynamics analyzers over mono f32 blocks: DC offset, clipping, true-peak.

/// Running mean of the signal → DC offset.
#[derive(Default)]
pub struct DcAccumulator {
    sum: f64,
    n: u64,
}
impl DcAccumulator {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            self.sum += s as f64;
        }
        self.n += mono.len() as u64;
    }
    pub fn finish(&self) -> f32 {
        if self.n == 0 {
            0.0
        } else {
            (self.sum / self.n as f64) as f32
        }
    }
}

/// Counts runs of consecutive near-full-scale samples and overall clipped percentage.
pub struct ClipAccumulator {
    threshold: f32,
    min_run: usize,
    cur_run: usize,
    runs: u32,
    clipped: u64,
    total: u64,
}
impl ClipAccumulator {
    pub fn new(threshold: f32, min_run: usize) -> Self {
        Self {
            threshold,
            min_run,
            cur_run: 0,
            runs: 0,
            clipped: 0,
            total: 0,
        }
    }
    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            self.total += 1;
            if s.abs() >= self.threshold {
                self.clipped += 1;
                self.cur_run += 1;
                if self.cur_run == self.min_run {
                    self.runs += 1;
                }
            } else {
                self.cur_run = 0;
            }
        }
    }
    pub fn finish(&self) -> (u32, f32) {
        let pct = if self.total == 0 {
            0.0
        } else {
            self.clipped as f32 / self.total as f32 * 100.0
        };
        (self.runs, pct)
    }
}

/// Sample peak, in dBFS. **Despite the name, this is NOT a true-peak meter**, and the 4×
/// oversampling below is a mathematical no-op.
///
/// ⚠️ Linear interpolation between two samples attains its extremum at an endpoint, so
/// `|interp| <= max(|a|, |b|)` ALWAYS, and at `k == 4` it returns `s` exactly. The running max
/// therefore equals `max |s|` over the signal — the oversampling loop cannot raise it by a
/// single dB. Inter-sample overs are exactly what a true-peak meter exists to find, and this
/// construction is incapable of finding one. Measured 2026-09-22, and pinned by
/// `l_interpolation_lineaire_ne_peut_pas_depasser_le_pic_d_echantillon` below.
///
/// The doc-comment here claimed until that date that linear interp was "an approximation of a
/// proper polyphase upsampler — adequate for a *too hot* flag". It is not an approximation of
/// one; it carries zero information a plain `max |s|` does not. The two tests that guarded it
/// (`[1.0, -1.0, ...]`, `[0.5, -0.5, ...]`) pass identically on a bare sample peak, so they
/// never touched the inter-sample behaviour and stayed green throughout.
///
/// WHY THE ALGORITHM IS NOT BEING FIXED, and this is a measurement, not an omission. A real 4×
/// BS.1770 true peak was built and run against 239 fakes + 239 authentic tracks from the real
/// library, matched container-for-container (2026-09-22). It separates no better — AUC 0.506,
/// CI95 [0.455 ; 0.563] — and **113 of the 239 AUTHENTIC tracks exceed 0 dBTP**, the largest
/// over in the whole sample (+4.317 dB) being an authentic one. So a true reading would buy no
/// authenticity signal, while changing every stored value: a `REPORT_CACHE_VERSION` bump and
/// ~2 h 47 of re-analysis over 3397 tracks. The value is correct AS a sample peak; only the
/// name and the label were wrong, and those are what changed.
///
/// The field keeps its identifier (`true_peak_dbtp`) on purpose: it is a `tracks` column and an
/// IPC contract field, and renaming it would cost a schema migration for zero user benefit
/// (`CLAUDE.md` § db.rs). The USER-FACING label says "Pic d'échantillon … dBFS"
/// (`report-view.ts`), which is what the number actually is.
#[derive(Default)]
pub struct TruePeakAccumulator {
    peak: f32,
    last: f32,
    seen: bool,
}
impl TruePeakAccumulator {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            if self.seen {
                for k in 1..=4 {
                    let t = k as f32 / 4.0;
                    let interp = self.last + (s - self.last) * t;
                    self.peak = self.peak.max(interp.abs());
                }
            } else {
                self.peak = self.peak.max(s.abs());
                self.seen = true;
            }
            self.last = s;
        }
    }
    pub fn finish(&self) -> f32 {
        if self.peak <= 0.0 {
            -120.0
        } else {
            20.0 * self.peak.log10()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dc_offset_of_centered_signal_is_zero() {
        let mut a = DcAccumulator::new();
        a.push(&[-0.5, 0.5, -0.5, 0.5]);
        assert!(a.finish().abs() < 1e-6);
    }

    #[test]
    fn dc_offset_detects_bias() {
        let mut a = DcAccumulator::new();
        a.push(&[0.2, 0.2, 0.2, 0.2]);
        assert!((a.finish() - 0.2).abs() < 1e-6);
    }

    #[test]
    fn clipping_counts_runs_and_pct() {
        let mut a = ClipAccumulator::new(0.99, 3);
        a.push(&[1.0, 1.0, 1.0, 0.1, 1.0, 0.1, 0.1, 0.1, 0.1, 0.1]);
        let (runs, pct) = a.finish();
        assert_eq!(runs, 1, "only the length-3 run counts");
        assert!((pct - 40.0).abs() < 1e-3);
    }

    #[test]
    fn true_peak_of_full_scale_is_about_zero_dbtp() {
        let mut a = TruePeakAccumulator::new();
        a.push(&[1.0, -1.0, 1.0, -1.0]);
        assert!(a.finish() >= -0.1, "got {}", a.finish());
    }

    #[test]
    fn true_peak_of_half_scale_is_about_minus_6_dbtp() {
        let mut a = TruePeakAccumulator::new();
        a.push(&[0.5, -0.5, 0.5, -0.5]);
        let v = a.finish();
        assert!((v - (-6.02)).abs() < 1.0, "got {}", v);
    }

    /// Le cas qui PROUVE que le suréchantillonnage ne fait rien : une sinusoïde à fs/4 déphasée
    /// de 45° n'est échantillonnée qu'à ±0,7071, alors que la forme d'onde continue atteint 1,0.
    /// Un vrai pic rendrait 0 dBTP ; celui-ci rend −3,01 dB, la valeur du pic d'échantillon.
    ///
    /// Les deux tests au-dessus ne voient pas ça : leurs échantillons SONT déjà aux extrêmes,
    /// donc pic d'échantillon et vrai pic coïncident, et ils passeraient sur n'importe quelle
    /// implémentation. Celui-ci sépare les deux, et c'est la seule raison de son existence.
    #[test]
    fn l_interpolation_lineaire_ne_peut_pas_depasser_le_pic_d_echantillon() {
        // fs/4, phase 45° : sin(2·pi·n/4 + pi/4) donne +r, +r, −r, −r avec r = 1/racine(2).
        let r = std::f32::consts::FRAC_1_SQRT_2;
        let mut a = TruePeakAccumulator::new();
        a.push(&[r, r, -r, -r, r, r, -r, -r]);
        let lu = a.finish();

        let pic_echantillon = 20.0 * r.log10();
        assert!(
            (lu - pic_echantillon).abs() < 1e-4,
            "l'accumulateur doit EGALER le pic d'echantillon ({pic_echantillon} dB), a rendu {lu}"
        );
        // Et il reste donc loin des 0 dBTP qu'un vrai pic rendrait sur ce signal.
        assert!(lu < -2.9, "un vrai pic rendrait ~0 dBTP ici ; lu = {lu}");
    }

    /// Le corollaire général, sur du signal quelconque : l'accumulateur ne dépasse JAMAIS
    /// `max |s|`. Ce test tomberait si quelqu'un remplaçait l'interpolation linéaire par un vrai
    /// suréchantillonneur — précisément le changement dangereux, parce qu'il modifie toute
    /// valeur déjà en cache sans bump de `REPORT_CACHE_VERSION`.
    #[test]
    fn l_accumulateur_egale_le_maximum_absolu_du_signal() {
        let signal: Vec<f32> = (0..512)
            .map(|n| 0.8 * ((n as f32) * 0.37).sin() + 0.15 * ((n as f32) * 2.9).sin())
            .collect();
        let attendu = signal.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        let mut a = TruePeakAccumulator::new();
        a.push(&signal);
        let lu = 10f32.powf(a.finish() / 20.0);
        assert!(
            (lu - attendu).abs() < 1e-5,
            "attendu le max absolu {attendu}, lu {lu}"
        );
    }
}
