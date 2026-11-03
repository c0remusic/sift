// Croise la sonde du fil de la fenêtre (perf-window-probe.ps1) avec les commandes horodatées
// d'une mesure perf-baseline.mjs (`cmds`, `rail`, `open`) : pour chaque blocage du fil, la ou les
// commandes en vol à cet instant.
// Usage : node scripts/perf-correlate.mjs <probe.json> <mesure.json>

import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const probe = read(process.argv[2]);
const m = read(process.argv[3]);

// Intervalles [début, fin] des commandes, en horloge murale (ms epoch).
const iv = [];
if (m.mode === "cmds")
  for (const [cmd, xs] of Object.entries(m.out)) for (const x of xs) iv.push({ cmd, a: x.at, b: x.at + x.ms });
if (m.mode === "rail")
  for (const run of m.runs)
    for (const leg of [run.cold, run.back])
      for (const c of leg.cmds) if (c.dur != null) iv.push({ cmd: `${leg.view}:${c.cmd}`, a: leg.at + c.start, b: leg.at + c.start + c.dur });
if (m.mode === "freeze") for (const c of m.allCmds ?? []) if (c.b != null) iv.push(c);
if (m.mode === "open") {
  for (const c of m.allCmds ?? []) if (c.b != null) iv.push(c);
  for (const r of [...m.results, ...(m.next ?? [])]) {
    if (!m.allCmds)
      for (const c of r.cmds) if (c.dur != null) iv.push({ cmd: c.cmd, a: r.at + c.start, b: r.at + c.start + c.dur });
    // Le chargement du média (src posé → canplay) passe par le protocole `asset:`, pas par une
    // commande : il compte comme un intervalle à part.
    const md = r.media;
    if (md?.srcSet != null && md.canplay != null)
      iv.push({ cmd: `média ${r.ext}`, a: r.at + md.srcSet, b: r.at + md.canplay });
  }
}

const blocks = probe.overThreshold ?? [];
console.log(`sonde : ${probe.samples} échantillons, p50 ${probe.p50} ms, p99 ${probe.p99} ms, max ${probe.max} ms, ${blocks.length} blocages > 100 ms`);
const blame = {};
for (const b of blocks) {
  // Le message envoyé à `atEpochMs` a attendu `ms` : le fil était occupé sur [at, at + ms].
  const a = b.atEpochMs, e = b.atEpochMs + b.ms;
  const hit = iv.filter((x) => x.a <= e && x.b >= a);
  const names = [...new Set(hit.map((x) => x.cmd))];
  for (const n of names) blame[n] = (blame[n] ?? 0) + 1;
  console.log(`  ${new Date(a).toISOString().slice(11, 23)} bloqué ${Math.round(b.ms)} ms — en vol : ${names.join(", ") || "aucune commande mesurée"}`);
}
console.log("attribution :", JSON.stringify(blame));
