// styles-css.cjs — v3 core: frontend/styles.css IS the canonical token store.
// Parses and writes the 3 token blocks of styles.css:
//   1. light  `:root{...}`                          (colors + static tokens)
//   2. dark   `@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){...} }`
//   3. dark   `:root[data-theme="dark"]{...}`
// Invariants (fail-fast, never guessed):
//   - both dark blocks must hold the exact same color token set and values on
//     read, and are always written identical;
//   - a token asked for but not present in its block throws;
//   - writes are in-place value substitutions on the original text — the file
//     is never regenerated, so parse+write with no change is byte-identical.
//
// Token classification is derived from the real prod names in styles.css, not
// a startsWith heuristic: any custom property starting with a COLOR_PREFIXES
// entry is a color (has a dark variant); anything starting with a
// STATIC_PREFIXES entry is static (light block only). An unknown prefix throws.
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const aliasPath = path.join(tokenDir, "alias-map.json");

const COLOR_PREFIXES = ["--color-", "--overlay-"];
const STATIC_PREFIXES = ["--border-radius-", "--shadow-", "--font-", "--text-", "--space-", "--h-"];

// styles.css is a CRLF checkout — always match \r?\n, never bare \n.
const LIGHT_BLOCK_RE = /:root\{[\s\S]*?\r?\n\}/;
const MEDIA_BLOCK_RE = /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/;
const DATA_THEME_BLOCK_RE = /:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/;

function loadAliasMap() {
  return JSON.parse(fs.readFileSync(aliasPath, "utf8"));
}

function readStyles() {
  return fs.readFileSync(stylesPath, "utf8");
}

function matchBlock(css, re, label) {
  const m = css.match(re);
  if (!m) throw new Error(`styles-css: could not locate ${label} block in styles.css`);
  return m;
}

function classify(key) {
  if (COLOR_PREFIXES.some((p) => key.startsWith(p))) return "color";
  if (STATIC_PREFIXES.some((p) => key.startsWith(p))) return "static";
  throw new Error(
    `styles-css: token "${key}" has no known prefix (color: ${COLOR_PREFIXES.join(", ")}; ` +
    `static: ${STATIC_PREFIXES.join(", ")}). Extend the prefix tables deliberately, don't guess.`
  );
}

// All `--x:value;` declarations of a block, in declaration order.
function declarationsOf(blockText) {
  const out = {};
  for (const [, key, value] of blockText.matchAll(/(--[\w-]+):([^;]+);/g)) {
    if (key in out) throw new Error(`styles-css: token "${key}" declared twice in the same block`);
    out[key] = value;
  }
  return out;
}

// parse(css?) -> { colors: { "--color-x": { light, dark } }, static: { "--text-x": value } }
// Same shape editor.html has always consumed from /tokens.json.
function parse(css = readStyles()) {
  const lightDecls = declarationsOf(matchBlock(css, LIGHT_BLOCK_RE, "light :root")[0]);
  const mediaDecls = declarationsOf(matchBlock(css, MEDIA_BLOCK_RE, "dark @media")[0]);
  const dataThemeDecls = declarationsOf(matchBlock(css, DATA_THEME_BLOCK_RE, 'dark [data-theme="dark"]')[0]);

  const mediaKeys = Object.keys(mediaDecls).sort().join(",");
  const dataThemeKeys = Object.keys(dataThemeDecls).sort().join(",");
  if (mediaKeys !== dataThemeKeys) {
    throw new Error(
      `styles-css: the two dark blocks of styles.css declare different token sets ` +
      `(@media: [${mediaKeys}] vs [data-theme]: [${dataThemeKeys}]). Fix styles.css by hand.`
    );
  }
  for (const key of Object.keys(mediaDecls)) {
    if (mediaDecls[key] !== dataThemeDecls[key]) {
      throw new Error(
        `styles-css: styles.css is inconsistent: ${key} = "${mediaDecls[key]}" in the @media dark block ` +
        `but "${dataThemeDecls[key]}" in the [data-theme="dark"] block. Fix styles.css by hand.`
      );
    }
  }

  const colors = {};
  const static_ = {};
  for (const [key, lightValue] of Object.entries(lightDecls)) {
    if (classify(key) === "color") {
      const darkValue = mediaDecls[key];
      if (darkValue === undefined) {
        throw new Error(`styles-css: color token ${key} is in the light block but missing from the dark blocks.`);
      }
      colors[key] = { light: lightValue, dark: darkValue };
    } else {
      static_[key] = lightValue;
    }
  }
  for (const key of Object.keys(mediaDecls)) {
    if (!(key in colors)) {
      throw new Error(`styles-css: dark blocks declare ${key} which the light :root block does not — fix styles.css.`);
    }
  }
  return { colors, static: static_ };
}

function replaceTokensInBlock(blockText, entries, label) {
  const changedKeys = [];
  let text = blockText;
  for (const [key, value] of entries) {
    const re = new RegExp(`(${escapeRegex(key)}):[^;]+;`);
    if (!re.test(text)) {
      throw new Error(`styles-css: token ${key} not found in ${label} block — refusing to guess where to put it.`);
    }
    const before = text;
    text = text.replace(re, `$1:${value};`);
    if (text !== before) changedKeys.push(key);
  }
  return { text, changedKeys };
}

function replaceFirstBlock(fullText, blockRegex, label, entries) {
  const m = matchBlock(fullText, blockRegex, label);
  const { text: newBlock, changedKeys } = replaceTokensInBlock(m[0], entries, label);
  const newFull = fullText.slice(0, m.index) + newBlock + fullText.slice(m.index + m[0].length);
  return { newFull, changedKeys };
}

// Pure text transform: original css text + client-shape tokens -> new css text.
// The two dark blocks are always written with the same values (tokens.colors[k].dark).
function renderCss(originalCss, tokens) {
  const lightEntries = [...Object.entries(tokens.colors).map(([k, v]) => [k, v.light]), ...Object.entries(tokens.static)];
  const darkEntries = Object.entries(tokens.colors).map(([k, v]) => [k, v.dark]);

  const changedKeys = new Set();
  let text = originalCss;
  let step;

  step = replaceFirstBlock(text, LIGHT_BLOCK_RE, "light :root", lightEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(text, MEDIA_BLOCK_RE, "dark @media", darkEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(text, DATA_THEME_BLOCK_RE, 'dark [data-theme="dark"]', darkEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  return { css: text, changedKeys: [...changedKeys] };
}

// Reads styles.css, applies the client-shape tokens, writes back if anything
// changed. Returns { noOp, changedKeys } (same contract the generators use).
function write(tokens) {
  const original = readStyles();
  const { css, changedKeys } = renderCss(original, tokens);
  if (css === original) return { noOp: true, changedKeys: [] };
  fs.writeFileSync(stylesPath, css, "utf8");
  return { noOp: false, changedKeys };
}

// Common tail for a generator's run(): compare, log, write-if-flag, report.
// (Moved here from the deleted sync-core.cjs — unchanged behavior.)
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

module.exports = { stylesPath, parse, renderCss, write, readStyles, loadAliasMap, finalizeRun };
