// Pull: reconcile hand/Claude-Design edits made directly to Sift.dc.html's theme() back
// into design-tokens.json (canonical). One direction only (Sift.dc.html -> canonical).
// Shares last-sync.json with pull-styles-css.cjs: the baseline represents "what did the
// canonical look like at the last full sync", not a property of any one source file, so
// one baseline file correctly serves both pull directions.
// Dry-run by default; --write persists the pull and updates the shared baseline.
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const tokensPath = path.join(tokenDir, "design-tokens.json");
const aliasPath = path.join(tokenDir, "alias-map.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
const html = fs.readFileSync(htmlPath, "utf8");

function extractThemeBranch(regex, label) {
  const m = html.match(regex);
  if (!m) throw new Error(`Could not locate ${label} branch of theme() in Sift.dc.html`);
  const pairs = {};
  for (const [, key, value] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    pairs[key] = value;
  }
  return pairs;
}

const darkTheme = extractThemeBranch(/isDark\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/, "dark");
const lightTheme = extractThemeBranch(/\}\s*:\s*\{([\s\S]*?)\}\s*;\s*\n\s*\}/, "light");

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  let alreadyInSync = true;
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const canonical = tokens.colors[prodKey];
    if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
    if (lightTheme[legacyKey] !== canonical.light || darkTheme[legacyKey] !== canonical.dark) {
      alreadyInSync = false;
      break;
    }
  }
  if (!alreadyInSync) {
    throw new Error(
      "No last-sync.json baseline found, and Sift.dc.html does not currently match design-tokens.json. " +
      "Reconcile by hand once (either edit design-tokens.json to match Sift.dc.html, or run the push " +
      "generator) before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
  console.log("No baseline existed yet. Sift.dc.html already matches design-tokens.json — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) continue; // e.g. "disabled" — no production equivalent, not this script's business
  const canonical = tokens.colors[prodKey];
  if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
  const baselineEntry = baseline.colors[prodKey];
  if (!baselineEntry) throw new Error(`${prodKey} missing from last-sync.json baseline — run pull-styles-css.cjs or delete last-sync.json to reset it.`);

  for (const mode of ["light", "dark"]) {
    const htmlValue = mode === "light" ? lightTheme[legacyKey] : darkTheme[legacyKey];
    const canonicalValue = canonical[mode];
    const baselineValue = baselineEntry[mode];
    if (htmlValue === canonicalValue) continue; // already in sync
    if (canonicalValue === baselineValue) {
      pulls.push({ prodKey, legacyKey, mode, from: canonicalValue, to: htmlValue });
    } else {
      conflicts.push({ prodKey, legacyKey, mode, canonical: canonicalValue, html: htmlValue, baseline: baselineValue });
    }
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both Sift.dc.html and design-tokens.json changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) {
    console.error(`  ${c.prodKey} (${c.mode}): baseline="${c.baseline}" canonical(now)="${c.canonical}" Sift.dc.html(now)="${c.html}"`);
  }
  console.error("\nResolve by hand (edit design-tokens.json to the value you want to keep), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: Sift.dc.html matches design-tokens.json for every mapped token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from Sift.dc.html into design-tokens.json:\n`);
for (const p of pulls) {
  console.log(`  ${p.prodKey} (${p.mode}) [legacy: ${p.legacyKey}]: "${p.from}" -> "${p.to}"`);
}

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these into design-tokens.json.");
  process.exit(0);
}

for (const p of pulls) {
  tokens.colors[p.prodKey][p.mode] = p.to;
}
fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
console.log("\nWritten to design-tokens.json, baseline updated.");
