# M2a test fixtures (generated)

Run `node scripts/make-fixtures.mjs` to regenerate. These are fabricated via ffmpeg and are
NOT committed. For "authentic" anchors that can't be fabricated, drop real files here:

- `anchor_real_lossless.flac` (a genuine lossless rip)
- `anchor_real_320.mp3` (a genuine store-bought 320)
- `anchor_lame320.flac` (a real track transcoded by LAME 320 and re-wrapped as FLAC — e.g. a copy
  of `C:\sift-corpus\fake\src01_lame320.flac` — the MP3 bank of the quantization probe, #63,
  needs real music: the swept-sine fixtures are tonal and degenerate by design)

- `anchor_vorbisq8.flac` and `anchor_wma320.flac` (a real track transcoded by Vorbis q8 / WMA v2
  320k and re-wrapped as FLAC — for `bancs::tests::cadrage_attrape_vorbis_et_wma`)

Recipe for the last two, from any genuine full-band 44.1 kHz track, using the bundled ffmpeg.
Two steps on purpose: the point is a REAL FLAC whose audio went through a lossy encoder, not a
lossy file wearing a `.flac` name (that is `aac_disguised.flac`, a different test).

```
ffmpeg -y -i SRC -ac 2 -ar 44100 -c:a libvorbis -q:a 8 tmp.ogg
ffmpeg -y -i tmp.ogg -ac 2 -ar 44100 -sample_fmt s16 anchor_vorbisq8.flac
ffmpeg -y -i SRC -ac 2 -ar 44100 -c:a wmav2 -b:a 320k tmp.wma
ffmpeg -y -i tmp.wma -ac 2 -ar 44100 -sample_fmt s16 anchor_wma320.flac
```

The quality settings are load-bearing, not arbitrary. The `cadrage` bank only runs above
`verdict::LOSSY_CLIFF_HZ` (20 kHz), because below the cliff the verdict is already Fake from the
cutoff alone. Ordinary Vorbis/WMA settings lowpass well under 20 kHz and would never reach the
bank, so the test would be measuring the bank's absence rather than its accuracy. 44.1 kHz and
not 48: `mp3_bank::sfb_long` only has tables for 44100, and the MP3 control arm has to be in
domain for the test to mean anything.

The characterization test skips anchors that are absent.

## The calibration corpus — recipes, measured

Separate from the anchors above, and much larger: a known-truth set of **10 source tracks x 15
encoders = 150 fakes, plus the 10 genuine sources**, built outside the repo (it was at
`C:\sift-corpus`) and used for threshold work — it is what showed the `cadrage` bank earns its
47 % of analysis time by catching Vorbis and WMA alone (`ef71c50`).

The corpus is NOT committed and its build script is gone. These recipes were recovered on
2026-09-22 by replaying each one against the corpus while it still existed, and comparing the
**decoded PCM** — not the file bytes, which differ by tag content alone.

Every recipe is two steps, for the reason given above: a real FLAC whose audio went through a
lossy encoder. `-vn` is load-bearing — a source carrying cover art otherwise copies it into the
final FLAC (+204 490 bytes on the MP3 arms, measured) and makes the `m4a` container fail
outright, trying to mux the picture as an h264 stream.

```
ffmpeg -y -i SRC -vn -ac 2 -ar 44100 <ENCODAGE> tmp.<ext>
ffmpeg -y -i tmp.<ext> -vn -ac 2 -ar 44100 -sample_fmt s16 src<NN>_<label>.flac
```

| label | `<ENCODAGE>` | ext | replayed |
|---|---|---|---|
| `lame128` | `-c:a libmp3lame -b:a 128k` | mp3 | bit-exact PCM |
| `lame160` | `-c:a libmp3lame -b:a 160k` | mp3 | bit-exact PCM |
| `lame192` | `-c:a libmp3lame -b:a 192k` | mp3 | bit-exact PCM |
| `lame256` | `-c:a libmp3lame -b:a 256k` | mp3 | bit-exact PCM |
| `lame320` | `-c:a libmp3lame -b:a 320k` | mp3 | bit-exact PCM |
| `lameV0` | `-c:a libmp3lame -q:a 0` | mp3 | bit-exact PCM |
| `mfmp3_128` | `-c:a mp3_mf -b:a 128k` | mp3 | bit-exact PCM |
| `mfmp3_320` | `-c:a mp3_mf -b:a 320k` | mp3 | bit-exact PCM |
| `vorbisq5` | `-c:a libvorbis -q:a 5` | ogg | bit-exact PCM |
| `wma192` | `-c:a wmav2 -b:a 192k` | wma | bit-exact PCM |
| `aac128` | `-c:a aac -b:a 128k` | m4a | **shape only** |
| `aac256` | `-c:a aac -b:a 256k` | m4a | **shape only** |
| `aacmf128` | `-c:a aac_mf -b:a 128k` | m4a | **shape only** |
| `aacmf256` | `-c:a aac_mf -b:a 256k` | m4a | **shape only** |
| `opus128` | `-c:a libopus -b:a 128k`, at `-ar 48000` | opus | **shape only** |

`mp3_mf` and `aac_mf` are the Windows Media Foundation encoders, and they are in the set on
purpose: they are what a real transcode on this platform produces, and they are not libmp3lame.

**What "shape only" means, and why it does not matter here.** Those five reproduce the right
PCM length but not the right bits, and the cause is a parameter not yet recovered, NOT encoder
noise: both AAC encoders were measured deterministic (two runs of one command, identical PCM),
and the ffmpeg vendor string is `Lavf63.5.101` on both sides, so the version is not the
variable. Container (`m4a` / ADTS `.aac` / `.mp4`) and sample-rate placement were swept, none
matched. The corpus exists to answer "does Sift catch an AAC-128 transcode", and a freshly made
AAC-128 transcode answers it identically. Bit-identity would only be needed to reproduce a
specific historical measurement number.

⚠️ Opus is 48 kHz only — `libopus` refuses `-ar 44100` outright. Encode at 48 kHz. That also
puts the opus arm out of domain for `mp3_bank::sfb_long`, which only has 44100 tables.

The 10 sources were real purchases from the library, named in the corpus ledger; the genuine arm
is each source re-wrapped through the same second step with no lossy stage in between.
