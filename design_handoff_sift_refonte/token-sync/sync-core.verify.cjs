// sync-core.verify.cjs — plain-assert verification, no test framework in this
// directory (matches every other script here). Run: node sync-core.verify.cjs
const assert = require("assert");
const { resolveTheme, hexToComponents, parseColorValue, cssColorLiteral } = require("./sync-core.cjs");

// resolveTheme: light mode returns light untouched
const light = { color: { a: { $type: "color", $value: { hex: "#111111" } } }, radius: { md: { $value: 6 } } };
const dark = { color: { a: { $type: "color", $value: { hex: "#eeeeee" } } } };
assert.deepStrictEqual(resolveTheme(light, dark, "light"), light, "light mode must return light untouched");

// resolveTheme: dark mode overrides only color.*, keeps static categories from light
const resolved = resolveTheme(light, dark, "dark");
assert.strictEqual(resolved.color.a.$value.hex, "#eeeeee", "dark override must win");
assert.deepStrictEqual(resolved.radius, light.radius, "non-color categories must pass through from light");

// resolveTheme: dark.json may omit color entirely (no overrides at all yet)
const noDark = resolveTheme(light, {}, "dark");
assert.deepStrictEqual(noDark.color, light.color, "empty dark set must fall back to light colors");

// resolveTheme: rejects unknown mode
assert.throws(() => resolveTheme(light, dark, "sepia"), /must be "light" or "dark"/);

// hexToComponents: known values
assert.deepStrictEqual(hexToComponents("#E7E2DB"), [0.9059, 0.8863, 0.8588]);
assert.deepStrictEqual(hexToComponents("#000000"), [0, 0, 0]);
assert.deepStrictEqual(hexToComponents("#FFFFFF"), [1, 1, 1]);
assert.throws(() => hexToComponents("#zzz"), /not a 6-digit hex color/);

// parseColorValue: hex input behaves like hexToComponents wrapped in a DTCG entry
const hexEntry = parseColorValue("#E7E2DB");
assert.deepStrictEqual(hexEntry, {
  $type: "color",
  $value: { colorSpace: "srgb", components: [0.9059, 0.8863, 0.8588], hex: "#E7E2DB" },
});

// parseColorValue: rgba input preserves the exact raw string and computes alpha/components
const rgbaEntry = parseColorValue("rgba(40,34,28,.09)");
assert.strictEqual(rgbaEntry.$type, "color");
assert.strictEqual(rgbaEntry.$value.hex, null);
assert.strictEqual(rgbaEntry.$value.raw, "rgba(40,34,28,.09)");
assert.strictEqual(rgbaEntry.$value.alpha, 0.09);
assert.deepStrictEqual(rgbaEntry.$value.components, [0.1569, 0.1333, 0.1098]);

// parseColorValue: rejects anything that's neither hex nor rgba
assert.throws(() => parseColorValue("not-a-color"), /neither a 6-digit hex nor an rgba/);

// cssColorLiteral: returns hex for hex-origin entries, raw for rgba-origin entries
assert.strictEqual(cssColorLiteral(hexEntry), "#E7E2DB");
assert.strictEqual(cssColorLiteral(rgbaEntry), "rgba(40,34,28,.09)");

console.log("sync-core.verify.cjs: all assertions passed.");
