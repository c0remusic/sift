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
