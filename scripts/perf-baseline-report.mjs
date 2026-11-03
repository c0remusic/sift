// Résume les JSON de scripts/perf-baseline.mjs en tableaux lisibles (médiane, max, budget).
// Usage : node scripts/perf-baseline-report.mjs <rail.json|open.json|freeze.json|startup.json> [--detail]

import { readFileSync } from "node:fs";

const [file, flag] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file, "utf8"));
const detail = flag === "--detail";
const med = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const max = (xs) => Math.max(...xs.filter((x) => x != null));
const f = (x) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toString());

if (r.mode === "rail") {
  console.log("| destination | froid : 90 % peint | froid : complet (max) | dont IPC | retour : 90 % peint | retour : complet (max) | dont IPC | budget 100 ms |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const view of [...new Set(r.runs.map((x) => x.view))]) {
    const rs = r.runs.filter((x) => x.view === view);
    const c = rs.map((x) => x.cold), b = rs.map((x) => x.back);
    const worst = Math.max(max(c.map((x) => x.total)), max(b.map((x) => x.total)));
    console.log(
      `| ${view} | ${f(med(c.map((x) => x.p90)))} | ${f(med(c.map((x) => x.total)))} (${f(max(c.map((x) => x.total)))}) | ${f(med(c.map((x) => x.ipc)))} ` +
        `| ${f(med(b.map((x) => x.p90)))} | ${f(med(b.map((x) => x.total)))} (${f(max(b.map((x) => x.total)))}) | ${f(med(b.map((x) => x.ipc)))} ` +
        `| ${worst < 100 ? "tenu" : "dépassé"} |`,
    );
    if (detail) {
      for (const [label, xs] of [["froid", c], ["retour", b]]) {
        const cmds = {};
        for (const x of xs) for (const k of x.cmds) (cmds[k.cmd] ??= []).push(k);
        console.log(`  commandes (${label}, médianes : départ+durée ms) : ${Object.entries(cmds).map(([k, v]) => `${k} @${f(med(v.map((y) => y.start)))}+${f(med(v.map((y) => y.dur)))}`).join(" · ")}`);
      }
      const lf = c.flatMap((x) => x.longFrames);
      for (const l of lf.slice(0, 4))
        console.log(`  image longue ${f(l.dur)} ms (bloquant ${f(l.block)}, rendu ${f(l.render)}) : ${l.scripts.map((s) => `${s.src || s.inv} ${f(s.dur)}`).join(" · ")}`);
    }
  }
}

if (r.mode === "open") {
  const rows = r.results;
  const line = (label, xs) =>
    console.log(`| ${label} | ${f(med(xs))} | ${f(max(xs))} | ${xs.filter((x) => x != null && x >= 300).length}/${xs.length} |`);
  console.log(`ouvertures : ${rows.length} — formats : ${[...new Set(rows.map((x) => x.ext))].join(", ")}`);
  console.log("| étape | médiane ms | max ms | ≥ 300 ms |");
  console.log("|---|---|---|---|");
  line("total (verdict peint ET lecteur prêt)", rows.map((x) => x.total));
  line("verdict peint", rows.map((x) => x.verdict));
  line("`analyze_path` (aller-retour)", rows.map((x) => x.analyzePath?.dur));
  line("rendu de la boîte (réponse → verdict peint)", rows.map((x) => x.boxRender));
  line("`playback_url` (aller-retour)", rows.map((x) => x.playbackUrl?.dur));
  line("lecteur prêt (`canplay`)", rows.map((x) => x.media?.canplay));
  for (const ext of [...new Set(rows.map((x) => x.ext))]) {
    const xs = rows.filter((x) => x.ext === ext);
    console.log(`  ${ext} n=${xs.length} total méd ${f(med(xs.map((x) => x.total)))} · analyze_path méd ${f(med(xs.map((x) => x.analyzePath?.dur)))} · canplay méd ${f(med(xs.map((x) => x.media?.canplay)))}`);
  }
  if (r.next?.length) {
    console.log(`piste suivante (préchargée) n=${r.next.length} : total méd ${f(med(r.next.map((x) => x.total)))} max ${f(max(r.next.map((x) => x.total)))} · verdict méd ${f(med(r.next.map((x) => x.verdict)))} · canplay méd ${f(med(r.next.map((x) => x.media?.canplay)))}`);
  }
  if (detail)
    for (const x of rows)
      console.log(`  ${x.id} ${x.ext} total ${f(x.total)} az ${f(x.analyzePath?.dur)} boîte ${f(x.boxRender)} pb ${f(x.playbackUrl?.dur)} canplay ${f(x.media?.canplay)} | ${x.cmds.map((c) => `${c.cmd}@${f(c.start)}+${f(c.dur)}`).join(" ")} | images longues ${x.longFrames.map((l) => f(l.dur)).join(",")}`);
}

