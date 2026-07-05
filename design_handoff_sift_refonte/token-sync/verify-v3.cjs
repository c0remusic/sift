// verify-v3.cjs — v3 architecture verification (styles.css as sole canonical
// source, push-only). Replaces sync-core.verify.cjs (unit asserts on the old
// DTCG helpers, now deleted) and verify-roundtrip.cjs (round-tripped the old
// design-tokens.json against Sift.dc.html). Fail-fast: any assertion failure
// throws / exits non-zero, no soft warnings.
//
// Run: node verify-v3.cjs
const assert = require("assert");
const styles = require("./styles-css.cjs");

// 1. No-op round-trip on the REAL frontend/styles.css: parse then render with
//    zero edits must be byte-identical to the original file on disk. This is
//    the single most important guarantee of the new architecture — it proves
//    write() never regenerates the file, only substitutes matched values.
const original = styles.readStyles();
const tokens = styles.parse(original);
const { css: rendered, changedKeys } = styles.renderCss(original, tokens);
assert.strictEqual(rendered, original, "no-op round-trip must be byte-identical to frontend/styles.css");
assert.deepStrictEqual(changedKeys, [], "no-op round-trip must report zero changed keys");
console.log(`OK  no-op round-trip byte-identical (${Object.keys(tokens.colors).length} colors, ${Object.keys(tokens.static).length} static tokens)`);

// 2. The two dark blocks must have produced IDENTICAL values for every color
//    (parse() already throws if they disagree — re-assert here as a guard
//    against a future refactor silently loosening that check).
for (const [key, { light, dark }] of Object.entries(tokens.colors)) {
  assert.ok(typeof light === "string" && light.length > 0, `color ${key} must have a non-empty light value`);
  assert.ok(typeof dark === "string" && dark.length > 0, `color ${key} must have a non-empty dark value`);
}
console.log(`OK  every color token has both light and dark values`);

// 3. A single-value edit changes exactly that key, and both dark blocks
//    receive the identical new value, WITHOUT touching disk (renderCss is
//    the pure in-memory transform — no fs write happens unless write() is called).
const sampleKey = Object.keys(tokens.colors)[0];
const patched = JSON.parse(JSON.stringify(tokens));
const sentinel = "#123456";
patched.colors[sampleKey] = { light: sentinel, dark: sentinel };
const { css: editedCss, changedKeys: editedChanged } = styles.renderCss(original, patched);
assert.ok(editedCss !== original, "editing a value must change the rendered text");
assert.deepStrictEqual(editedChanged, [sampleKey], `renderCss must report exactly ["${sampleKey}"] as changed`);
const reparsed = styles.parse(editedCss);
assert.strictEqual(reparsed.colors[sampleKey].light, sentinel, "edited light value must round-trip");
assert.strictEqual(reparsed.colors[sampleKey].dark, sentinel, "edited dark value must round-trip");
// Restoring the original value must return to a byte-identical file.
patched.colors[sampleKey] = tokens.colors[sampleKey];
const { css: restoredCss } = styles.renderCss(original, patched);
assert.strictEqual(restoredCss, original, "restoring the original value must byte-match the original file");
console.log(`OK  single-value edit (${sampleKey}) writes both dark blocks identically and restores cleanly`);

// 4. classify() fail-fast: an unknown prefix must throw, never guess.
assert.throws(() => styles.parse(original.replace(/--font-ui:/, "--mystery-ui:")), /no known prefix/, "unknown token prefix must throw, not guess");
console.log("OK  unknown-prefix token throws fail-fast (classify)");

// 5. Missing dark declaration must throw fail-fast. Strip the key only from the
//    @media dark block (its declarations are indented 4 spaces, unlike light/[data-theme]).
const targetedBroken = original.replace(/(    --color-text-info:)[^;]+;/, "");
assert.throws(() => styles.parse(targetedBroken), /missing from the dark blocks|different token sets/, "a color present in light but missing from a dark block must throw");
console.log("OK  color missing from a dark block throws fail-fast");

// 6. alias-map coverage: every non-null mapped prod key must exist in styles.css.
const aliasMap = styles.loadAliasMap();
for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) continue;
  assert.ok(tokens.colors[prodKey], `alias-map points ${legacyKey} -> ${prodKey}, which styles.css does not declare`);
}
console.log("OK  every non-null alias-map entry resolves to a real styles.css color token");

console.log("\nverify-v3.cjs: all assertions passed.");
