// Pull: reconcile hand-edits made directly to frontend/styles.css back into
// design-tokens.{light,dark}.json (canonical). One direction only (styles.css
// -> canonical) — this is the "phase code" edit surface. Uses last-sync.json
// as a baseline to tell "styles.css alone changed" (safe to pull) apart from
// "canonical also changed since the last sync" (real conflict — never
// auto-resolved). Dry-run by default; --write persists the pull and updates
// the baseline.
//
// Color values may be 6-digit hex OR rgba(r,g,b,a) strings (13/33 real tokens
// are rgba — overlays, tinted semantic backgrounds, borders). parseColorValue
// constructs the correct DTCG entry shape for either input; cssColorLiteral
// reads any entry back out as a literal string for comparison/pruning — see
// docs/superpowers/specs/2026-07-04-token-sync-tool-v2-design.md addendum.
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { parseColorValue, cssColorLiteral } = require("./sync-core.cjs");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const GROUP_TO_PREFIX = { radius: "--border-radius-", shadow: "--shadow-", font: "--font-", text: "--text-", space: "--space-", height: "--h-" };

const light = JSON.parse(fs.readFileSync(lightPath, "utf8"));
const dark = JSON.parse(fs.readFileSync(darkPath, "utf8"));
const css = fs.readFileSync(stylesPath, "utf8");

function extractBlockValues(blockText, keys) {
  const values = {};
  for (const key of keys) {
    const re = new RegExp(`${escapeRegex(key)}:([^;]+);`);
    const m = blockText.match(re);
    if (!m) throw new Error(`Token ${key} not found while reading styles.css — refusing to guess.`);
    values[key] = m[1];
  }
  return values;
}

function colorProdKey(dtcgPath) {
  const prefix = (dtcgPath.startsWith("hover") || dtcgPath.startsWith("selected") || dtcgPath.startsWith("bar") || dtcgPath.startsWith("badge")) ? "--overlay-" : "--color-";
  return `${prefix}${dtcgPath}`;
}
function staticEntries(tree) {
  const out = [];
  for (const [group, entries] of Object.entries(tree)) {
    if (group === "color") continue;
    for (const name of Object.keys(entries)) out.push([`${GROUP_TO_PREFIX[group]}${name}`, group, name]);
  }
  return out;
}

const colorPaths = Object.keys(light.color);
const colorProdKeys = colorPaths.map(colorProdKey);
const staticKeys = staticEntries(light); // [prodKey, group, name][]

const lightBlockMatch = css.match(/:root\{[\s\S]*?\r?\n\}/);
if (!lightBlockMatch) throw new Error("Could not locate light :root block in styles.css");
const mediaBlockMatch = css.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/);
if (!mediaBlockMatch) throw new Error("Could not locate dark @media block in styles.css");
const dataThemeBlockMatch = css.match(/:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/);
if (!dataThemeBlockMatch) throw new Error("Could not locate dark [data-theme] block in styles.css");

const cssLight = extractBlockValues(lightBlockMatch[0], [...colorProdKeys, ...staticKeys.map(([k]) => k)]);
const cssDarkMedia = extractBlockValues(mediaBlockMatch[0], colorProdKeys);
const cssDarkDataTheme = extractBlockValues(dataThemeBlockMatch[0], colorProdKeys);

for (const key of colorProdKeys) {
  if (cssDarkMedia[key] !== cssDarkDataTheme[key]) {
    throw new Error(
      `styles.css itself is inconsistent: ${key} = "${cssDarkMedia[key]}" in @media block but ` +
      `"${cssDarkDataTheme[key]}" in [data-theme="dark"] block. Fix styles.css by hand before pulling.`
    );
  }
}
const cssDark = cssDarkMedia;

