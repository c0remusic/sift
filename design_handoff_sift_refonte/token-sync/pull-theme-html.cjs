// Pull: reconcile hand/Claude-Design edits made directly to Sift.dc.html's theme() back
// into design-tokens.{light,dark}.json (canonical). One direction only (Sift.dc.html -> canonical).
// Shares last-sync.json with pull-styles-css.cjs: the baseline represents "what did the
// canonical look like at the last full sync", not a property of any one source file, so
// one baseline file correctly serves both pull directions.
// Dry-run by default; --write persists the pull and updates the shared baseline.
//
// Color values may be 6-digit hex OR rgba(r,g,b,a) strings (border/borderStrong in
// Sift.dc.html's theme() are rgba in both light and dark branches). parseColorValue
// constructs the correct DTCG entry shape for either input; cssColorLiteral reads any
// entry back out as a literal string for comparison/pruning — see
// docs/superpowers/specs/2026-07-04-token-sync-tool-v2-design.md addendum.
const fs = require("fs");
const path = require("path");
const { parseColorValue, cssColorLiteral } = require("./sync-core.cjs");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const aliasPath = path.join(tokenDir, "alias-map.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const light = JSON.parse(fs.readFileSync(lightPath, "utf8"));
const dark = JSON.parse(fs.readFileSync(darkPath, "utf8"));
const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
const html = fs.readFileSync(htmlPath, "utf8");

function extractThemeBranch(regex, label) {
  const m = html.match(regex);
  if (!m) throw new Error(`Could not locate ${label} branch of theme() in Sift.dc.html`);
  const pairs = {};
  for (const [, key, value] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) pairs[key] = value;
  return pairs;
}

const darkTheme = extractThemeBranch(/isDark\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/, "dark");
const lightTheme = extractThemeBranch(/\}\s*:\s*\{([\s\S]*?)\}\s*;\s*\n\s*\}/, "light");

// Resolves the current canonical color literal for a DTCG path — hex string
// for hex-origin entries, preserved raw rgba(...) string otherwise. Never
// reads .$value.hex directly: rgba-origin entries always have hex:null, and
// a direct read would make every comparison against an rgba token see null.
function currentHex(tree, dtcgPath) {
  const entry = tree.color[dtcgPath];
  return entry ? cssColorLiteral(entry) : undefined;
}

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  let alreadyInSync = true;
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const p = prodKey.replace(/^--(color|overlay)-/, "");
    const lightHex = currentHex(light, p);
    const darkHex = currentHex(dark, p) ?? lightHex;
    if (!lightHex) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.light.json`);
    if (lightTheme[legacyKey] !== lightHex || darkTheme[legacyKey] !== darkHex) { alreadyInSync = false; break; }
  }
  if (!alreadyInSync) {
    throw new Error(
      "No last-sync.json baseline found, and Sift.dc.html does not currently match canonical. " +
      "Reconcile by hand once before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log("No baseline existed yet. Sift.dc.html already matches canonical — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) continue; // e.g. "disabled" — no production equivalent
  const p = prodKey.replace(/^--(color|overlay)-/, "");
  if (!light.color[p]) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.light.json`);

  for (const mode of ["light", "dark"]) {
    const htmlValue = mode === "light" ? lightTheme[legacyKey] : darkTheme[legacyKey];
    const tree = mode === "light" ? light : dark;
    const baselineTree = mode === "light" ? baseline.light : baseline.dark;
    const canonicalValue = currentHex(tree, p) ?? (mode === "dark" ? currentHex(light, p) : undefined);
    const baselineValue = currentHex(baselineTree, p) ?? (mode === "dark" ? currentHex(baseline.light, p) : undefined);
    if (htmlValue === canonicalValue) continue;
    if (canonicalValue === baselineValue) {
      pulls.push({ prodKey, legacyKey, mode, path: p, from: canonicalValue, to: htmlValue });
    } else {
      conflicts.push({ prodKey, legacyKey, mode, canonical: canonicalValue, html: htmlValue, baseline: baselineValue });
    }
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both Sift.dc.html and canonical changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) console.error(`  ${c.prodKey} (${c.mode}): baseline="${c.baseline}" canonical(now)="${c.canonical}" Sift.dc.html(now)="${c.html}"`);
  console.error("\nResolve by hand (edit design-tokens.light.json/.dark.json), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: Sift.dc.html matches canonical for every mapped token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from Sift.dc.html into canonical:\n`);
for (const p of pulls) console.log(`  ${p.prodKey} (${p.mode}) [legacy: ${p.legacyKey}]: "${p.from}" -> "${p.to}"`);

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these.");
  process.exit(0);
}

for (const p of pulls) {
  const entry = parseColorValue(p.to);
  if (p.mode === "light") light.color[p.path] = entry;
  else { if (!dark.color) dark.color = {}; dark.color[p.path] = entry; }
}

// Pruning: drop any dark.color entry that now equals its light counterpart.
// Compare cssColorLiteral, not raw .$value.hex — see note on currentHex above.
for (const key of Object.keys(dark.color || {})) {
  if (!light.color[key]) continue;
  if (cssColorLiteral(dark.color[key]) === cssColorLiteral(light.color[key])) delete dark.color[key];
}

fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
console.log("\nWritten to design-tokens.{light,dark}.json, baseline updated.");
