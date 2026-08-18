// Joint la vérité terrain (`labels.json` de make-corpus.mjs) avec la mesure du détecteur (sortie
// CSV de `analysis::corpus::corpus_scan`) et rend la matrice de confusion.
//
//   node scripts/score-corpus.mjs <labels.json> <scan.csv>
//
// Ce que ce tableau dit et que « les tests passent » ne dit pas :
//   * FAUX POSITIF (authentique jugé Fake) — le plus cher : un bon fichier part à re-sourcer.
//   * FAUX NÉGATIF (faux jugé Ok) — un transcodage entre en bibliothèque sans être vu.
//   * la ventilation PAR ENCODEUR, qui localise les angles morts au lieu de les moyenner. C'est
//     la seule colonne qui répond à « le détecteur marche-t-il », parce que la moyenne d'un
//     détecteur aveugle à une famille entière et parfait sur une autre ne veut rien dire.

import { readFileSync } from "node:fs";

const [LABELS, CSV] = process.argv.slice(2);
if (!LABELS || !CSV) {
  console.error("usage: node scripts/score-corpus.mjs <labels.json> <scan.csv>");
  process.exit(1);
}

const labels = JSON.parse(readFileSync(LABELS, "utf8"));

const rows = readFileSync(CSV, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.includes(";") && !l.startsWith("rail;") && !l.startsWith("--"))
  .map((l) => {
    // Le nom est en DERNIER et se prend comme « tout ce qui reste » : un `;` dans un titre ne
    // peut donc plus décaler les colonnes. Mesuré le 2026-08-18 — 4 lignes sur 967 étaient
    // tordues quand le nom venait en premier, et le verdict lu etait un bout de titre.
    const parts = l.split(";");
    const [rail, bitrate, cutoff, verdict, est] = parts;
    const file = parts.slice(5).join(";");
    return { file, rail, bitrate, cutoff: Number(cutoff), verdict, est };
  });

const byFile = new Map(rows.map((r) => [r.file, r]));

const missing = [];
const joined = [];
for (const l of labels) {
  const m = byFile.get(l.file);
  if (!m) {
    missing.push(l.file);
    continue;
  }
  joined.push({ ...l, ...m });
}

// Compte positif AVANT tout jugement : un tableau de zéros et un corpus non mesuré se ressemblent,
// et c'est le défaut que ce dépôt corrige partout ailleurs.
console.log(`etiquettes: ${labels.length}   mesures: ${rows.length}   jointes: ${joined.length}`);
if (missing.length) {
  const head = missing.slice(0, 6).join(", ");
  console.log(`NON MESURES (${missing.length}): ${head}${missing.length > 6 ? " ..." : ""}`);
}
const errored = joined.filter((j) => j.rail === "ERREUR");
if (errored.length) {
  // Une ligne en erreur n'est ni un Ok ni un Fake : la sortir du dénominateur EXPLICITEMENT,
  // plutôt que la laisser diluer un taux qu'on va citer.
  console.log(`EN ERREUR D'ANALYSE (${errored.length}): ${errored.map((e) => e.file).join(", ")}`);
}
if (!joined.length) {
  console.log("aucune jointure — rien a conclure");
  process.exit(1);
}

const scored = joined.filter((j) => j.rail !== "ERREUR");
const cell = (truth, verdict) => scored.filter((j) => j.truth === truth && j.verdict === verdict).length;
const nGen = scored.filter((j) => j.truth === "genuine").length;
const nFake = scored.filter((j) => j.truth === "fake").length;

console.log("\n=== MATRICE DE CONFUSION ===");
console.log("verite \\ verdict        Ok    Grey    Fake   total");
for (const t of ["genuine", "fake"]) {
  const [ok, grey, fake] = ["Ok", "Grey", "Fake"].map((v) => cell(t, v));
  console.log(
    `${t.padEnd(20)} ${String(ok).padStart(4)} ${String(grey).padStart(7)} ` +
      `${String(fake).padStart(7)} ${String(ok + grey + fake).padStart(7)}`,
  );
}

const pct = (n, d) => (d ? ` = ${((100 * n) / d).toFixed(1)} %` : "");
console.log(`\nFAUX POSITIFS (authentique -> Fake) : ${cell("genuine", "Fake")}/${nGen}${pct(cell("genuine", "Fake"), nGen)}`);
console.log(`  dont zone grise (authentique -> Grey) : ${cell("genuine", "Grey")}/${nGen}`);
console.log(`FAUX NEGATIFS (faux -> Ok)          : ${cell("fake", "Ok")}/${nFake}${pct(cell("fake", "Ok"), nFake)}`);
console.log(`  rattrapes en Grey (faux -> Grey)      : ${cell("fake", "Grey")}/${nFake}`);

console.log("\n=== PAR ENCODEUR (cote faux uniquement) ===");
console.log("variante        n   detecte  rate   Grey   cutoff min..max");
const variants = [...new Set(scored.filter((j) => j.truth === "fake").map((j) => j.via))].sort();
for (const v of variants) {
  const g = scored.filter((j) => j.truth === "fake" && j.via === v);
  const det = g.filter((j) => j.verdict === "Fake").length;
  const miss = g.filter((j) => j.verdict === "Ok").length;
  const grey = g.filter((j) => j.verdict === "Grey").length;
  const cuts = g.map((j) => j.cutoff).filter((c) => Number.isFinite(c));
  const range = cuts.length ? `${Math.min(...cuts).toFixed(0)}..${Math.max(...cuts).toFixed(0)}` : "-";
  console.log(
    `${v.padEnd(14)} ${String(g.length).padStart(3)} ${String(det).padStart(8)} ` +
      `${String(miss).padStart(6)} ${String(grey).padStart(6)}   ${range}${miss > 0 ? "  <-- RATE" : ""}`,
  );
}

console.log("\n=== COTE AUTHENTIQUE, cutoff par fichier ===");
for (const j of scored.filter((x) => x.truth === "genuine")) {
  console.log(`${j.verdict.padEnd(5)} ${String(j.cutoff).padStart(6)}  ${j.source}`);
}
