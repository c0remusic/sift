// Generator #2: design-tokens.json + alias-map.json -> theme() literals in Sift.dc.html.
// Only touches the two theme() object literals (dark branch, light branch). Keys mapped to
// null in alias-map.json (e.g. "disabled") are left untouched — no production equivalent,
// not this generator's business.
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }).
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const tokensPath = path.join(tokenDir, "design-tokens.json");
const aliasPath = path.join(tokenDir, "alias-map.json");

function buildEntries(tokens, aliasMap, mode) {
  const entries = [];
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const canonical = tokens.colors[prodKey];
    if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
    entries.push([legacyKey, canonical[mode]]);
  }
  return entries;
}

function replaceKeysInObjectLiteral(blockText, entries) {
  let text = blockText;
  const changedKeys = [];
  for (const [key, value] of entries) {
    const re = new RegExp(`${key}\\s*:\\s*'[^']*'`);
    if (!re.test(text)) {
      throw new Error(`Key "${key}" not found in theme() object literal — refusing to guess.`);
    }
    const before = text;
    text = text.replace(re, `${key}:'${value}'`);
    if (text !== before) changedKeys.push(key);
  }
  return { text, changedKeys };
}

// Pure text transform, no filesystem — reused by run() (writes to the real Sift.dc.html)
// and by editor-server.cjs's /preview.html (patches an in-memory copy for the live full-
// mockup preview, never touching disk).
function transform(html, tokens, aliasMap) {
  const wholeRegex = /isDark\(\)\s*\?\s*(\{[\s\S]*?\})\s*:\s*(\{[\s\S]*?\})\s*;/;
  const m = html.match(wholeRegex);
  if (!m) throw new Error("Could not locate theme()'s isDark() ? {dark} : {light} literal in Sift.dc.html");

  const darkResult = replaceKeysInObjectLiteral(m[1], buildEntries(tokens, aliasMap, "dark"));
  const lightResult = replaceKeysInObjectLiteral(m[2], buildEntries(tokens, aliasMap, "light"));

  let newWhole = m[0].replace(m[1], darkResult.text);
  newWhole = newWhole.replace(m[2], lightResult.text);

  const changedKeys = [...new Set([...darkResult.changedKeys, ...lightResult.changedKeys])];
  const newHtml = html.slice(0, m.index) + newWhole + html.slice(m.index + m[0].length);
  return { html: newHtml, changed: newHtml !== html, changedKeys };
}

function run({ write = false } = {}) {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
  const original = fs.readFileSync(htmlPath, "utf8");

  const result = transform(original, tokens, aliasMap);
  if (!result.changed) {
    return { noOp: true, changedKeys: [] };
  }
  if (write) {
    fs.writeFileSync(htmlPath, result.html, "utf8");
  }
  return { noOp: false, changedKeys: result.changedKeys };
}

module.exports = { run, transform };

if (require.main === module) {
  const writeFlag = process.argv.includes("--write");
  const result = run({ write: writeFlag });
  if (result.noOp) {
    console.log("No-op: Sift.dc.html theme() already matches design-tokens.json for every mapped key.");
  } else {
    console.log(`Changed: ${result.changedKeys.join(", ")}`);
    console.log(writeFlag ? "Written to Sift.dc.html." : "Dry run only — pass --write to persist.");
  }
}
