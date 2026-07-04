// Generator #1: design-tokens.json (canonical) -> frontend/styles.css :root blocks.
// Surgical: replaces only the value after each known `--token-name:` declaration,
// inside the correct theme block (light :root, dark @media block, dark [data-theme] block).
// Never touches comments or any other CSS.
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }) so editor-server.cjs can call it directly.
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const tokensPath = path.join(tokenDir, "design-tokens.json");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function run({ write = false } = {}) {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const original = fs.readFileSync(stylesPath, "utf8");

  const lightEntries = [
    ...Object.entries(tokens.colors).map(([k, v]) => [k, v.light]),
    ...Object.entries(tokens.static),
  ];
  const darkEntries = Object.entries(tokens.colors).map(([k, v]) => [k, v.dark]);

  let text = original;
  const changedKeys = new Set();
  let step;

  // styles.css is CRLF (Windows checkout) — match \r?\n, never bare \n.
  step = replaceFirstBlock(text, /:root\{[\s\S]*?\r?\n\}/, "light :root", lightEntries);
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(
    text,
    /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/,
    "dark @media",
    darkEntries
  );
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  step = replaceFirstBlock(
    text,
    /:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/,
    "dark [data-theme]",
    darkEntries
  );
  text = step.newFull;
  step.changedKeys.forEach((k) => changedKeys.add(k));

  if (text === original) {
    return { noOp: true, changedKeys: [] };
  }
  if (write) {
    fs.writeFileSync(stylesPath, text, "utf8");
  }
  return { noOp: false, changedKeys: [...changedKeys] };
}

module.exports = { run };

if (require.main === module) {
  const writeFlag = process.argv.includes("--write");
  const result = run({ write: writeFlag });
  if (result.noOp) {
    console.log("No-op: styles.css already matches design-tokens.json for every known token.");
  } else {
    console.log(`Changed: ${result.changedKeys.join(", ")}`);
    console.log(writeFlag ? "Written to frontend/styles.css." : "Dry run only — pass --write to persist.");
  }
}
