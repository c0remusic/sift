// Generator #3: design-tokens.json + alias-map.json -> DESIGN.md palette bullets.
// DESIGN.md is prose, not a data format: bullets are matched by their exact known label
// text (read from the real file), not by position/order — the light and dark sections do
// NOT have the same set of bullets (dark has no "Track" line at all; this generator leaves
// that gap alone rather than inventing where to insert one).
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }).
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const mdPath = path.join(tokenDir, "..", "DESIGN.md");
const tokensPath = path.join(tokenDir, "design-tokens.json");
const aliasPath = path.join(tokenDir, "alias-map.json");

function prodValue(tokens, aliasMap, legacyKey, mode) {
  const prodKey = aliasMap[legacyKey];
  if (prodKey === null) return null;
  const canonical = tokens.colors[prodKey];
  if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
  return canonical[mode];
}

const lightBullets = [
  ["canvas", "Canvas"],
  ["nav", "Nav"],
  ["queue", "Queue"],
  ["card", "Cartes / contrôles"],
  ["surface", "Surface (boutons/popovers élevés)"],
  ["track", "Track (fond des toggles/segmented controls)"],
  ["rowActive", "Ligne active (row hover/focus)"],
  ["navActive", "Nav item actif"],
  ["text1", "Texte primaire"],
  ["text2", "Texte secondaire"],
  ["text3", "Texte tertiaire"],
  ["text4", "Texte quaternaire (micro-labels)"],
  ["border", "Bordure fine"],
  ["borderStrong", "Bordure forte"],
];
const darkBullets = [
  ["canvas", "Canvas"],
  ["nav", "Nav"],
  ["queue", "Queue"],
  ["card", "Cartes / contrôles"],
  ["surface", "Surface"],
  // no "track" entry: DESIGN.md's dark section has no Track bullet at all (verified via grep).
  ["rowActive", "Ligne active"],
  ["navActive", "Nav item actif"],
  ["text1", "Texte primaire"],
  ["text2", "Texte secondaire"],
  ["text3", "Texte tertiaire"],
  ["text4", "Texte quaternaire"],
  ["border", "Bordure fine"],
  ["borderStrong", "Bordure forte"],
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceSimpleBullets(text, bullets, tokens, aliasMap, mode) {
  let result = text;
  const changedKeys = [];
  for (const [key, label] of bullets) {
    const value = prodValue(tokens, aliasMap, key, mode);
    const re = new RegExp(`(- ${escapeRegex(label)} : \`)[^\`]+(\`)`);
    if (!re.test(result)) {
      throw new Error(`Bullet "${label}" (${mode}) not found in DESIGN.md — refusing to guess.`);
    }
    const before = result;
    result = result.replace(re, `$1${value}$2`);
    if (result !== before) changedKeys.push(`${key} (${mode})`);
  }
  return { text: result, changedKeys };
}

function replaceCtaBullet(text, tokens, aliasMap, mode) {
  const bg = prodValue(tokens, aliasMap, "ctaBg", mode);
  const txt = prodValue(tokens, aliasMap, "ctaText", mode);
  const re = /(- CTA primaire : fond `)[^`]+(`, texte `)[^`]+(`)/;
  if (!re.test(text)) throw new Error(`CTA primaire bullet (${mode}) not found in DESIGN.md`);
  const before = text;
  const after = text.replace(re, `$1${bg}$2${txt}$3`);
  return { text: after, changedKeys: after !== before ? [`ctaBg/ctaText (${mode})`] : [] };
}

function run({ write = false } = {}) {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
  const original = fs.readFileSync(mdPath, "utf8");

  const splitRe = /(## Palette — mode sombre)/;
  const parts = original.split(splitRe);
  if (parts.length !== 3) throw new Error("Could not split DESIGN.md into light/dark palette sections");
  const [lightSection, darkHeading, restFromDark] = parts;

  let lightResult = replaceSimpleBullets(lightSection, lightBullets, tokens, aliasMap, "light");
  const lightCta = replaceCtaBullet(lightResult.text, tokens, aliasMap, "light");
  lightResult = { text: lightCta.text, changedKeys: [...lightResult.changedKeys, ...lightCta.changedKeys] };

  let darkResult = replaceSimpleBullets(restFromDark, darkBullets, tokens, aliasMap, "dark");
  const darkCta = replaceCtaBullet(darkResult.text, tokens, aliasMap, "dark");
  darkResult = { text: darkCta.text, changedKeys: [...darkResult.changedKeys, ...darkCta.changedKeys] };

  const newMd = lightResult.text + darkHeading + darkResult.text;
  const changedKeys = [...lightResult.changedKeys, ...darkResult.changedKeys];

  if (newMd === original) {
    return { noOp: true, changedKeys: [] };
  }
  if (write) {
    fs.writeFileSync(mdPath, newMd, "utf8");
  }
  return { noOp: false, changedKeys };
}

module.exports = { run };

if (require.main === module) {
  const writeFlag = process.argv.includes("--write");
  const result = run({ write: writeFlag });
  if (result.noOp) {
    console.log("No-op: DESIGN.md bullets already match design-tokens.json for every present bullet.");
    console.log("NOTE: dark section has no \"Track\" bullet at all — left alone (documentation gap, not generated).");
  } else {
    console.log(`Changed: ${result.changedKeys.join(", ")}`);
    console.log(writeFlag ? "Written to DESIGN.md." : "Dry run only — pass --write to persist.");
  }
}
