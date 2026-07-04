// migrate-to-dtcg.cjs — one-time (but kept for reference/re-run) conversion
// from the old {colors, static} design-tokens.json into DTCG-shaped
// design-tokens.light.json / design-tokens.dark.json. Run once: node migrate-to-dtcg.cjs
//
// Uses parseColorValue (not a hex-only colorEntry helper) because 13 of the
// 33 real color values in design-tokens.json are rgba(r,g,b,a) strings, not
// hex — see the addendum in docs/superpowers/specs/2026-07-04-token-sync-tool-v2-design.md.
const fs = require("fs");
const path = require("path");
const { parseColorValue } = require("./sync-core.cjs");

const tokenDir = __dirname;
const oldPath = path.join(tokenDir, "design-tokens.json");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

// --color-background-primary -> color.background-primary ; --border-radius-md -> radius.md
// --shadow-toast -> shadow.toast ; --font-ui -> font.ui ; --text-md -> text.md
// --space-16 -> space.16 ; --h-36 -> height.36
const STATIC_PREFIX_MAP = [
  [/^--border-radius-/, "radius"],
  [/^--shadow-/, "shadow"],
  [/^--font-/, "font"],
  [/^--text-/, "text"],
  [/^--space-/, "space"],
  [/^--h-/, "height"],
];

function colorPath(key) {
  if (!key.startsWith("--color-") && !key.startsWith("--overlay-")) {
    throw new Error(`migrate-to-dtcg: unexpected color key shape "${key}"`);
  }
  return key.replace(/^--(color|overlay)-/, "");
}

function staticGroupAndName(key) {
  for (const [re, group] of STATIC_PREFIX_MAP) {
    if (re.test(key)) return [group, key.replace(re, "")];
  }
  throw new Error(`migrate-to-dtcg: no known static group for key "${key}"`);
}

function dimensionEntry(rawValue) {
  const m = /^(-?[\d.]+)(px|rem)$/.exec(rawValue);
  if (!m) throw new Error(`migrate-to-dtcg: "${rawValue}" is not a "<number><px|rem>" dimension`);
  return { $type: "dimension", $value: { value: Number(m[1]), unit: m[2] } };
}

function run() {
  const old = JSON.parse(fs.readFileSync(oldPath, "utf8"));
  const light = { color: {} };
  const dark = { color: {} };

  for (const [key, { light: lightRaw, dark: darkRaw }] of Object.entries(old.colors)) {
    const p = colorPath(key);
    light.color[p] = parseColorValue(lightRaw);
    if (darkRaw !== lightRaw) dark.color[p] = parseColorValue(darkRaw);
  }

  for (const [key, rawValue] of Object.entries(old.static)) {
    const [group, name] = staticGroupAndName(key);
    if (!light[group]) light[group] = {};
    if (group === "shadow") {
      light[group][name] = { $type: "shadow", $value: rawValue };
    } else if (group === "font") {
      light[group][name] = { $type: "fontFamily", $value: rawValue };
    } else {
      light[group][name] = dimensionEntry(rawValue);
    }
  }

  fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
  fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log(`Migrated ${Object.keys(old.colors).length} color tokens, ${Object.keys(old.static).length} static tokens.`);
  console.log(`${Object.keys(dark.color).length} colors differ in dark mode (written to design-tokens.dark.json).`);
}

module.exports = { run };
if (require.main === module) run();
