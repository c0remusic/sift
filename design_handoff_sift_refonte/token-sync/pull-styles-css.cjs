// Pull: reconcile hand-edits made directly to frontend/styles.css back into design-tokens.json
// (canonical). One direction only (styles.css -> canonical) — this is the "phase code" edit
// surface. Uses last-sync.json as a baseline to tell "styles.css alone changed" (safe to pull)
// apart from "canonical also changed since the last sync" (real conflict — never auto-resolved).
// Dry-run by default; --write persists the pull into design-tokens.json and updates the baseline.
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const tokensPath = path.join(tokenDir, "design-tokens.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
const css = fs.readFileSync(stylesPath, "utf8");

function extractBlockValues(blockText, keys) {
  const values = {};
  for (const key of keys) {
    const re = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([^;]+);`);
    const m = blockText.match(re);
    if (!m) throw new Error(`Token ${key} not found while reading styles.css — refusing to guess.`);
    values[key] = m[1];
  }
  return values;
}

const colorKeys = Object.keys(tokens.colors);
const staticKeys = Object.keys(tokens.static);

const lightBlockMatch = css.match(/:root\{[\s\S]*?\r?\n\}/);
if (!lightBlockMatch) throw new Error("Could not locate light :root block in styles.css");
const mediaBlockMatch = css.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/);
if (!mediaBlockMatch) throw new Error("Could not locate dark @media block in styles.css");
const dataThemeBlockMatch = css.match(/:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/);
if (!dataThemeBlockMatch) throw new Error("Could not locate dark [data-theme] block in styles.css");

const cssLight = extractBlockValues(lightBlockMatch[0], [...colorKeys, ...staticKeys]);
const cssDarkMedia = extractBlockValues(mediaBlockMatch[0], colorKeys);
const cssDarkDataTheme = extractBlockValues(dataThemeBlockMatch[0], colorKeys);

for (const key of colorKeys) {
  if (cssDarkMedia[key] !== cssDarkDataTheme[key]) {
    throw new Error(
      `styles.css itself is inconsistent: ${key} = "${cssDarkMedia[key]}" in @media block but ` +
      `"${cssDarkDataTheme[key]}" in [data-theme="dark"] block. Fix styles.css by hand before pulling.`
    );
  }
}
const cssDark = cssDarkMedia;

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  const alreadyInSync =
    colorKeys.every((k) => cssLight[k] === tokens.colors[k].light && cssDark[k] === tokens.colors[k].dark) &&
    staticKeys.every((k) => cssLight[k] === tokens.static[k]);
  if (!alreadyInSync) {
    throw new Error(
      "No last-sync.json baseline found, and styles.css does not currently match design-tokens.json. " +
      "Reconcile by hand once (either edit design-tokens.json to match styles.css, or run the push " +
      "generator) before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
  console.log("No baseline existed yet. styles.css already matches design-tokens.json — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const key of colorKeys) {
  for (const mode of ["light", "dark"]) {
    const cssValue = mode === "light" ? cssLight[key] : cssDark[key];
    const canonicalValue = tokens.colors[key][mode];
    const baselineValue = baseline.colors[key][mode];
    if (cssValue === canonicalValue) continue; // already in sync
    if (canonicalValue === baselineValue) {
      pulls.push({ scope: "colors", key, mode, from: canonicalValue, to: cssValue });
    } else {
      conflicts.push({ scope: "colors", key, mode, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
    }
  }
}
for (const key of staticKeys) {
  const cssValue = cssLight[key];
  const canonicalValue = tokens.static[key];
  const baselineValue = baseline.static[key];
  if (cssValue === canonicalValue) continue;
  if (canonicalValue === baselineValue) {
    pulls.push({ scope: "static", key, from: canonicalValue, to: cssValue });
  } else {
    conflicts.push({ scope: "static", key, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both styles.css and design-tokens.json changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) {
    const label = c.mode ? `${c.key} (${c.mode})` : c.key;
    console.error(`  ${label}: baseline="${c.baseline}" canonical(now)="${c.canonical}" styles.css(now)="${c.css}"`);
  }
  console.error("\nResolve by hand (edit design-tokens.json to the value you want to keep), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: styles.css matches design-tokens.json for every token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from styles.css into design-tokens.json:\n`);
for (const p of pulls) {
  const label = p.mode ? `${p.key} (${p.mode})` : p.key;
  console.log(`  ${label}: "${p.from}" -> "${p.to}"`);
}

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these into design-tokens.json.");
  process.exit(0);
}

for (const p of pulls) {
  if (p.scope === "colors") tokens.colors[p.key][p.mode] = p.to;
  else tokens.static[p.key] = p.to;
}
fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
console.log("\nWritten to design-tokens.json, baseline updated.");
