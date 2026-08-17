//! Pure verdict logic, keyed on the detected cutoff + DECLARED rail/bitrate.
//!
//! Two frauds are flagged as `Fake`:
//! 1. **Fake lossless** — declared FLAC/WAV/AIFF but the spectrum shows a lossy lowpass cliff.
//! 2. **Over-encoded lossy** — declared e.g. 320 kbps MP3 but the cutoff is far below what
//!    that bitrate produces → it was re-encoded UP from a lower-quality source.
//!
//! An honestly-labelled low-bitrate MP3 (cutoff matches its bitrate) stays `Ok` here — its
//! "below the user's quality threshold" handling is a separate axis (M4 rules).

use crate::analysis::{Rail, Verdict};

/// Decision bands (Hz) for a file DECLARED lossless. `cutoff_hz` is stored raw upstream so
/// these thresholds stay reconfigurable without re-analysis (Réglages, M2b+).
pub const LOSSLESS_OK_HZ: f32 = 20000.0; // ≥ → authentic lossless
pub const LOSSY_CLIFF_HZ: f32 = 19500.0; // ≤ → lossy lowpass cliff → fake
                                         // (LOSSY_CLIFF_HZ, LOSSLESS_OK_HZ) → grey zone

/// Ce que rend `spectrum::detect_cutoff` quand il n'avait **rien à mesurer** — aucune trame
/// décodée. Ce n'est pas une coupure à 0 Hz : c'est l'absence de mesure.
///
/// La valeur est un sentinel sans ambiguïté, et pas par convention : les deux seules autres
/// sorties de `detect_cutoff` sont `k * hz_per_bin` avec `k` au-dessus de son plancher de
/// balayage (donc > 2 kHz) et `nyq_hz`. Zéro n'est atteignable que par le retour anticipé.
///
/// Mesuré le 2026-08-17 sur la bibliothèque réelle : **deux MP3** de plus de six minutes,
/// déclarés 320 kbps, `codec_error` NULL — donc aucune erreur remontée nulle part — rendaient
/// `cutoff_hz = 0`, que `verdict()` lisait comme « coupe à 0 Hz, très en dessous du plancher de
/// 19 000 pour du 320 » et marquait FAKE. Un échec de décodage se présentait comme une preuve
/// de fraude.
pub const NO_MEASUREMENT_HZ: f32 = 0.0;

/// Minimum cutoff a *genuine* MP3 of the given bitrate should reach (≈ encoder lowpass minus
/// a margin for genre/encoder spread). A declared bitrate whose real cutoff is below this is
/// over-encoded (transcoded up from a worse source).
pub fn min_cutoff_hz_for_bitrate(kbps: u32) -> f32 {
    match kbps {
        b if b >= 320 => 19000.0,
        b if b >= 256 => 18000.0,
        b if b >= 192 => 16500.0,
        b if b >= 160 => 15500.0,
        b if b >= 128 => 14500.0,
        _ => 12000.0,
    }
}

/// Equivalent lossy bitrate for a measured cutoff, read off the SAME tiers `verdict()` uses to
/// call a bitrate over-encoded (FIX-11: this used to be duplicated in report-view.ts with a
/// shifted table — e.g. a cutoff the verdict logic scored against the 192kbps band showed as
/// "≈256 kbps" in the UI). Rust is the single source of truth; the front just displays this.
pub fn estimate_kbps(cutoff_hz: f32) -> u32 {
    const TIERS: [u32; 5] = [320, 256, 192, 160, 128];
    for b in TIERS {
        if cutoff_hz >= min_cutoff_hz_for_bitrate(b) {
            return b;
        }
    }
    128
}

