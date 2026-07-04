// sync-core.cjs
// Shared mechanics for the 3 generate-*.cjs scripts: loading the DTCG canonical
// files, merging light+dark for a given mode, and the common compare/log/write
// tail. Each generator keeps its own block-location/replacement logic — this
// file does NOT own "what the output looks like" (see docs/superpowers/specs/
// 2026-07-04-token-sync-tool-v2-design.md Section B for why a generic
// format()-returns-whole-file model was rejected).
//
// parseColorValue/cssColorLiteral (added 2026-07-04, addendum to the design
// doc's Section A): the real design-tokens.json has 13/33 color values as
// rgba(r,g,b,a) strings, not hex — hexToComponents alone would crash on them.
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const aliasPath = path.join(tokenDir, "alias-map.json");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadCanonical() {
  return { light: loadJSON(lightPath), dark: loadJSON(darkPath) };
}

function loadAliasMap() {
  return loadJSON(aliasPath);
}

// Merge rule: dark = light with color.* overridden by whatever dark.json declares.
// Static categories (radius/text/space/height/shadow/font) never appear in
// dark.json, so they pass through from light untouched.
function resolveTheme(light, dark, mode) {
  if (mode === "light") return light;
  if (mode !== "dark") throw new Error(`resolveTheme: mode must be "light" or "dark", got "${mode}"`);
  return {
    ...light,
    color: { ...light.color, ...(dark.color || {}) },
  };
}

function hexToComponents(hex) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) throw new Error(`hexToComponents: "${hex}" is not a 6-digit hex color`);
  return m.slice(1, 4).map((h) => Math.round((parseInt(h, 16) / 255) * 10000) / 10000);
}

// Parses either a 6-digit hex string or an rgba(r,g,b,a) string into a DTCG
// color entry. `raw` on the rgba branch preserves the exact original string
// (e.g. ".08" vs "0.08") so writers can round-trip byte-exact.
function parseColorValue(raw) {
  const hexMatch = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(raw);
  if (hexMatch) {
    return { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(raw), hex: raw } };
  }
  const rgbaMatch = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(raw);
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const components = [r, g, b].map((c) => Math.round((Number(c) / 255) * 10000) / 10000);
    return { $type: "color", $value: { colorSpace: "srgb", components, alpha: Number(a), hex: null, raw } };
  }
  throw new Error(`parseColorValue: "${raw}" is neither a 6-digit hex nor an rgba(r,g,b,a) color`);
}

// Returns the exact CSS literal to emit for a DTCG color entry: the hex string
// for hex-origin entries, or the preserved raw rgba(...) string otherwise.
function cssColorLiteral(entry) {
  return entry.$value.hex ?? entry.$value.raw;
}

// Common tail for a generator's run(): compare, log, write-if-flag, report.
function finalizeRun({ targetPath, original, updated, changedKeys, write, label }) {
  if (updated === original) {
    console.log(`No-op: ${label}.`);
    return { noOp: true, changedKeys: [] };
  }
  console.log(`Changed: ${changedKeys.join(", ")}`);
  if (write) fs.writeFileSync(targetPath, updated, "utf8");
  console.log(write ? `Written to ${targetPath}.` : "Dry run only — pass --write to persist.");
  return { noOp: false, changedKeys };
}

module.exports = {
  loadCanonical,
  loadAliasMap,
  resolveTheme,
  hexToComponents,
  parseColorValue,
  cssColorLiteral,
  finalizeRun,
};
