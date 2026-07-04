// Generator #3: design-tokens.{light,dark}.json + alias-map.json -> DESIGN.md palette bullets.
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
const { loadCanonical, loadAliasMap, resolveTheme, cssColorLiteral, finalizeRun } = require("./sync-core.cjs");

const tokenDir = __dirname;
const mdPath = path.join(tokenDir, "..", "DESIGN.md");

function prodValue(resolved, aliasMap, legacyKey) {
  const prodKey = aliasMap[legacyKey];
  if (prodKey === null) return null;
  const dtcgPath = prodKey.replace(/^--(color|overlay)-/, "");
  const canonical = resolved.color[dtcgPath];
  if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from resolved DTCG tokens`);
  return cssColorLiteral(canonical);
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

function replaceSimpleBullets(text, bullets, resolved, aliasMap) {
  let result = text;
  const changedKeys = [];
  for (const [key, label] of bullets) {
    const value = prodValue(resolved, aliasMap, key);
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

function replaceCtaBullet(text, resolved, aliasMap) {
  const bg = prodValue(resolved, aliasMap, "ctaBg");
  const txt = prodValue(resolved, aliasMap, "ctaText");
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
  const { light, dark } = loadCanonical();
  const aliasMap = loadAliasMap();
  const resolvedLight = resolveTheme(light, dark, "light");
  const resolvedDark = resolveTheme(light, dark, "dark");
  const original = fs.readFileSync(mdPath, "utf8");

  const splitRe = /(## Palette — mode sombre)/;
  const parts = original.split(splitRe);
  if (parts.length !== 3) throw new Error("Could not split DESIGN.md into light/dark palette sections");
  const [lightSection, darkHeading, restFromDark] = parts;

  // +1 for "Désactivé" (an intentionally-unmanaged bullet that still matches this
  // shape; CTA does NOT match — its value is two backtick-spans, "fond `x`, texte `y`",
  // not the single-backtick shape this regex looks for, so it never counts here).
  const expectedLightCount = lightBullets.length + 1;
  // Dark's "rest of file" continues past the palette section to end-of-file, so it
  // also picks up 2 unrelated bullets from the later "## Composants" section
  // ("Carte", "CTA primaire (pill...)") that happen to match this same shape —
  // +1 for "Désactivé" and +2 for those Composants bullets.
  const expectedDarkCount = darkBullets.length + 1 + 2;
  const actualLightCount = countBulletLines(lightSection);
  const actualDarkCount = countBulletLines(restFromDark);
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
      `(${darkBullets.length} entries + 1 for "Désactivé" + 2 for "## Composants" bullets that fall ` +
      `inside this section too). Update darkBullets in this file to match.`
    );
  }

  let lightResult = replaceSimpleBullets(lightSection, lightBullets, resolvedLight, aliasMap);
  const lightCta = replaceCtaBullet(lightResult.text, resolvedLight, aliasMap);
  lightResult = { text: lightCta.text, changedKeys: [...lightResult.changedKeys, ...lightCta.changedKeys] };

  let darkResult = replaceSimpleBullets(restFromDark, darkBullets, resolvedDark, aliasMap);
  const darkCta = replaceCtaBullet(darkResult.text, resolvedDark, aliasMap);
  darkResult = { text: darkCta.text, changedKeys: [...darkResult.changedKeys, ...darkCta.changedKeys] };

  const newMd = lightResult.text + darkHeading + darkResult.text;
  return finalizeRun({
    targetPath: mdPath, original, updated: newMd,
    changedKeys: [...lightResult.changedKeys, ...darkResult.changedKeys], write,
    label: "DESIGN.md bullets already match design-tokens.{light,dark}.json for every present bullet",
  });
}

module.exports = { run };
if (require.main === module) run({ write: process.argv.includes("--write") });
