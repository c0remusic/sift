// Generates M2a test fixtures via the bundled ffmpeg. Run: node scripts/make-fixtures.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "src-tauri/fixtures";
mkdirSync(OUT, { recursive: true });

// locate the dev ffmpeg binary
const binDir = "src-tauri/binaries";
const ff = join(binDir, readdirSync(binDir).find((f) => f.startsWith("ffmpeg-")));
const run = (args) => execFileSync(ff, args, { stdio: "inherit" });

// 1) genuine full-band lossless FLAC: tone sweep up to ~22 kHz
run(["-y", "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*(300+20000*t/10)*t):d=10:s=44100", "-ac", "2", join(OUT, "real_lossless.flac")]);
// 2) FAKE lossless: encode to 128k mp3 then back to FLAC (lowpass cliff ~16 kHz baked in)
run(["-y", "-i", join(OUT, "real_lossless.flac"), "-b:a", "128k", join(OUT, "_tmp128.mp3")]);
run(["-y", "-i", join(OUT, "_tmp128.mp3"), "-ac", "2", join(OUT, "fake_lossless.flac")]);
// 2b) 48 kHz variant of the fake — exercises native-sample-rate analysis (bin→Hz mapping)
run(["-y", "-i", join(OUT, "fake_lossless.flac"), "-ar", "48000", join(OUT, "fake_lossless_48k.flac")]);
// 3) honest mp3 320
run(["-y", "-i", join(OUT, "real_lossless.flac"), "-b:a", "320k", join(OUT, "real_320.mp3")]);
// 3b) OVER-ENCODED 320: the 128k mp3 re-encoded UP to 320 (declared 320, real ~128 cutoff)
run(["-y", "-i", join(OUT, "_tmp128.mp3"), "-b:a", "320k", join(OUT, "over_encoded_320.mp3")]);
// 4) truncated: only first 1.5 s, abrupt cut, as WAV
run(["-y", "-i", join(OUT, "real_lossless.flac"), "-t", "1.5", "-c:a", "pcm_s16le", join(OUT, "truncated.wav")]);
// 5) silence head/tail: 1 s silence + 2 s tone + 1.5 s silence
run(["-y",
  "-f", "lavfi", "-i", "aevalsrc=0:d=1:s=44100",
  "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*1000*t):d=2:s=44100",
  "-f", "lavfi", "-i", "aevalsrc=0:d=1.5:s=44100",
  "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", "-c:a", "pcm_s16le", join(OUT, "silence_pad.wav")]);
// 6) dual-mono fake stereo: mono tone duplicated to 2 ch
run(["-y", "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*1000*t):d=3:s=44100", "-ac", "2", join(OUT, "dual_mono.wav")]);

// AAC-dans-MP4 portant une extension LOSSLESS : le déguisement que le garde anti-upscale de
// `filing.rs::plan_file` doit attraper. `-f mp4` force le conteneur malgré le nom `.flac`, donc
// le fichier est un vrai MP4/AAC que lofty sniffe en `FileType::Mp4` — pas un flac.
// Sert `tags::tests::un_aac_deguise_en_flac_est_vu_lossy_par_le_contenu`, qui garde le trou
// mesuré le 2026-09-17 : `Aac`, `Mp4` et `Mpc` tombaient dans `Rail::Unknown`, la condition du
// garde était fausse, et Sift convertissait le fichier en AIFF — fabriquant le faux lossless
// qu'il est censé détecter.
run(["-y", "-i", join(OUT, "real_lossless.flac"), "-c:a", "aac", "-b:a", "192k", "-f", "mp4",
  join(OUT, "aac_disguised.flac")]);

console.log("fixtures generated in", OUT);