if (r.mode === "freeze") {
  console.log(`${r.view}, ${r.seconds} s — ping get_setting : n=${r.ping.n} p50 ${f(r.ping.p50)} p95 ${f(r.ping.p95)} p99 ${f(r.ping.p99)} max ${f(r.ping.max)} ; > 100 ms : ${r.ping.over100}`);
  console.log(`images longues > 100 ms : ${r.longFrames.length} ; retards de minuterie > 100 ms : ${r.timerLags.length} ; commandes > 100 ms : ${r.slowCmds.length}`);
  const byCmd = {};
  for (const c of r.slowCmds) (byCmd[c.cmd] ??= []).push(c.dur);
  for (const [k, v] of Object.entries(byCmd)) console.log(`  lente : ${k} ×${v.length} méd ${f(med(v))} max ${f(max(v))}`);
  console.log(`  appels : ${Object.entries(r.cmdCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  for (const l of r.longFrames.slice(0, detail ? 50 : 8))
    console.log(`  image longue @${f(l.at)} ${f(l.dur)} ms : ${l.scripts.map((s) => `${s.src || s.inv} ${f(s.dur)}`).join(" · ")} | en vol : ${l.during.map((d) => d.cmd).join(",")}`);
  console.log(`progression à la fin : ${JSON.stringify(r.progressAtEnd)}`);
}

if (r.mode === "cmds") {
  console.log(`piste témoin ${r.trackId} (${r.ext}), file de ${r.queueLength} pistes, ${r.reps} passes`);
  console.log("| commande | médiane ms | max ms | échecs |");
  console.log("|---|---|---|---|");
  for (const [c, xs] of Object.entries(r.out))
    console.log(`| \`${c}\` | ${f(med(xs.map((x) => x.ms)))} | ${f(max(xs.map((x) => x.ms)))} | ${xs.filter((x) => !x.ok).length} |`);
}

if (r.mode === "startup") {
  console.log("| run | fenêtre visible | first-contentful-paint | fenêtre sans contenu | utilisable |");
  console.log("|---|---|---|---|---|");
  for (const x of r.runs) {
    console.log(`| ${x.run} | ${f(x.windowVisible)} | ${f(x.firstContentfulPaint)} | ${f(x.ghostMs)} | ${f(x.usable)} |`);
    if (detail) {
      console.log(`  fil de la fenêtre bloqué > 50 ms après apparition : ${(x.windowThreadBlocks ?? []).map((b) => `@${f(b.at)}+${f(b.ms)}${b.during?.length ? ` [${b.during.join(",")}]` : ""}`).join(" ")}`);
      console.log(`  commandes du démarrage : ${(x.bootCmds ?? []).map((c) => `${c.cmd}@${f(c.start)}+${f(c.dur)}`).join(" ")}`);
    }
  }
  console.log(`médianes : visible ${f(med(r.runs.map((x) => x.windowVisible)))} · FCP ${f(med(r.runs.map((x) => x.firstContentfulPaint)))} · utilisable ${f(med(r.runs.map((x) => x.usable)))}`);
}
