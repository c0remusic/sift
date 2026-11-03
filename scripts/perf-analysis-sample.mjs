// Échantillon stratifié de la bibliothèque pour les bancs d'analyse (#98).
//
// Copie N fichiers par format depuis les pistes `pending`/`filed` de la base, vers un dossier de
// banc. La base est ouverte en LECTURE seule (`mode=ro`), les fichiers source sont lus, jamais
// modifiés. Les copies sont nommées `<id>.<ext>`, et `manifest.json` relie chaque copie à sa
// source.
//
// Les quotas suivent la répartition de la bibliothèque mesurée le 2026-11-03 (aiff 3 424,
// aif 2 536, mp3 1 551, flac 598, wav 402, ogg 3, m4a 2).
//
// Usage :
//   node scripts/perf-analysis-sample.mjs <chemin de sift.db> <dossier de sortie>
// puis, depuis la racine du dépôt :
//   SIFT_BENCH_TRACKS_DIR=<dossier de sortie> bash scripts/cargo-isolated.sh test --release --lib \
//     -- --ignored --nocapture --test-threads=1 bench_debit_du_pool
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const [db, out] = process.argv.slice(2);
if (!db || !out) {
  console.error("usage : node scripts/perf-analysis-sample.mjs <sift.db> <dossier de sortie>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const quota = { aiff: 20, aif: 16, mp3: 12, flac: 8, wav: 6, ogg: 1, m4a: 1 };
const manifest = [];
for (const [ext, n] of Object.entries(quota)) {
  const sql = `select id, path from tracks where status in ('pending','filed') and lower(path) like '%.${ext}' order by random() limit ${n * 3};`;
  const rows = execFileSync("sqlite3", ["-readonly", `file:${db}?mode=ro`, sql], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return [l.slice(0, i), l.slice(i + 1)];
    });
  let got = 0;
  for (const [id, p] of rows) {
    if (got >= n) break;
    if (!existsSync(p)) continue;
    copyFileSync(p, join(out, `${id}${extname(p).toLowerCase()}`));
    manifest.push({ id: +id, ext, src: p });
    got++;
  }
  console.log(`${ext} ${got} / ${n}`);
  if (got < n) console.error(`  ⚠️ ${ext} : seulement ${got} fichier(s) trouvés sur ${n} demandés`);
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