/// Maps cutoff + declared rail + declared bitrate to a verdict.
///
/// `content_rail` is the rail sniffed from the actual container/codec (independent of the
/// declared extension/tag) — when it disagrees with `declared` on the lossless side (declared
/// FLAC/WAV/AIFF but the container is actually a lossy codec, e.g. an MP3 renamed to `.flac`),
/// that mismatch alone is fraud, before even looking at the spectral cutoff: a renamed lossy
/// source can coincidentally have a cutoff high enough to pass the cutoff-only check below.
/// `Rail::Unknown` (sniffing failed/inconclusive) never triggers this short-circuit — it falls
/// through to the existing cutoff-based logic unchanged.
pub fn verdict(
    cutoff_hz: f32,
    declared: Rail,
    declared_bitrate: Option<u32>,
    content_rail: Rail,
) -> Verdict {
    match declared {
        Rail::Lossless => {
            if content_rail == Rail::Lossy {
                // Le désaccord de conteneur reste EN PREMIER : c'est une fraude établie sans le
                // spectre, donc l'absence de mesure ne doit pas l'effacer.
                Verdict::Fake
            } else if cutoff_hz <= NO_MEASUREMENT_HZ {
                Verdict::Grey
            } else if cutoff_hz >= LOSSLESS_OK_HZ {
                Verdict::Ok
            } else if cutoff_hz <= LOSSY_CLIFF_HZ {
                Verdict::Fake
            } else {
                Verdict::Grey
            }
        }
        Rail::Lossy => match declared_bitrate {
            // Rien mesuré → on ne sait pas. Ce bras passe AVANT celui du débit : sans lui, un
            // cutoff de 0 est inférieur à tous les planchers de `min_cutoff_hz_for_bitrate` et
            // accuse le fichier de sur-encodage sur la foi d'un décodage qui n'a pas eu lieu.
            _ if cutoff_hz <= NO_MEASUREMENT_HZ => Verdict::Grey,
            // declared bitrate the real spectrum can't support → over-encoded fraud
            Some(b) if cutoff_hz < min_cutoff_hz_for_bitrate(b) => Verdict::Fake,
            _ => Verdict::Ok,
        },
        Rail::Unknown => Verdict::Grey,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lossless_with_full_band_is_ok() {
        assert_eq!(
            verdict(21000.0, Rail::Lossless, None, Rail::Lossless),
            Verdict::Ok
        );
    }

    #[test]
    fn lossless_with_lossy_cliff_is_fake() {
        assert_eq!(
            verdict(16000.0, Rail::Lossless, None, Rail::Lossless),
            Verdict::Fake
        );
        assert_eq!(
            verdict(19000.0, Rail::Lossless, None, Rail::Lossless),
            Verdict::Fake
        );
    }

    #[test]
    fn lossless_in_grey_band_is_grey() {
        assert_eq!(
            verdict(19800.0, Rail::Lossless, None, Rail::Lossless),
            Verdict::Grey
        );
    }

    #[test]
    fn honest_mp3_matching_its_bitrate_is_ok() {
        // genuine 320 (~20.5k), genuine 128 (~16k)
        assert_eq!(
            verdict(20500.0, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Ok
        );
        assert_eq!(
            verdict(16000.0, Rail::Lossy, Some(128), Rail::Lossy),
            Verdict::Ok
        );
    }

    #[test]
    fn over_encoded_mp3_is_fake() {
        // declared 320 but cuts at 16k (transcoded up from ~128) → fraud
        assert_eq!(
            verdict(16000.0, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Fake
        );
        // declared 256 but cuts at 15k
        assert_eq!(
            verdict(15000.0, Rail::Lossy, Some(256), Rail::Lossy),
            Verdict::Fake
        );
    }

    // FIX-18: 192/160 kbps were the only two of the six min_cutoff_hz_for_bitrate tiers never
    // exercised by a direct test (only 320/256/128 were covered above).
    #[test]
    fn honest_192_and_160_mp3_is_ok() {
        assert_eq!(
            verdict(17000.0, Rail::Lossy, Some(192), Rail::Lossy),
            Verdict::Ok
        );
        assert_eq!(
            verdict(16000.0, Rail::Lossy, Some(160), Rail::Lossy),
            Verdict::Ok
        );
    }

    #[test]
    fn over_encoded_192_and_160_mp3_is_fake() {
        // declared 192 but cuts at 15k (below the 16500Hz floor for 192) → fraud
        assert_eq!(
            verdict(15000.0, Rail::Lossy, Some(192), Rail::Lossy),
            Verdict::Fake
        );
        // declared 160 but cuts at 14k (below the 15500Hz floor for 160) → fraud
        assert_eq!(
            verdict(14000.0, Rail::Lossy, Some(160), Rail::Lossy),
            Verdict::Fake
        );
    }

    #[test]
    fn lossy_without_known_bitrate_is_ok() {
        // can't judge over-encoding without a declared bitrate → don't false-flag
        assert_eq!(
            verdict(13000.0, Rail::Lossy, None, Rail::Lossy),
            Verdict::Ok
        );
    }

    /// Un décodage qui n'a produit aucune trame ne doit accuser personne.
    ///
    /// Mesuré sur la bibliothèque réelle le 2026-08-17 : deux MP3 320 kbps de plus de six minutes,
    /// sans `codec_error`, portaient `cutoff_hz = 0` et sortaient FAKE. Sur les deux rails, parce
    /// que le défaut est le même des deux côtés — un zéro qui se fait lire comme une mesure.
    ///
    /// Le contrôle positif est dans le même corps : la MÊME entrée avec un cutoff réellement bas
    /// doit toujours sortir Fake. Sans lui, on ne saurait pas si le correctif distingue l'absence
    /// de mesure ou s'il a simplement désarmé la détection de sur-encodage.
    #[test]
    fn no_measurement_is_grey_not_fake() {
        assert_eq!(
            verdict(NO_MEASUREMENT_HZ, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Grey
        );
        assert_eq!(
            verdict(NO_MEASUREMENT_HZ, Rail::Lossless, None, Rail::Lossless),
            Verdict::Grey
        );
        // Contrôle positif : une vraie mesure basse reste une fraude.
        assert_eq!(
            verdict(16000.0, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Fake
        );
        assert_eq!(
            verdict(16000.0, Rail::Lossless, None, Rail::Lossless),
            Verdict::Fake
        );
    }

    /// L'absence de mesure n'efface pas une fraude déjà établie SANS le spectre : un MP3 renommé
    /// en `.flac` est un faux même si rien n'a pu être décodé.
    #[test]
    fn no_measurement_does_not_erase_a_container_mismatch() {
        assert_eq!(
            verdict(NO_MEASUREMENT_HZ, Rail::Lossless, None, Rail::Lossy),
            Verdict::Fake
        );
    }

    #[test]
    fn unknown_rail_is_grey() {
        assert_eq!(
            verdict(16000.0, Rail::Unknown, None, Rail::Unknown),
            Verdict::Grey
        );
    }

    // Bug case: an MP3 renamed to `.flac` declares Lossless but its container is actually
    // lossy — the mismatch alone is fraud, regardless of how high the cutoff happens to be
    // (a 256-320kbps source can cut near/above the lossless-OK threshold).
    #[test]
    fn declared_lossless_but_content_lossy_is_fake() {
        assert_eq!(
            verdict(20500.0, Rail::Lossless, None, Rail::Lossy),
            Verdict::Fake
        );
    }

    // Content-rail sniffing failed/inconclusive → must not false-positive off the mismatch
    // short-circuit; falls back to the existing cutoff-only logic (Ok here).
    #[test]
    fn declared_lossless_content_unknown_falls_back_to_cutoff() {
        assert_eq!(
            verdict(21000.0, Rail::Lossless, None, Rail::Unknown),
            Verdict::Ok
        );
    }

    // Declared lossy stays on the existing cutoff/bitrate logic when content_rail agrees —
    // the mismatch short-circuit is Lossless-branch-only.
    #[test]
    fn declared_lossy_content_lossy_unchanged_behavior() {
        assert_eq!(
            verdict(20500.0, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Ok
        );
        assert_eq!(
            verdict(16000.0, Rail::Lossy, Some(320), Rail::Lossy),
            Verdict::Fake
        );
    }
}
