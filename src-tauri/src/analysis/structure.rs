//! Silence head/tail (ms) and end-truncation heuristic, online over mono f32 blocks.

/// Measures leading and trailing silence. `threshold` is linear amplitude.
pub struct SilenceAccumulator {
    sr: u32,
    threshold: f32,
    seen_sound: bool,
    head_samples: u64,
    tail_samples: u64,
    total: u64,
}
impl SilenceAccumulator {
    pub fn new(sr: u32, threshold: f32) -> Self {
        Self {
            sr,
            threshold,
            seen_sound: false,
            head_samples: 0,
            tail_samples: 0,
            total: 0,
        }
    }
    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            self.total += 1;
            if s.abs() <= self.threshold {
                if !self.seen_sound {
                    self.head_samples += 1;
                }
                self.tail_samples += 1;
            } else {
                self.seen_sound = true;
                self.tail_samples = 0;
            }
        }
    }
    /// (head_ms, tail_ms). All-silent files report head = full length, tail = 0.
    pub fn finish(&self) -> (u32, u32) {
        let to_ms = |n: u64| ((n as f64 / self.sr as f64) * 1000.0) as u32;
        if !self.seen_sound {
            return (to_ms(self.total), 0);
        }
        (to_ms(self.head_samples), to_ms(self.tail_samples))
    }
}

/// Flags likely truncation: end-of-file energy that doesn't decay (abrupt cut), or a
/// decode error at EOF. Compares mean energy of the last ~200 ms against the global mean.
pub struct TruncationAccumulator {
    tail_len: usize,
    tail: Vec<f32>,
    pos: usize,
    filled: usize,
    global_sq: f64,
    n: u64,
}
impl TruncationAccumulator {
    pub fn new(sr: u32) -> Self {
        let tail_len = (sr as usize) / 5; // 200 ms
        Self {
            tail_len,
            tail: vec![0.0; tail_len],
            pos: 0,
            filled: 0,
            global_sq: 0.0,
            n: 0,
        }
    }
    pub fn push(&mut self, mono: &[f32]) {
        for &s in mono {
            let a = s.abs();
            self.global_sq += (a as f64) * (a as f64);
            self.n += 1;
            self.tail[self.pos] = a;
            self.pos = (self.pos + 1) % self.tail_len;
            if self.filled < self.tail_len {
                self.filled += 1;
            }
        }
    }
    /// `decode_error` = ffmpeg reported a terminal error → always truncated.
    pub fn finish(&self, decode_error: bool) -> bool {
        if decode_error {
            return true;
        }
        if self.n == 0 || self.filled == 0 {
            return false;
        }
        // ⚠️ CETTE RMS EST LE SEUL NIVEAU MOYEN GLOBAL DE TOUTE L'ANALYSE, et elle ne sert qu'à
        // la comparaison de queue ci-dessous. La tentation évidente — « le facteur de crête est
        // gratuit, `true_peak_dbtp` est calculé sur le MÊME downmix mono (`mod.rs:490-498`), il
        // ne manque qu'un getter et un `sqrt` » — a été MESURÉE le 2026-09-22, et elle ne tient
        // pas.
        //
        // 239 faux et 239 authentiques de la vraie bibliothèque, appariés conteneur pour
        // conteneur (aif 92 / mp3 85 / wav 30 / aiff 21 / flac 11 des deux côtés), une seule
        // passe de décodage. Facteur de crête global : AUC 0,501, IC95 [0,450 ; 0,557]. Les cinq
        // autres candidats de dynamique tombent entre 0,504 et 0,516, et l'IC95 de chacun
        // contient 0,5. À n=239/239, l'espérance de l'AUC orientée SOUS L'HYPOTHÈSE NULLE vaut
        // 0,521 : les six observés sont donc SOUS le nul — « entre 0,50 et 0,55 » n'est pas un
        // plafond constaté, c'est la bande nulle elle-même.
        //
        // Le chiffre qui décide ne dépend pas de l'effectif : l'écart des MÉDIANES de crête entre
        // les deux groupes est de 0,30 dB, quand l'étendue p10-p90 À L'INTÉRIEUR de chaque groupe
        // fait 6,4 dB. Le signal inter-groupe vaut 5 % de la dispersion intra-groupe, d de Cohen
        // 0,003. La crête varie vingt fois plus d'un master à l'autre qu'entre vrai et faux :
        // c'est une signature de MASTERING, pas de codec. Sift mesure l'authenticité.
        //
        // Et cette RMS-ci ne serait même pas la bonne : les sommes ci-dessus ne sont pas
        // segmentées, donc elle inclut le silence de tête et de queue.
        //
        // Ce qui rouvrirait le sujet, et rien d'autre : une VÉRITÉ TERRAIN indépendante du
        // spectre (des achats appariés à leur master). Détail, limites et données :
        // `docs/ressources-externes.md` § Écarté.
        let global_rms = (self.global_sq / self.n as f64).sqrt();
        let tail_sq: f64 = self
            .tail
            .iter()
            .take(self.filled)
            .map(|&a| (a as f64) * (a as f64))
            .sum();
        let tail_rms = (tail_sq / self.filled as f64).sqrt();
        // abrupt cut: end is still ≥ 50% of the track's overall energy (no fade/decay)
        global_rms > 1e-4 && tail_rms >= 0.5 * global_rms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(n: usize, v: f32) -> Vec<f32> {
        vec![v; n]
    }

    #[test]
    fn silence_head_and_tail_measured_in_ms() {
        let mut a = SilenceAccumulator::new(44100, 0.001);
        a.push(&block(4410, 0.0));
        a.push(&block(4410, 0.5));
        a.push(&block(8820, 0.0));
        let (head, tail) = a.finish();
        assert!((head as i64 - 100).abs() <= 2, "head {head}");
        assert!((tail as i64 - 200).abs() <= 2, "tail {tail}");
    }

    #[test]
    fn no_silence_when_signal_fills_buffer() {
        let mut a = SilenceAccumulator::new(44100, 0.001);
        a.push(&block(44100, 0.5));
        assert_eq!(a.finish(), (0, 0));
    }

    #[test]
    fn truncation_flagged_when_end_energy_does_not_decay() {
        let mut a = TruncationAccumulator::new(44100);
        a.push(&block(88200, 0.6));
        assert!(
            a.finish(false),
            "abrupt high-energy end should flag truncation"
        );
    }

    #[test]
    fn no_truncation_when_end_decays() {
        let mut a = TruncationAccumulator::new(44100);
        a.push(&block(44100, 0.6));
        a.push(&block(44100, 0.0));
        assert!(!a.finish(false));
    }

    #[test]
    fn truncation_flagged_on_decode_error_regardless() {
        let mut a = TruncationAccumulator::new(44100);
        a.push(&block(44100, 0.0));
        assert!(a.finish(true), "decode error at EOF forces truncated");
    }
}
