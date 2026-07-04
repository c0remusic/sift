// Generator #2: design-tokens.{light,dark}.json + alias-map.json -> theme() literals in Sift.dc.html.
// Only touches the two theme() object literals (dark branch, light branch). Keys mapped to
// null in alias-map.json (e.g. "disabled") are left untouched — no production equivalent,
// not this generator's business.
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }).
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { loadCanonical, loadAliasMap, resolveTheme, cssColorLiteral, finalizeRun } = require("./sync-core.cjs");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");

function buildEntries(resolved, aliasMap) {
  const entries = [];
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const dtcgPath = prodKey.replace(/^--(color|overlay)-/, "");
    const canonical = resolved.color[dtcgPath];
    if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from resolved DTCG tokens`);
    entries.push([legacyKey, cssColorLiteral(canonical)]);
  }
  return entries;
}

function replaceKeysInObjectLiteral(blockText, entries) {
  let text = blockText;
  const changedKeys = [];
  for (const [key, value] of entries) {
    const re = new RegExp(`${escapeRegex(key)}\\s*:\\s*'[^']*'`);
    if (!re.test(text)) {
      throw new Error(`Key "${key}" not found in theme() object literal — refusing to guess.`);
    }
    const before = text;
    text = text.replace(re, `${key}:'${value}'`);
    if (text !== before) changedKeys.push(key);
  }
  return { text, changedKeys };
}

// Pure text transform, no filesystem — reused by run() and by editor-server.cjs's
// /preview.html (patches an in-memory copy for the live full-mockup preview).
// Signature change: takes already-resolved light/dark trees, not raw {colors} tokens.
function transform(html, resolvedLight, resolvedDark, aliasMap) {
  const wholeRegex = /isDark\(\)\s*\?\s*(\{[\s\S]*?\})\s*:\s*(\{[\s\S]*?\})\s*;/;
  const m = html.match(wholeRegex);
  if (!m) throw new Error("Could not locate theme()'s isDark() ? {dark} : {light} literal in Sift.dc.html");

  const darkResult = replaceKeysInObjectLiteral(m[1], buildEntries(resolvedDark, aliasMap));
  const lightResult = replaceKeysInObjectLiteral(m[2], buildEntries(resolvedLight, aliasMap));

  let newWhole = m[0].replace(m[1], darkResult.text);
  newWhole = newWhole.replace(m[2], lightResult.text);

  const changedKeys = [...new Set([...darkResult.changedKeys, ...lightResult.changedKeys])];
  const newHtml = html.slice(0, m.index) + newWhole + html.slice(m.index + m[0].length);
  return { html: newHtml, changed: newHtml !== html, changedKeys };
}

function run({ write = false } = {}) {
  const { light, dark } = loadCanonical();
  const aliasMap = loadAliasMap();
  const original = fs.readFileSync(htmlPath, "utf8");

  const result = transform(original, resolveTheme(light, dark, "light"), resolveTheme(light, dark, "dark"), aliasMap);
  return finalizeRun({
    targetPath: htmlPath, original, updated: result.html, changedKeys: result.changedKeys, write,
    label: "Sift.dc.html theme() already matches design-tokens.{light,dark}.json for every mapped key",
  });
}

module.exports = { run, transform };
if (require.main === module) run({ write: process.argv.includes("--write") });
