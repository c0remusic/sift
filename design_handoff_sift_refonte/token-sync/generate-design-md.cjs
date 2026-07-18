// Generator: frontend/styles.css (canonical, via styles-css.cjs) + alias-map.json -> DESIGN.md palette bullets.
// DESIGN.md is prose, not a data format: bullets are matched by their exact known label
// text (read from the real file), not by position/order — the light and dark sections do
// NOT have the same set of bullets (dark has no "Track" line at all; this generator leaves
// that gap alone rather than inventing where to insert one).
//
// Usable both as a CLI (dry-run by default, --write to persist) and as a module
// (via run({ write }) -> { noOp, changedKeys }).
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const stylesCss = require("./styles-css.cjs");

const tokenDir = __dirname;
const mdPath = path.join(tokenDir, "..", "DESIGN.md");

// tokens = client shape from styles-css.parse(); mode = "light" | "dark".
function prodValue(tokens, aliasMap, legacyKey, mode) {
  const prodKey = aliasMap[legacyKey];
  if (prodKey === null) return null;
  const color = tokens.colors[prodKey];
  if (!color) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from styles.css tokens`);
  return color[mode];
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

function replaceSimpleBullets(text, bullets, tokens, aliasMap, mode) {
  let result = text;
  const changedKeys = [];
  for (const [key, label] of bullets) {
    const value = prodValue(tokens, aliasMap, key, mode);
    const re = new RegExp(`(- ${escapeRegex(label)} : \`)[^\`]+(\`)`);
    if (!re.test(result)) {
      throw new Error(`Bullet "${label}" not found in DESIGN.md — refusing to guess.`);
    }
    const before = result;
    result = result.replace(re, `$1${value}$2`);
    if (result !== before) changedKeys.push(key);
  }
  return { text: result, changedKeys };
}

function replaceCtaBullet(text, tokens, aliasMap, mode) {
  const bg = prodValue(tokens, aliasMap, "ctaBg", mode);
  const txt = prodValue(tokens, aliasMap, "ctaText", mode);
  const re = /(- CTA primaire : fond `)[^`]+(`, texte `)[^`]+(`)/;
  if (!re.test(text)) throw new Error(`CTA primaire bullet not found in DESIGN.md`);
  const before = text;
  const after = text.replace(re, `$1${bg}$2${txt}$3`);
  return { text: after, changedKeys: after !== before ? ["ctaBg/ctaText"] : [] };
}

// Counts real "- Label : `value`" bullet lines in a section of DESIGN.md's prose.
// Used to detect when the file gained/lost a bullet the hardcoded lightBullets/
// darkBullets lists don't know about yet (a case the per-bullet regex above can't
// catch, since it only checks "is my known label still there").
function countBulletLines(text) {
  const matches = text.match(/^- .+ : `[^`]+`$/gm);
  return matches ? matches.length : 0;
}

function run({ write = false } = {}) {
  const tokens = stylesCss.parse();
  const aliasMap = stylesCss.loadAliasMap();
  const original = fs.readFileSync(mdPath, "utf8");

  const splitRe = /(## Palette — mode sombre)/;
  const parts = original.split(splitRe);
  if (parts.length !== 3) throw new Error("Could not split DESIGN.md into light/dark palette sections");
  const [lightSection, darkHeading, restFromDark] = parts;
  // The dark palette owns content until the next level-2 section; later sections
  // must stay untouched even if their prose contains palette-shaped bullets.
  const nextSectionIndex = restFromDark.search(/\n## /);
  const darkSection = nextSectionIndex === -1 ? restFromDark : restFromDark.slice(0, nextSectionIndex);
  const afterDarkSection = nextSectionIndex === -1 ? "" : restFromDark.slice(nextSectionIndex);

  // +1 for "Désactivé" (an intentionally-unmanaged bullet that still matches this
  // shape; CTA does NOT match — its value is two backtick-spans, "fond `x`, texte `y`",
  // not the single-backtick shape this regex looks for, so it never counts here).
  const expectedLightCount = lightBullets.length + 1;
  const expectedDarkCount = darkBullets.length + 1;
  const actualLightCount = countBulletLines(lightSection);
  const actualDarkCount = countBulletLines(darkSection);
  if (actualLightCount !== expectedLightCount) {
    throw new Error(
      `DESIGN.md's light section has ${actualLightCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's lightBullets list only knows about ${expectedLightCount} ` +
      `(${lightBullets.length} entries + 1 for "Désactivé"). Update lightBullets in this file to match.`
    );
  }
  if (actualDarkCount !== expectedDarkCount) {
    throw new Error(
      `DESIGN.md's dark section has ${actualDarkCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's darkBullets list only knows about ${expectedDarkCount} ` +
      `(${darkBullets.length} entries + 1 for "Désactivé"). Update darkBullets in this file to match.`
    );
  }

  let lightResult = replaceSimpleBullets(lightSection, lightBullets, tokens, aliasMap, "light");
  const lightCta = replaceCtaBullet(lightResult.text, tokens, aliasMap, "light");
  lightResult = { text: lightCta.text, changedKeys: [...lightResult.changedKeys, ...lightCta.changedKeys] };

  let darkResult = replaceSimpleBullets(darkSection, darkBullets, tokens, aliasMap, "dark");
  const darkCta = replaceCtaBullet(darkResult.text, tokens, aliasMap, "dark");
  darkResult = { text: darkCta.text, changedKeys: [...darkResult.changedKeys, ...darkCta.changedKeys] };

  const newMd = lightResult.text + darkHeading + darkResult.text + afterDarkSection;
  return stylesCss.finalizeRun({
    targetPath: mdPath, original, updated: newMd,
    changedKeys: [...lightResult.changedKeys, ...darkResult.changedKeys], write,
    label: "DESIGN.md bullets already match styles.css for every present bullet",
  });
}

module.exports = { run };
if (require.main === module) run({ write: process.argv.includes("--write") });
