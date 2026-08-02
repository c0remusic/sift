// Downloads a static ffmpeg binary into src-tauri/binaries/ named by Rust target triple.
import { createWriteStream } from "node:fs";
import { mkdir, chmod, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");

// Resolve the Rust host target triple (must match externalBin naming exactly).
const triple = execSync("rustc -Vv").toString().split("\n")
  .find((l) => l.startsWith("host:")).split(" ")[1].trim();

// Pinned static builds. Update these URLs if a source goes stale.
//
// LICENCE — Sift n'invoque que trois encodeurs (`encode.rs`) : `libmp3lame` (LGPL-2.1),
// `pcm_s16be` et `pcm_s16le` (natifs). Aucun composant GPL-only n'est nécessaire. Un build
// `--enable-gpl` contamine donc la distribution sans rien apporter, et un build
// `--enable-nonfree` n'est redistribuable sous AUCUNE licence.
//
// Windows : build LGPL vérifié le 2026-08-02 sur `ffmpeg-master-latest-win64-lgpl.zip` —
// `libmp3lame`, `pcm_s16be`, `pcm_s16le` présents ; décodeurs mp3/flac/alac/aac/vorbis/opus
// présents ; `--enable-gpl` et `--enable-nonfree` absents, `--enable-version3` présent.
//
// ⚠️ macOS : les deux sources ci-dessous restent NON CONFORMES. Mesuré le 2026-08-02 en
// cherchant la ligne `configuration:` dans les binaires Mach-O téléchargés :
//   - ffmpeg711arm.zip  → `--enable-gpl`
//   - ffmpeg7intel.zip  → `--enable-gpl` ET `--enable-nonfree`
// Les deux embarquent libx264/libx265, dont Sift n'a aucun usage. Aucune source LGPL macOS
// n'a encore été retenue en remplacement — voir
// `docs/superpowers/changes/2026-08-02-ffmpeg-licence/design.md`.
const SOURCES = {
  "x86_64-pc-windows-msvc": {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip",
    inner: "ffmpeg.exe", ext: ".exe",
  },
  "aarch64-apple-darwin": {
    url: "https://www.osxexperts.net/ffmpeg711arm.zip",
    inner: "ffmpeg", ext: "",
  },
  "x86_64-apple-darwin": {
    url: "https://www.osxexperts.net/ffmpeg7intel.zip",
    inner: "ffmpeg", ext: "",
  },
};

const src = SOURCES[triple];
if (!src) throw new Error(`No ffmpeg source pinned for target ${triple}`);

await mkdir(outDir, { recursive: true });
const tmp = join(outDir, "_dl.zip");
console.log(`Downloading ffmpeg for ${triple} ...`);
const res = await fetch(src.url, { redirect: "follow" });
if (!res.ok) throw new Error(`Download failed: ${res.status} ${src.url}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

// Extract just the ffmpeg binary. tar reads zips on Win10 17063+/macOS.
const dest = join(outDir, `ffmpeg-${triple}${src.ext}`);
const exDir = join(outDir, "_ex");
await rm(exDir, { recursive: true, force: true });
await mkdir(exDir, { recursive: true });
console.log(`Extracting ${src.inner} -> ${dest}`);
execSync(`tar -xf "${tmp}" -C "${exDir}"`, { stdio: "inherit" });

// Find the inner binary (it may be nested in a versioned folder).
const found = execSync(
  process.platform === "win32"
    ? `where /r "${exDir}" ${src.inner}`
    : `find "${exDir}" -name ${src.inner} -type f`
).toString().split("\n")[0].trim();
execSync(process.platform === "win32" ? `move /y "${found}" "${dest}"` : `mv "${found}" "${dest}"`);
if (process.platform !== "win32") await chmod(dest, 0o755);
await rm(tmp, { force: true });
await rm(exDir, { recursive: true, force: true });
console.log(`OK: ${dest}`);