// field === "hex" is a historical name for "the canonical color literal" —
// kept for the caller signature, but resolved via cssColorLiteral so rgba
// entries (hex: null) compare correctly instead of always reading null.
function currentValue(tree, group, name, field) {
  const entry = tree[group] && tree[group][name];
  if (!entry) return undefined;
  if (field === "hex") return cssColorLiteral(entry);
  return entry.$type === "dimension" ? `${entry.$value.value}${entry.$value.unit}` : entry.$value;
}

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  const colorsInSync = colorPaths.every((p) => {
    const prodKey = colorProdKey(p);
    const darkHex = currentValue(dark, "color", p, "hex") ?? currentValue(light, "color", p, "hex");
    return cssLight[prodKey] === currentValue(light, "color", p, "hex") && cssDark[prodKey] === darkHex;
  });
  const staticInSync = staticKeys.every(([prodKey, group, name]) => cssLight[prodKey] === currentValue(light, group, name));
  if (!colorsInSync || !staticInSync) {
    throw new Error(
      "No last-sync.json baseline found, and styles.css does not currently match design-tokens.{light,dark}.json. " +
      "Reconcile by hand once before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log("No baseline existed yet. styles.css already matches canonical — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const p of colorPaths) {
  const prodKey = colorProdKey(p);
  for (const mode of ["light", "dark"]) {
    const cssValue = mode === "light" ? cssLight[prodKey] : cssDark[prodKey];
    const tree = mode === "light" ? light : dark;
    const baselineTree = mode === "light" ? baseline.light : baseline.dark;
    const canonicalValue = currentValue(tree, "color", p, "hex") ?? (mode === "dark" ? currentValue(light, "color", p, "hex") : undefined);
    const baselineValue = currentValue(baselineTree, "color", p, "hex") ?? (mode === "dark" ? currentValue(baseline.light, "color", p, "hex") : undefined);
    if (cssValue === canonicalValue) continue;
    if (canonicalValue === baselineValue) {
      pulls.push({ scope: "color", path: p, mode, from: canonicalValue, to: cssValue });
    } else {
      conflicts.push({ key: `${prodKey} (${mode})`, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
    }
  }
}
for (const [prodKey, group, name] of staticKeys) {
  const cssValue = cssLight[prodKey];
  const canonicalValue = currentValue(light, group, name);
  const baselineValue = currentValue(baseline.light, group, name);
  if (cssValue === canonicalValue) continue;
  if (canonicalValue === baselineValue) {
    pulls.push({ scope: "static", group, name, from: canonicalValue, to: cssValue });
  } else {
    conflicts.push({ key: prodKey, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both styles.css and canonical changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) console.error(`  ${c.key}: baseline="${c.baseline}" canonical(now)="${c.canonical}" styles.css(now)="${c.css}"`);
  console.error("\nResolve by hand (edit design-tokens.light.json/.dark.json), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: styles.css matches canonical for every token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from styles.css into canonical:\n`);
for (const p of pulls) {
  const label = p.mode ? `${p.path} (${p.mode})` : `${p.group}.${p.name}`;
  console.log(`  ${label}: "${p.from}" -> "${p.to}"`);
}

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these.");
  process.exit(0);
}

for (const p of pulls) {
  if (p.scope === "color" && p.mode === "light") {
    light.color[p.path] = parseColorValue(p.to);
  } else if (p.scope === "color" && p.mode === "dark") {
    if (!dark.color) dark.color = {};
    dark.color[p.path] = parseColorValue(p.to);
  } else {
    light[p.group][p.name].$value = light[p.group][p.name].$type === "dimension"
      ? { value: parseFloat(p.to), unit: p.to.replace(/[\d.]+/, "") }
      : p.to;
  }
}

// Pruning: drop any dark.color entry that now equals its light counterpart.
// Compare the resolved CSS literal (cssColorLiteral), not raw .$value.hex —
// rgba-origin entries always have hex:null, so comparing .hex directly would
// read null === null (true) for every rgba pair regardless of whether their
// actual raw strings differ, silently pruning genuinely-different overrides.
for (const key of Object.keys(dark.color || {})) {
  if (!light.color[key]) continue;
  if (cssColorLiteral(dark.color[key]) === cssColorLiteral(light.color[key])) delete dark.color[key];
}

fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
console.log("\nWritten to design-tokens.{light,dark}.json, baseline updated.");
