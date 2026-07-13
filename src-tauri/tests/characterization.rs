//! End-to-end M2a characterization on fabricated fixtures. Pins verdict + signal behavior.
//! Generated fixtures are mandatory (run `node scripts/make-fixtures.mjs`).
use sift_lib::analysis::{analyze, Rail, Verdict};
use std::path::Path;

fn fixture(name: &str) -> String {
    let p = format!("fixtures/{name}");
    assert!(Path::new(&p).is_file(), "missing generated fixture {p}; run node scripts/make-fixtures.mjs");
    p
}

#[test]
fn real_lossless_flac_is_ok() {
    let p = fixture("real_lossless.flac");
    let r = analyze(&p, false).expect("analyze");
    assert_eq!(r.declared_rail, Rail::Lossless);
    assert!(r.cutoff_hz > 18000.0, "full-band cutoff, got {}", r.cutoff_hz);
    assert_ne!(r.verdict, Verdict::Fake, "genuine lossless must not be fake");
}

#[test]
fn fake_lossless_flac_is_fake() {
    let p = fixture("fake_lossless.flac");
    let r = analyze(&p, false).expect("analyze");
    assert_eq!(r.declared_rail, Rail::Lossless);
    assert!(r.cutoff_hz < 18000.0, "transcoded cliff, got {}", r.cutoff_hz);
    assert_eq!(r.verdict, Verdict::Fake);
}

#[test]
fn honest_320_mp3_is_not_fake() {
    let p = fixture("real_320.mp3");
    let r = analyze(&p, false).expect("analyze");
    assert_eq!(r.declared_rail, Rail::Lossy);
    assert_eq!(r.verdict, Verdict::Ok, "lossy is never fake via cutoff path");
}

#[test]
fn over_encoded_320_is_fake() {
    let p = fixture("over_encoded_320.mp3");
    let r = analyze(&p, false).expect("analyze");
    assert_eq!(r.declared_rail, Rail::Lossy);
    assert!(r.cutoff_hz < 18500.0, "real cutoff well below a genuine 320, got {}", r.cutoff_hz);
    assert_eq!(r.verdict, Verdict::Fake, "declared 320 but cuts low → over-encoded fraud");
}

#[test]
fn truncated_wav_is_flagged() {
    let p = fixture("truncated.wav");
    let r = analyze(&p, false).expect("analyze");
    assert!(r.truncated, "abrupt 1.5 s cut should flag truncation");
}

#[test]
fn silence_pad_measured() {
    let p = fixture("silence_pad.wav");
    let r = analyze(&p, false).expect("analyze");
    assert!(r.silence_head_ms >= 800 && r.silence_head_ms <= 1200, "head {}", r.silence_head_ms);
    assert!(r.silence_tail_ms >= 1300 && r.silence_tail_ms <= 1700, "tail {}", r.silence_tail_ms);
}

#[test]
fn dual_mono_detected() {
    let p = fixture("dual_mono.wav");
    let r = analyze(&p, false).expect("analyze");
    assert!(r.dual_mono, "duplicated-mono stereo should be dual_mono");
    assert!(r.phase_correlation > 0.99, "corr {}", r.phase_correlation);
}

// Authentic anchors (only run if the user dropped real files in fixtures/)
#[test]
fn anchor_real_lossless_not_fake() {
    let p = "fixtures/anchor_real_lossless.flac";
    if !Path::new(p).is_file() {
        return;
    }
    let r = analyze(p, false).expect("analyze");
    assert_ne!(r.verdict, Verdict::Fake);
}
