// Round-trip check for design-tokens.json + alias-map.json against Sift.dc.html's theme().
// Fails fast (non-zero exit) on any mismatch or missing mapping. No fallback values.
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const tokens = JSON.parse(fs.readFileSync(path.join(dir, "design-tokens.json"), "utf8"));
const aliasMap = JSON.parse(fs.readFileSync(path.join(dir, "alias-map.json"), "utf8"));
const html = fs.readFileSync(path.join(dir, "..", "Sift.dc.html"), "utf8");

function extractBranch(regex, label) {
  const m = html.match(regex);
  if (!m) throw new Error(`Could not locate ${label} branch of theme() in Sift.dc.html`);
  const pairs = {};
  for (const [, key, value] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    pairs[key] = value;
  }
  return pairs;
}

const darkTheme = extractBranch(/isDark\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/, "dark");
const lightTheme = extractBranch(/\}\s*:\s*\{([\s\S]*?)\}\s*;\s*\n\s*\}/, "light");

let failures = 0;
for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) {
    console.log(`SKIP  ${legacyKey} — documented as unmapped (no production consumer)`);
    continue;
  }
  const canonical = tokens.colors[prodKey];
  if (!canonical) {
    console.error(`FAIL  ${legacyKey} -> ${prodKey}: no such key in design-tokens.json`);
    failures++;
    continue;
  }
  for (const mode of ["light", "dark"]) {
    const themeValue = mode === "light" ? lightTheme[legacyKey] : darkTheme[legacyKey];
    const canonicalValue = canonical[mode];
    if (themeValue !== canonicalValue) {
      console.error(`FAIL  ${legacyKey} (${mode}): theme()="${themeValue}" canonical="${canonicalValue}"`);
      failures++;
    } else {
      console.log(`OK    ${legacyKey} (${mode}) = ${themeValue}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} mismatch(es) found.`);
  process.exit(1);
}
console.log("\nRound-trip clean: canonical tokens match Sift.dc.html theme() for every mapped key.");
