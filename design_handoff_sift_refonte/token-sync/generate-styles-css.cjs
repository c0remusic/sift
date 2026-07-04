// Generator #1: design-tokens.{light,dark}.json (canonical, DTCG-shaped) ->
// frontend/styles.css :root blocks.
// Surgical: replaces only the value after each known `--token-name:` declaration,
// inside the correct theme block (light :root, dark @media block, dark [data-theme] block).
// Never touches comments or any other CSS.
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }) so editor-server.cjs can call it directly.
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { loadCanonical, resolveTheme, cssColorLiteral, finalizeRun } = require("./sync-core.cjs");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");

// --color-background-primary -> color.background-primary ; --border-radius-md -> radius.md, etc.
// Same mapping table as migrate-to-dtcg.cjs (kept in sync manually — both are
// small, static, and rarely change; a shared module would be one more file for
// a 10-line table used by exactly 2 scripts).
const STATIC_PREFIX_MAP = [
  [/^--border-radius-/, "radius"],
  [/^--shadow-/, "shadow"],
  [/^--font-/, "font"],
  [/^--text-/, "text"],
  [/^--space-/, "space"],
  [/^--h-/, "height"],
];

const GROUP_TO_PREFIX = { radius: "--border-radius-", shadow: "--shadow-", font: "--font-", text: "--text-", space: "--space-", height: "--h-" };

function colorPath(key) {
  return key.replace(/^--(color|overlay)-/, "");
}
function staticLookup(resolved, key) {
  for (const [re, group] of STATIC_PREFIX_MAP) {
    if (re.test(key)) {
      const name = key.replace(re, "");
      const entry = resolved[group] && resolved[group][name];
      if (!entry) throw new Error(`generate-styles-css: no DTCG entry for "${key}" (looked in ${group}.${name})`);
      return entry.$type === "dimension" ? `${entry.$value.value}${entry.$value.unit}` : entry.$value;
    }
  }
  throw new Error(`generate-styles-css: no known static group for "${key}" — update STATIC_PREFIX_MAP.`);
}

function replaceTokensInBlock(blockText, entries) {
  const changedKeys = [];
  let text = blockText;
  for (const [key, value] of entries) {
    const re = new RegExp(`(${escapeRegex(key)}):[^;]+;`);
    if (!re.test(text)) {
      throw new Error(`Token ${key} not found in expected block — refusing to guess where to put it.`);
    }
    const before = text;
    text = text.replace(re, `$1:${value};`);
    if (text !== before) changedKeys.push(key);
  }
  return { text, changedKeys };
}

function replaceFirstBlock(fullText, blockRegex, label, entries) {
  const m = fullText.match(blockRegex);
  if (!m) throw new Error(`Could not locate ${label} block in styles.css`);
  const { text: newBlock, changedKeys } = replaceTokensInBlock(m[0], entries);
  const newFull = fullText.slice(0, m.index) + newBlock + fullText.slice(m.index + m[0].length);
  return { newFull, changedKeys };
}

// All production --color-*/--overlay-* keys and --static-* keys this generator
// knows how to look up. Derived from the DTCG tree itself (every color path,
// prefixed back to its --color-/--overlay- form) rather than hardcoded, so a
// newly added token is picked up without editing this file.
function allColorKeys(resolved) {
  return Object.keys(resolved.color).map((p) => {
    // overlay-* tokens were originally --overlay-*, everything else --color-*.
    return (p.startsWith("hover") || p.startsWith("selected") || p.startsWith("bar") || p.startsWith("badge"))
      ? `--overlay-${p}` : `--color-${p}`;
  });
}

function run({ write = false } = {}) {
  const { light, dark } = loadCanonical();
  const resolvedLight = resolveTheme(light, dark, "light");
  const resolvedDark = resolveTheme(light, dark, "dark");
  const original = fs.readFileSync(stylesPath, "utf8");

  const colorKeys = allColorKeys(resolvedLight);
  const staticKeys = [];
  for (const [group, entries] of Object.entries(resolvedLight)) {
    if (group === "color") continue;
    for (const name of Object.keys(entries)) staticKeys.push(`${GROUP_TO_PREFIX[group]}${name}`);
  }

  const lightEntries = [
    ...colorKeys.map((k) => [k, cssColorLiteral(resolvedLight.color[colorPath(k)])]),
    ...staticKeys.map((k) => [k, staticLookup(resolvedLight, k)]),
  ];
  const darkEntries = colorKeys.map((k) => [k, cssColorLiteral(resolvedDark.color[colorPath(k)])]);

  let text = original;
  const changedKeys = new Set();
  let step;

  // styles.css is CRLF (Windows checkout) — match \r?\n, never bare \n.
  step = replaceFirstBlock(text, /:root\{[\s\S]*?\r?\n\}/, "light :root", lightEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(text, /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/, "dark @media", darkEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(text, /:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/, "dark [data-theme]", darkEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  return finalizeRun({
    targetPath: stylesPath, original, updated: text, changedKeys: [...changedKeys], write,
    label: "styles.css already matches design-tokens.{light,dark}.json for every known token",
  });
}

module.exports = { run };
if (require.main === module) run({ write: process.argv.includes("--write") });
