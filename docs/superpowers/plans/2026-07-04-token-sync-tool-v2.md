# Token-sync tool v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Sift token-sync tool's canonical storage to real DTCG-shaped
tokens (2-file light/dark cascade), consolidate the 3 generators' shared
mechanics, replace `editor.html`'s stacked accordions with a sidebar+search
nav, and add a debounced auto-refresh to the live mockup preview.

**Architecture:** DTCG is a storage-and-generator-internal concern only. The
`editor-server.cjs` ↔ `editor.html` wire contract (`{colors:{key:{light,dark}},
static:{key:value}}`, hex strings) never changes — `editor-server.cjs` converts
at its 3 boundary routes. See
`docs/superpowers/specs/2026-07-04-token-sync-tool-v2-design.md` for the full
design and the reasoning behind every decision below (do not re-derive it;
read it first if anything here is unclear).

**Tech Stack:** Plain Node.js (CommonJS, `.cjs`), no new dependencies. Built-in
`assert` module for automated tests on pure functions; manual backup/restore
CLI verification (matching this tool's existing convention — see Task 5's
report style in `docs/superpowers/plans/2026-07-04-token-sync-fixes.md`) for
scripts that mutate real files.

## Global Constraints

- **No new npm dependencies.** Zero-dep Node scripts + `http` built-in server,
  per the spec's explicit rejection of Terrazzo/Style Dictionary as deps.
- **CRLF-aware regex everywhere** touching `frontend/styles.css` or
  `Sift.dc.html` — always `\r?\n`, never bare `\n` (this repo's files are CRLF).
- **Dual CLI/module shape** for every script: `module.exports = { run, ... }`
  plus `if (require.main === module) { ... }` — matches every existing script
  in `design_handoff_sift_refonte/token-sync/`.
- **Dry-run by default, `--write` to persist** — every script that writes a
  real file.
- **Fail-fast, no silent fallback** — throw with the exact file/line/token on
  any unexpected state (missing key, malformed block, conflict). Never guess.
- **`hex` is the only authoritative color value.** `components` is always
  recomputed fresh from `hex` at write time — never read-modify-written, never
  hand-edited. Formula: `components[i] = Math.round((byte[i] / 255) * 10000) / 10000`.
- **`design-tokens.dark.json` only ever contains `color.*` entries that differ
  from `design-tokens.light.json`.** Any write path that produces a dark value
  equal to its light counterpart must delete that entry from `dark.json`
  instead of keeping a redundant copy (pruning rule, all 3 write paths:
  `/validate`, `pull-styles-css.cjs --write`, `pull-theme-html.cjs --write`).
- **Filenames stay stable.** `apply-tokens.cjs`'s `require()` paths and CLI
  usage (`node apply-tokens.cjs [--write]`) do not change. `editor.html`'s
  `validateTokensShape()` shape and wire contract do not change (Section A is
  invisible to the browser).

---

### Task 1: `sync-core.cjs` + migrate canonical storage to DTCG

**Files:**
- Create: `design_handoff_sift_refonte/token-sync/sync-core.cjs`
- Create: `design_handoff_sift_refonte/token-sync/migrate-to-dtcg.cjs` (one-time,
  kept in the repo afterward as a reference/re-run tool, not deleted)
- Create (via running the migration script): `design_handoff_sift_refonte/token-sync/design-tokens.light.json`,
  `design_handoff_sift_refonte/token-sync/design-tokens.dark.json`
- Modify (via the migration script): `design_handoff_sift_refonte/token-sync/last-sync.json`
- Delete: `design_handoff_sift_refonte/token-sync/design-tokens.json` (after
  migration is verified — Step 6)
- Test: `design_handoff_sift_refonte/token-sync/sync-core.verify.cjs` (uses
  Node's built-in `assert`; this repo has no Jest/Mocha setup — every existing
  script in this directory is verified via plain `node` execution + console
  output, not a test framework, so this follows that same convention)

**Interfaces:**
- Produces (consumed by every later task): `sync-core.cjs` exports
  `{ resolveTheme(light, dark, mode), hexToComponents(hex), loadCanonical(),
  loadAliasMap(), finalizeRun({ targetPath, original, updated, changedKeys,
  write, label }) }`.
- `loadCanonical()` returns `{ light, dark }` (the two raw parsed JSON trees —
  callers call `resolveTheme(light, dark, "dark")` themselves when they need
  the merged view; `loadCanonical` does not pre-merge, so `generate-theme-html.cjs`
  can request both branches independently).

- [ ] **Step 1: Write `sync-core.cjs`**

```js
// sync-core.cjs
// Shared mechanics for the 3 generate-*.cjs scripts: loading the DTCG canonical
// files, merging light+dark for a given mode, and the common compare/log/write
// tail. Each generator keeps its own block-location/replacement logic — this
// file does NOT own "what the output looks like" (see docs/superpowers/specs/
// 2026-07-04-token-sync-tool-v2-design.md Section B for why a generic
// format()-returns-whole-file model was rejected).
const fs = require("fs");
const path = require("path");

const tokenDir = __dirname;
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const aliasPath = path.join(tokenDir, "alias-map.json");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadCanonical() {
  return { light: loadJSON(lightPath), dark: loadJSON(darkPath) };
}

function loadAliasMap() {
  return loadJSON(aliasPath);
}

// Merge rule: dark = light with color.* overridden by whatever dark.json declares.
// Static categories (radius/text/space/height/shadow/font) never appear in
// dark.json, so they pass through from light untouched.
function resolveTheme(light, dark, mode) {
  if (mode === "light") return light;
  if (mode !== "dark") throw new Error(`resolveTheme: mode must be "light" or "dark", got "${mode}"`);
  return {
    ...light,
    color: { ...light.color, ...(dark.color || {}) },
  };
}

function hexToComponents(hex) {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) throw new Error(`hexToComponents: "${hex}" is not a 6-digit hex color`);
  return m.slice(1, 4).map((h) => Math.round((parseInt(h, 16) / 255) * 10000) / 10000);
}

// Common tail for a generator's run(): compare, log, write-if-flag, report.
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

module.exports = { loadCanonical, loadAliasMap, resolveTheme, hexToComponents, finalizeRun };
```

- [ ] **Step 2: Write `sync-core.verify.cjs` and run it**

```js
// sync-core.verify.cjs — plain-assert verification, no test framework in this
// directory (matches every other script here). Run: node sync-core.verify.cjs
const assert = require("assert");
const { resolveTheme, hexToComponents } = require("./sync-core.cjs");

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

console.log("sync-core.verify.cjs: all assertions passed.");
```

Run: `node design_handoff_sift_refonte/token-sync/sync-core.verify.cjs`
Expected: `sync-core.verify.cjs: all assertions passed.` and exit code 0.

- [ ] **Step 3: Write `migrate-to-dtcg.cjs`**

Converts the current `design-tokens.json` (`{colors, static}` shape) into the
2 new DTCG files, plus initializes `last-sync.json` to match (since this
migration IS the new baseline — nothing to pull yet).

```js
// migrate-to-dtcg.cjs — one-time (but kept for reference/re-run) conversion
// from the old {colors, static} design-tokens.json into DTCG-shaped
// design-tokens.light.json / design-tokens.dark.json. Run once: node migrate-to-dtcg.cjs
const fs = require("fs");
const path = require("path");
const { hexToComponents } = require("./sync-core.cjs");

const tokenDir = __dirname;
const oldPath = path.join(tokenDir, "design-tokens.json");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

// --color-background-primary -> color.background-primary ; --border-radius-md -> radius.md
// --shadow-toast -> shadow.toast ; --font-ui -> font.ui ; --text-md -> text.md
// --space-16 -> space.16 ; --h-36 -> height.36
const STATIC_PREFIX_MAP = [
  [/^--border-radius-/, "radius"],
  [/^--shadow-/, "shadow"],
  [/^--font-/, "font"],
  [/^--text-/, "text"],
  [/^--space-/, "space"],
  [/^--h-/, "height"],
];

function colorPath(key) {
  if (!key.startsWith("--color-") && !key.startsWith("--overlay-")) {
    throw new Error(`migrate-to-dtcg: unexpected color key shape "${key}"`);
  }
  return key.replace(/^--(color|overlay)-/, "");
}

function staticGroupAndName(key) {
  for (const [re, group] of STATIC_PREFIX_MAP) {
    if (re.test(key)) return [group, key.replace(re, "")];
  }
  throw new Error(`migrate-to-dtcg: no known static group for key "${key}"`);
}

function colorEntry(hex) {
  return { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(hex), hex } };
}

function dimensionEntry(rawValue) {
  const m = /^(-?[\d.]+)(px|rem)$/.exec(rawValue);
  if (!m) throw new Error(`migrate-to-dtcg: "${rawValue}" is not a "<number><px|rem>" dimension`);
  return { $type: "dimension", $value: { value: Number(m[1]), unit: m[2] } };
}

function run() {
  const old = JSON.parse(fs.readFileSync(oldPath, "utf8"));
  const light = { color: {} };
  const dark = { color: {} };

  for (const [key, { light: lightHex, dark: darkHex }] of Object.entries(old.colors)) {
    const p = colorPath(key);
    light.color[p] = colorEntry(lightHex);
    if (darkHex !== lightHex) dark.color[p] = colorEntry(darkHex);
  }

  for (const [key, rawValue] of Object.entries(old.static)) {
    const [group, name] = staticGroupAndName(key);
    if (!light[group]) light[group] = {};
    if (group === "shadow") {
      light[group][name] = { $type: "shadow", $value: rawValue };
    } else if (group === "font") {
      light[group][name] = { $type: "fontFamily", $value: rawValue };
    } else {
      light[group][name] = dimensionEntry(rawValue);
    }
  }

  fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
  fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log(`Migrated ${Object.keys(old.colors).length} color tokens, ${Object.keys(old.static).length} static tokens.`);
  console.log(`${Object.keys(dark.color).length} colors differ in dark mode (written to design-tokens.dark.json).`);
}

module.exports = { run };
if (require.main === module) run();
```

- [ ] **Step 4: Run the migration**

```bash
node design_handoff_sift_refonte/token-sync/migrate-to-dtcg.cjs
```

Expected output: `Migrated 32 color tokens, 25 static tokens.` followed by
`N colors differ in dark mode (written to design-tokens.dark.json).` where N
is less than 32 (some colors — e.g. `--color-background-danger`,
`--color-accent-identify*` — are identical in both modes today, per the
current `design-tokens.json`, and must NOT appear in `design-tokens.dark.json`).

- [ ] **Step 5: Spot-check the migrated files by hand**

```bash
node -e "console.log(JSON.stringify(require('./design_handoff_sift_refonte/token-sync/design-tokens.light.json').color['background-primary'], null, 2))"
```
Expected: `{"$type":"color","$value":{"colorSpace":"srgb","components":[0.9059,0.8863,0.8588],"hex":"#E7E2DB"}}`

```bash
node -e "console.log('--color-accent-identify' in require('./design_handoff_sift_refonte/token-sync/design-tokens.dark.json').color ? 'BUG: identical color present in dark.json' : 'OK: identical color pruned')"
```
Expected: `OK: identical color pruned` (light and dark hex for
`--color-accent-identify` are both `#FFdc82` today — must not appear in
`design-tokens.dark.json`).

- [ ] **Step 6: Delete the old canonical file and commit**

```bash
git rm design_handoff_sift_refonte/token-sync/design-tokens.json
git add design_handoff_sift_refonte/token-sync/sync-core.cjs \
        design_handoff_sift_refonte/token-sync/sync-core.verify.cjs \
        design_handoff_sift_refonte/token-sync/migrate-to-dtcg.cjs \
        design_handoff_sift_refonte/token-sync/design-tokens.light.json \
        design_handoff_sift_refonte/token-sync/design-tokens.dark.json \
        design_handoff_sift_refonte/token-sync/last-sync.json
git commit -m "feat(token-sync): migrate canonical storage to DTCG-shaped light/dark files"
```

**Note for later tasks:** `design-tokens.json` no longer exists after this
task. Every later task that currently does
`require(path.join(tokenDir, "design-tokens.json"))` must switch to
`sync-core.loadCanonical()` instead — this is called out explicitly in each
task below so no task silently re-reads the deleted file.

---

### Task 2: Migrate `generate-styles-css.cjs` to DTCG source

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/generate-styles-css.cjs`

**Interfaces:**
- Consumes: `sync-core.loadCanonical()`, `sync-core.resolveTheme(light, dark, mode)`,
  `sync-core.finalizeRun(...)`.
- Produces: `run({write}) -> {noOp, changedKeys}` — **unchanged return shape**,
  consumed by `apply-tokens.cjs` and `editor-server.cjs` without modification.

- [ ] **Step 1: Rewrite to read the resolved DTCG values instead of `tokens.colors[key].light/.dark`**

The CSS block-replacement logic (`replaceTokensInBlock`, `replaceFirstBlock`,
the 3 regex blocks) is untouched — only how `lightEntries`/`darkEntries` are
built changes, since the token lookup now goes through DTCG paths instead of
flat `--color-*` keys.

```js
// generate-styles-css.cjs
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { loadCanonical, resolveTheme, finalizeRun } = require("./sync-core.cjs");

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
    ...colorKeys.map((k) => [k, resolvedLight.color[colorPath(k)].$value.hex]),
    ...staticKeys.map((k) => [k, staticLookup(resolvedLight, k)]),
  ];
  const darkEntries = colorKeys.map((k) => [k, resolvedDark.color[colorPath(k)].$value.hex]);

  let text = original;
  const changedKeys = new Set();
  let step;

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
```

- [ ] **Step 2: Verify no-op immediately after Task 1's migration**

```bash
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs
```
Expected: `No-op: styles.css already matches design-tokens.{light,dark}.json for every known token.`
(Task 1's migration was derived FROM the current `styles.css` values, so this
must be a no-op — if it reports changes, the migration or this generator has
a bug. Stop and fix before proceeding.)

- [ ] **Step 3: Prove a real change is detected and written**

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#123456';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs
```
Expected: `Changed: --color-background-primary` then `Dry run only — pass --write to persist.`

```bash
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs --write
grep -- "--color-background-primary" frontend/styles.css
```
Expected the `:root{...}` line shows `--color-background-primary:#123456;`.

- [ ] **Step 4: Revert the test mutation and confirm clean**

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#E7E2DB';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs --write
git status --short frontend/styles.css design_handoff_sift_refonte/token-sync/design-tokens.light.json
```
Expected: no output from `git status --short` (byte-identical to before Step 3).

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/generate-styles-css.cjs
git commit -m "feat(token-sync): migrate generate-styles-css.cjs to DTCG canonical source"
```

---

### Task 3: Migrate `generate-theme-html.cjs` to DTCG source

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/generate-theme-html.cjs`

**Interfaces:**
- Consumes: `sync-core.loadCanonical()`, `sync-core.resolveTheme(light, dark, mode)`.
- Produces: `run({write}) -> {noOp, changedKeys}` (unchanged) and
  `transform(html, resolvedLight, resolvedDark, aliasMap) -> {html, changed, changedKeys}`
  — **signature changes** from `transform(html, tokens, aliasMap)`. This is
  consumed by `editor-server.cjs`'s `/preview.html` route — Task 6 updates
  that call site to match.

- [ ] **Step 1: Rewrite `buildEntries` to read DTCG paths via alias-map, keep the object-literal regex logic untouched**

```js
// generate-theme-html.cjs
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { loadCanonical, loadAliasMap, resolveTheme, finalizeRun } = require("./sync-core.cjs");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");

function buildEntries(resolved, aliasMap) {
  const entries = [];
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const dtcgPath = prodKey.replace(/^--(color|overlay)-/, "");
    const canonical = resolved.color[dtcgPath];
    if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from resolved DTCG tokens`);
    entries.push([legacyKey, canonical.$value.hex]);
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
```

- [ ] **Step 2: Verify no-op immediately**

```bash
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs
```
Expected: `No-op: Sift.dc.html theme() already matches design-tokens.{light,dark}.json for every mapped key.`

- [ ] **Step 3: Prove a real change round-trips (mutate, detect, write, revert)**

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#123456';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs
```
Expected: `Changed: canvas` (canvas is the legacy alias for `--color-background-primary`
per `alias-map.json`), then `Dry run only...`.

```bash
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs --write
grep "canvas:'#123456'" design_handoff_sift_refonte/Sift.dc.html
```
Expected: one match.

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#E7E2DB';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs --write
git status --short design_handoff_sift_refonte/Sift.dc.html design_handoff_sift_refonte/token-sync/design-tokens.light.json
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/generate-theme-html.cjs
git commit -m "feat(token-sync): migrate generate-theme-html.cjs to DTCG canonical source"
```

---

### Task 4: Migrate `generate-design-md.cjs` to DTCG source

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/generate-design-md.cjs`

**Interfaces:**
- Consumes: `sync-core.loadCanonical()`, `sync-core.resolveTheme(light, dark, mode)`.
- Produces: `run({write}) -> {noOp, changedKeys}` (unchanged).

**Only `prodValue` changes** — the bullet-matching, drift-count check
(`countBulletLines`, `expectedLightCount`/`expectedDarkCount`), and
`lightBullets`/`darkBullets` tables are untouched (they're about DESIGN.md's
prose structure, orthogonal to where the underlying value is stored).

- [ ] **Step 1: Rewrite `prodValue`, thread resolved trees through `run()`**

```js
// generate-design-md.cjs — only the token-lookup and run() wiring change.
// Replace the top of the file:
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { loadCanonical, loadAliasMap, resolveTheme, finalizeRun } = require("./sync-core.cjs");

const tokenDir = __dirname;
const mdPath = path.join(tokenDir, "..", "DESIGN.md");

function prodValue(resolved, aliasMap, legacyKey) {
  const prodKey = aliasMap[legacyKey];
  if (prodKey === null) return null;
  const dtcgPath = prodKey.replace(/^--(color|overlay)-/, "");
  const canonical = resolved.color[dtcgPath];
  if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from resolved DTCG tokens`);
  return canonical.$value.hex;
}

// lightBullets, darkBullets: UNCHANGED, keep exactly as they are today.

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

// countBulletLines: UNCHANGED.

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

  const expectedLightCount = lightBullets.length + 1;
  const expectedDarkCount = darkBullets.length + 1 + 2;
  const actualLightCount = countBulletLines(lightSection);
  const actualDarkCount = countBulletLines(restFromDark);
  if (actualLightCount !== expectedLightCount) {
    throw new Error(
      `DESIGN.md's light section has ${actualLightCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's lightBullets list only knows about ${expectedLightCount}. Update lightBullets.`
    );
  }
  if (actualDarkCount !== expectedDarkCount) {
    throw new Error(
      `DESIGN.md's dark section has ${actualDarkCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's darkBullets list only knows about ${expectedDarkCount}. Update darkBullets.`
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
```

- [ ] **Step 2: Verify no-op immediately**

```bash
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs
```
Expected: `No-op: DESIGN.md bullets already match design-tokens.{light,dark}.json for every present bullet.`

- [ ] **Step 3: Prove a real change round-trips**

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#123456';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs --write
grep "Canvas : \`#123456\`" design_handoff_sift_refonte/DESIGN.md
```
Expected: one match.

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/token-sync/design-tokens.light.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.color['background-primary'].\$value.hex = '#E7E2DB';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs --write
git status --short design_handoff_sift_refonte/DESIGN.md design_handoff_sift_refonte/token-sync/design-tokens.light.json
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/generate-design-md.cjs
git commit -m "feat(token-sync): migrate generate-design-md.cjs to DTCG canonical source"
```

---

### Task 5: Migrate `pull-styles-css.cjs` and `pull-theme-html.cjs` to the 2-file structure + pruning

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/pull-styles-css.cjs`
- Modify: `design_handoff_sift_refonte/token-sync/pull-theme-html.cjs`

**Interfaces:**
- Consumes: `sync-core.loadCanonical()`, `sync-core.hexToComponents()`.
- `last-sync.json` shape is now `{light: {...}, dark: {...}}` (set by Task 1's
  migration) — both scripts read/write both halves.
- **Pruning rule applies here**: if a pulled value makes `dark.json`'s entry
  equal `light.json`'s, delete that key from the in-memory `dark` tree before
  writing (do not write an entry that duplicates light).

- [ ] **Step 1: Rewrite `pull-styles-css.cjs`**

```js
// pull-styles-css.cjs
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");
const { hexToComponents } = require("./sync-core.cjs");

const tokenDir = __dirname;
const stylesPath = path.join(tokenDir, "..", "..", "frontend", "styles.css");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const GROUP_TO_PREFIX = { radius: "--border-radius-", shadow: "--shadow-", font: "--font-", text: "--text-", space: "--space-", height: "--h-" };

const light = JSON.parse(fs.readFileSync(lightPath, "utf8"));
const dark = JSON.parse(fs.readFileSync(darkPath, "utf8"));
const css = fs.readFileSync(stylesPath, "utf8");

function extractBlockValues(blockText, keys) {
  const values = {};
  for (const key of keys) {
    const re = new RegExp(`${escapeRegex(key)}:([^;]+);`);
    const m = blockText.match(re);
    if (!m) throw new Error(`Token ${key} not found while reading styles.css — refusing to guess.`);
    values[key] = m[1];
  }
  return values;
}

function colorProdKey(dtcgPath) {
  const prefix = (dtcgPath.startsWith("hover") || dtcgPath.startsWith("selected") || dtcgPath.startsWith("bar") || dtcgPath.startsWith("badge")) ? "--overlay-" : "--color-";
  return `${prefix}${dtcgPath}`;
}
function staticEntries(tree) {
  const out = [];
  for (const [group, entries] of Object.entries(tree)) {
    if (group === "color") continue;
    for (const name of Object.keys(entries)) out.push([`${GROUP_TO_PREFIX[group]}${name}`, group, name]);
  }
  return out;
}

const colorPaths = Object.keys(light.color);
const colorProdKeys = colorPaths.map(colorProdKey);
const staticKeys = staticEntries(light); // [prodKey, group, name][]

const lightBlockMatch = css.match(/:root\{[\s\S]*?\r?\n\}/);
if (!lightBlockMatch) throw new Error("Could not locate light :root block in styles.css");
const mediaBlockMatch = css.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\r?\n  \}\r?\n\}/);
if (!mediaBlockMatch) throw new Error("Could not locate dark @media block in styles.css");
const dataThemeBlockMatch = css.match(/:root\[data-theme="dark"\]\{[\s\S]*?\r?\n\}/);
if (!dataThemeBlockMatch) throw new Error("Could not locate dark [data-theme] block in styles.css");

const cssLight = extractBlockValues(lightBlockMatch[0], [...colorProdKeys, ...staticKeys.map(([k]) => k)]);
const cssDarkMedia = extractBlockValues(mediaBlockMatch[0], colorProdKeys);
const cssDarkDataTheme = extractBlockValues(dataThemeBlockMatch[0], colorProdKeys);

for (const key of colorProdKeys) {
  if (cssDarkMedia[key] !== cssDarkDataTheme[key]) {
    throw new Error(
      `styles.css itself is inconsistent: ${key} = "${cssDarkMedia[key]}" in @media block but ` +
      `"${cssDarkDataTheme[key]}" in [data-theme="dark"] block. Fix styles.css by hand before pulling.`
    );
  }
}
const cssDark = cssDarkMedia;

function currentValue(tree, group, name, field) {
  const entry = tree[group] && tree[group][name];
  if (!entry) return undefined;
  if (field === "hex") return entry.$value.hex;
  return entry.$type === "dimension" ? `${entry.$value.value}${entry.$value.unit}` : entry.$value;
}

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  const colorsInSync = colorPaths.every((p) => {
    const prodKey = colorProdKey(p);
    const darkHex = currentValue(dark, "color", p, "hex") ?? currentValue(light, "color", p, "hex");
    return cssLight[prodKey] === currentValue(light, "color", p, "hex") && cssDark[prodKey] === darkHex;
  });
  const staticInSync = staticKeys.every(([prodKey, group, name]) => cssLight[prodKey] === currentValue(light, group, name));
  if (!colorsInSync || !staticInSync) {
    throw new Error(
      "No last-sync.json baseline found, and styles.css does not currently match design-tokens.{light,dark}.json. " +
      "Reconcile by hand once before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log("No baseline existed yet. styles.css already matches canonical — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const p of colorPaths) {
  const prodKey = colorProdKey(p);
  for (const mode of ["light", "dark"]) {
    const cssValue = mode === "light" ? cssLight[prodKey] : cssDark[prodKey];
    const tree = mode === "light" ? light : dark;
    const baselineTree = mode === "light" ? baseline.light : baseline.dark;
    const canonicalValue = currentValue(tree, "color", p, "hex") ?? (mode === "dark" ? currentValue(light, "color", p, "hex") : undefined);
    const baselineValue = currentValue(baselineTree, "color", p, "hex") ?? (mode === "dark" ? currentValue(baseline.light, "color", p, "hex") : undefined);
    if (cssValue === canonicalValue) continue;
    if (canonicalValue === baselineValue) {
      pulls.push({ scope: "color", path: p, mode, from: canonicalValue, to: cssValue });
    } else {
      conflicts.push({ key: `${prodKey} (${mode})`, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
    }
  }
}
for (const [prodKey, group, name] of staticKeys) {
  const cssValue = cssLight[prodKey];
  const canonicalValue = currentValue(light, group, name);
  const baselineValue = currentValue(baseline.light, group, name);
  if (cssValue === canonicalValue) continue;
  if (canonicalValue === baselineValue) {
    pulls.push({ scope: "static", group, name, from: canonicalValue, to: cssValue });
  } else {
    conflicts.push({ key: prodKey, canonical: canonicalValue, css: cssValue, baseline: baselineValue });
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both styles.css and canonical changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) console.error(`  ${c.key}: baseline="${c.baseline}" canonical(now)="${c.canonical}" styles.css(now)="${c.css}"`);
  console.error("\nResolve by hand (edit design-tokens.light.json/.dark.json), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: styles.css matches canonical for every token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from styles.css into canonical:\n`);
for (const p of pulls) {
  const label = p.mode ? `${p.path} (${p.mode})` : `${p.group}.${p.name}`;
  console.log(`  ${label}: "${p.from}" -> "${p.to}"`);
}

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these.");
  process.exit(0);
}

for (const p of pulls) {
  if (p.scope === "color" && p.mode === "light") {
    light.color[p.path] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(p.to), hex: p.to } };
  } else if (p.scope === "color" && p.mode === "dark") {
    if (!dark.color) dark.color = {};
    dark.color[p.path] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(p.to), hex: p.to } };
  } else {
    light[p.group][p.name].$value = light[p.group][p.name].$type === "dimension"
      ? { value: parseFloat(p.to), unit: p.to.replace(/[\d.]+/, "") }
      : p.to;
  }
}

// Pruning: drop any dark.color entry that now equals its light counterpart.
for (const key of Object.keys(dark.color || {})) {
  if (dark.color[key].$value.hex === light.color[key].$value.hex) delete dark.color[key];
}

fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
console.log("\nWritten to design-tokens.{light,dark}.json, baseline updated.");
```

- [ ] **Step 2: Rewrite `pull-theme-html.cjs`**

```js
// pull-theme-html.cjs
const fs = require("fs");
const path = require("path");
const { hexToComponents } = require("./sync-core.cjs");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
const aliasPath = path.join(tokenDir, "alias-map.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const light = JSON.parse(fs.readFileSync(lightPath, "utf8"));
const dark = JSON.parse(fs.readFileSync(darkPath, "utf8"));
const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
const html = fs.readFileSync(htmlPath, "utf8");

function extractThemeBranch(regex, label) {
  const m = html.match(regex);
  if (!m) throw new Error(`Could not locate ${label} branch of theme() in Sift.dc.html`);
  const pairs = {};
  for (const [, key, value] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) pairs[key] = value;
  return pairs;
}

const darkTheme = extractThemeBranch(/isDark\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/, "dark");
const lightTheme = extractThemeBranch(/\}\s*:\s*\{([\s\S]*?)\}\s*;\s*\n\s*\}/, "light");

function currentHex(tree, dtcgPath) {
  const entry = tree.color[dtcgPath];
  return entry ? entry.$value.hex : undefined;
}

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  let alreadyInSync = true;
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const p = prodKey.replace(/^--(color|overlay)-/, "");
    const lightHex = currentHex(light, p);
    const darkHex = currentHex(dark, p) ?? lightHex;
    if (!lightHex) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.light.json`);
    if (lightTheme[legacyKey] !== lightHex || darkTheme[legacyKey] !== darkHex) { alreadyInSync = false; break; }
  }
  if (!alreadyInSync) {
    throw new Error(
      "No last-sync.json baseline found, and Sift.dc.html does not currently match canonical. " +
      "Reconcile by hand once before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
  console.log("No baseline existed yet. Sift.dc.html already matches canonical — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) continue; // e.g. "disabled" — no production equivalent
  const p = prodKey.replace(/^--(color|overlay)-/, "");
  if (!light.color[p]) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.light.json`);

  for (const mode of ["light", "dark"]) {
    const htmlValue = mode === "light" ? lightTheme[legacyKey] : darkTheme[legacyKey];
    const tree = mode === "light" ? light : dark;
    const baselineTree = mode === "light" ? baseline.light : baseline.dark;
    const canonicalValue = currentHex(tree, p) ?? (mode === "dark" ? currentHex(light, p) : undefined);
    const baselineValue = currentHex(baselineTree, p) ?? (mode === "dark" ? currentHex(baseline.light, p) : undefined);
    if (htmlValue === canonicalValue) continue;
    if (canonicalValue === baselineValue) {
      pulls.push({ prodKey, legacyKey, mode, path: p, from: canonicalValue, to: htmlValue });
    } else {
      conflicts.push({ prodKey, legacyKey, mode, canonical: canonicalValue, html: htmlValue, baseline: baselineValue });
    }
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both Sift.dc.html and canonical changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) console.error(`  ${c.prodKey} (${c.mode}): baseline="${c.baseline}" canonical(now)="${c.canonical}" Sift.dc.html(now)="${c.html}"`);
  console.error("\nResolve by hand (edit design-tokens.light.json/.dark.json), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: Sift.dc.html matches canonical for every mapped token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from Sift.dc.html into canonical:\n`);
for (const p of pulls) console.log(`  ${p.prodKey} (${p.mode}) [legacy: ${p.legacyKey}]: "${p.from}" -> "${p.to}"`);

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these.");
  process.exit(0);
}

for (const p of pulls) {
  const entry = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(p.to), hex: p.to } };
  if (p.mode === "light") light.color[p.path] = entry;
  else { if (!dark.color) dark.color = {}; dark.color[p.path] = entry; }
}

// Pruning: drop any dark.color entry that now equals its light counterpart.
for (const key of Object.keys(dark.color || {})) {
  if (dark.color[key].$value.hex === light.color[key].$value.hex) delete dark.color[key];
}

fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify({ light, dark }, null, 2), "utf8");
console.log("\nWritten to design-tokens.{light,dark}.json, baseline updated.");
```

- [ ] **Step 3: Verify both pull scripts report clean immediately after Tasks 2–4**

```bash
node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
```
Expected: `Nothing to pull: styles.css matches canonical for every token.` and
`Nothing to pull: Sift.dc.html matches canonical for every mapped token.`

- [ ] **Step 4: Prove a real pull + pruning round-trip**

```bash
# Hand-edit styles.css: change a color that's IDENTICAL in light/dark today
# (--color-accent-identify, both #FFdc82) to a NEW value in the dark block only.
node -e "
const fs = require('fs');
let css = fs.readFileSync('frontend/styles.css', 'utf8');
css = css.replace(/(:root\[data-theme=\"dark\"\]\{[\s\S]*?)--color-accent-identify:#FFdc82;/, '\$1--color-accent-identify:#AA00FF;');
fs.writeFileSync('frontend/styles.css', css, 'utf8');
"
node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs --write
node -e "console.log('--color-accent-identify' in require('./design_handoff_sift_refonte/token-sync/design-tokens.dark.json').color ? 'OK: new divergent override present' : 'BUG: pull did not add the override')"
```
Expected: `OK: new divergent override present`.

```bash
# Revert dark back to match light — pruning must remove the now-redundant entry.
node -e "
const fs = require('fs');
let css = fs.readFileSync('frontend/styles.css', 'utf8');
css = css.replace(/(:root\[data-theme=\"dark\"\]\{[\s\S]*?)--color-accent-identify:#AA00FF;/, '\$1--color-accent-identify:#FFdc82;');
fs.writeFileSync('frontend/styles.css', css, 'utf8');
"
node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs --write
node -e "console.log('--color-accent-identify' in require('./design_handoff_sift_refonte/token-sync/design-tokens.dark.json').color ? 'BUG: pruning did not remove convergent override' : 'OK: pruned')"
git status --short frontend/styles.css design_handoff_sift_refonte/token-sync/design-tokens.dark.json design_handoff_sift_refonte/token-sync/last-sync.json
```
Expected: `OK: pruned`, and `git status --short` shows no diff (byte-identical
to the pre-Step-4 state).

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/pull-styles-css.cjs design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
git commit -m "feat(token-sync): migrate pull scripts to DTCG 2-file structure + dark.json pruning"
```

---

### Task 6: `editor-server.cjs` conversion layer

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/editor-server.cjs`

**Interfaces:**
- Consumes: `sync-core.loadCanonical()`, `sync-core.resolveTheme()`,
  `sync-core.hexToComponents()`, `sync-core.loadAliasMap()`.
- **Wire contract with `editor.html` is unchanged**: `/tokens.json` still
  returns `{colors: {key: {light, dark}}, static: {key: value}}` (hex
  strings), `/validate` and `/preview-tokens` still accept that same shape.
  `validateTokensShape()` is **not modified** in this task.

- [ ] **Step 1: Add conversion helpers, replace the single-file reads**

```js
// editor-server.cjs — changes only: imports, the 2 new conversion functions,
// and the 4 route handlers that touched design-tokens.json directly.
// Everything else (send/sendJson/readBody/validateTokensShape/server routing
// structure) is unchanged.

// Replace the top-of-file requires/paths:
const { loadCanonical, resolveTheme, hexToComponents } = require("./sync-core.cjs");
const lightPath = path.join(tokenDir, "design-tokens.light.json");
const darkPath = path.join(tokenDir, "design-tokens.dark.json");
// (remove: const tokensPath = path.join(tokenDir, "design-tokens.json");)

const GROUP_TO_PREFIX = { radius: "--border-radius-", shadow: "--shadow-", font: "--font-", text: "--text-", space: "--space-", height: "--h-" };
function colorProdKey(dtcgPath) {
  const prefix = (dtcgPath.startsWith("hover") || dtcgPath.startsWith("selected") || dtcgPath.startsWith("bar") || dtcgPath.startsWith("badge")) ? "--overlay-" : "--color-";
  return `${prefix}${dtcgPath}`;
}

// DTCG (2 files) -> the simple {colors, static} shape editor.html has always used.
function toClientShape() {
  const { light, dark } = loadCanonical();
  const resolvedDark = resolveTheme(light, dark, "dark");
  const colors = {};
  for (const [p, entry] of Object.entries(light.color)) {
    colors[colorProdKey(p)] = { light: entry.$value.hex, dark: resolvedDark.color[p].$value.hex };
  }
  const static_ = {};
  for (const [group, entries] of Object.entries(light)) {
    if (group === "color") continue;
    for (const [name, entry] of Object.entries(entries)) {
      const value = entry.$type === "dimension" ? `${entry.$value.value}${entry.$value.unit}` : entry.$value;
      static_[`${GROUP_TO_PREFIX[group]}${name}`] = value;
    }
  }
  return { colors, static: static_ };
}

// The simple {colors, static} shape (from the browser) -> writes both DTCG
// files, applying the hex-is-authoritative rule and the dark.json pruning rule.
function fromClientShape(clientTokens) {
  const { light, dark } = loadCanonical(); // preserves $type and any fields we don't touch
  for (const [prodKey, { light: lightHex, dark: darkHex }] of Object.entries(clientTokens.colors)) {
    const p = prodKey.replace(/^--(color|overlay)-/, "");
    light.color[p] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(lightHex), hex: lightHex } };
    if (darkHex === lightHex) {
      delete dark.color[p]; // pruning: no longer diverges, don't keep a redundant override
    } else {
      dark.color[p] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(darkHex), hex: darkHex } };
    }
  }
  for (const [prodKey, value] of Object.entries(clientTokens.static)) {
    for (const [group, prefix] of Object.entries(GROUP_TO_PREFIX)) {
      if (prodKey.startsWith(prefix)) {
        const name = prodKey.slice(prefix.length);
        const isDimension = light[group][name].$type === "dimension";
        light[group][name].$value = isDimension ? { value: parseFloat(value), unit: value.replace(/[\d.]+/, "") } : value;
        break;
      }
    }
  }
  fs.writeFileSync(lightPath, JSON.stringify(light, null, 2), "utf8");
  fs.writeFileSync(darkPath, JSON.stringify(dark, null, 2), "utf8");
}
```

- [ ] **Step 2: Update the 4 route handlers**

```js
// GET /tokens.json — was: send(res, 200, fs.readFileSync(tokensPath, "utf8"), "application/json");
if (req.method === "GET" && url.pathname === "/tokens.json") {
  sendJson(res, 200, toClientShape());
  return;
}

// POST /preview-tokens — was: pendingTokens = parsed (unchanged: still stores the
// simple client shape in memory; only /preview.html's consumption of it changes below).
if (req.method === "POST" && url.pathname === "/preview-tokens") {
  const body = await readBody(req);
  const parsed = JSON.parse(body);
  validateTokensShape(parsed);
  pendingTokens = parsed;
  return sendJson(res, 200, { ok: true });
}

// GET /preview.html — was: reading tokensPath + aliasPath directly, calling the
// old 3-arg transform(). Now builds resolved DTCG trees from either pendingTokens
// (converted) or the real canonical files, and calls the new 4-arg transform().
if (req.method === "GET" && url.pathname === "/preview.html") {
  const aliasMap = loadAliasMap();
  const mockup = fs.readFileSync(mockupHtmlPath, "utf8");
  let resolvedLight, resolvedDark;
  if (pendingTokens) {
    // Build ephemeral DTCG trees from the in-memory client-shape edits, without
    // touching disk (matches the existing "never writes to disk" preview contract).
    const { light, dark } = loadCanonical();
    for (const [prodKey, { light: lightHex, dark: darkHex }] of Object.entries(pendingTokens.colors)) {
      const p = prodKey.replace(/^--(color|overlay)-/, "");
      light.color[p] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(lightHex), hex: lightHex } };
      if (darkHex === lightHex) delete dark.color[p];
      else dark.color[p] = { $type: "color", $value: { colorSpace: "srgb", components: hexToComponents(darkHex), hex: darkHex } };
    }
    resolvedLight = resolveTheme(light, dark, "light");
    resolvedDark = resolveTheme(light, dark, "dark");
  } else {
    const { light, dark } = loadCanonical();
    resolvedLight = resolveTheme(light, dark, "light");
    resolvedDark = resolveTheme(light, dark, "dark");
  }
  const { html } = generateThemeHtml.transform(mockup, resolvedLight, resolvedDark, aliasMap);
  send(res, 200, html, "text/html");
  return;
}

// POST /validate — was: fs.writeFileSync(tokensPath, ...) directly with the
// browser's raw body. Now converts through fromClientShape() first.
if (req.method === "POST" && url.pathname === "/validate") {
  const body = await readBody(req);
  const edited = JSON.parse(body);
  validateTokensShape(edited);
  fromClientShape(edited);

  const results = {
    stylesCss: generateStylesCss.run({ write: true }),
    themeHtml: generateThemeHtml.run({ write: true }),
    designMd: generateDesignMd.run({ write: true }),
  };

  const allChanged = new Set([...results.stylesCss.changedKeys, ...results.themeHtml.changedKeys]);
  const consumers = {};
  for (const key of allChanged) consumers[key] = locate(key).slice(0, 5);

  return sendJson(res, 200, { results, consumers });
}
```

- [ ] **Step 3: Restart the server and verify the wire contract is unchanged**

```bash
node design_handoff_sift_refonte/token-sync/editor-server.cjs &
sleep 1
curl -s http://localhost:4756/tokens.json | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const t = JSON.parse(d);
  console.log(t.colors['--color-background-primary']);
  console.log(t.static['--border-radius-md']);
});
"
kill %1
```
Expected: `{ light: '#E7E2DB', dark: '#282825' }` and `6px` — same shape and
values `editor.html` has always received.

- [ ] **Step 4: Full end-to-end test through the real HTTP API (mutate via /validate, verify, revert)**

```bash
node design_handoff_sift_refonte/token-sync/editor-server.cjs &
sleep 1
curl -s http://localhost:4756/tokens.json -o /tmp/before-tokens.json
node -e "
const t = require('/tmp/before-tokens.json');
t.colors['--color-background-primary'].light = '#123456';
require('fs').writeFileSync('/tmp/edited-tokens.json', JSON.stringify(t));
"
curl -s -X POST -H "Content-Type: application/json" -d @/tmp/edited-tokens.json http://localhost:4756/validate
grep -- "--color-background-primary:#123456" frontend/styles.css
```
Expected: the curl response shows `stylesCss`/`themeHtml`/`designMd` all with
`noOp: false` and a `--color-background-primary` entry, and the grep finds
the new value in `frontend/styles.css`.

```bash
curl -s -X POST -H "Content-Type: application/json" -d @/tmp/before-tokens.json http://localhost:4756/validate
kill %1
git status --short frontend/styles.css design_handoff_sift_refonte/Sift.dc.html design_handoff_sift_refonte/DESIGN.md design_handoff_sift_refonte/token-sync/design-tokens.light.json design_handoff_sift_refonte/token-sync/design-tokens.dark.json
```
Expected: no output — reverted cleanly through the same `/validate` path a
real browser session would use.

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/editor-server.cjs
git commit -m "feat(token-sync): editor-server.cjs converts DTCG storage at the wire boundary"
```

---

### Task 7: Sidebar + search navigation in `editor.html` (Section D)

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/editor.html`

**Interfaces:**
- Consumes: the existing `COLOR_GROUPS`/`STATIC_GROUPS` arrays (unchanged
  shape) and the existing `tokens` client-side object (unchanged shape — this
  task is pure navigation, no data-shape change per Task 6's boundary design).
- No change to `/validate`, `/tokens.json` consumption, or `makeModeSlot`'s
  widget logic.

- [ ] **Step 1: Replace the CSS layout — add a sidebar column, keep `#form-col` as the token-detail panel**

```css
/* Replace: #form-col { width: 480px; ... } */
#sidebar { width: 220px; flex: none; overflow-y: auto; background: #fff; border-right: 1px solid #e3ddd3; padding: 12px 10px; }
#sidebar-search { width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: 12.5px; border: 1px solid #ddd5c8; border-radius: 7px; margin-bottom: 10px; }
.sidebar-group { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; padding: 8px 10px; border: none; background: none; border-radius: 7px; cursor: pointer; font-size: 12.5px; color: #34302B; }
.sidebar-group:hover { background: #f3efe9; }
.sidebar-group.on { background: #3A352F; color: #F7F4EF; }
.sidebar-group .count { font-size: 10.5px; color: #6b6459; }
.sidebar-group.on .count { color: #cfc9bd; }
#form-col { width: 480px; flex: none; overflow-y: auto; padding: 16px 20px; background: #fff; border-right: 1px solid #e3ddd3; }
```

Keep `details.group`/`.group-body`/`.token-row`/`.static-row`/`.mode-*` CSS
rules exactly as-is — Step 3 reuses them, just no longer inside a `<details>`.

- [ ] **Step 2: Replace the `#form-col` markup to add the sidebar**

```html
<!-- Replace the <div id="form-col">...</div> opening structure in <main>: -->
<div id="sidebar">
  <input id="sidebar-search" type="text" placeholder="Chercher un token…" aria-label="Chercher un token">
  <div id="sidebar-groups"></div>
</div>
<div id="form-col">
  <div id="groups"></div>
  <button id="validate-btn">✓ Appliquer partout dans Sift</button>
  <div id="report"></div>
</div>
```

- [ ] **Step 3: Rewrite `renderColorGroups` to render one group at a time (sidebar-driven) plus a search-results view**

```js
// Replace renderColorGroups() and the groups-array iteration entirely.
const ALL_GROUPS = [
  ...COLOR_GROUPS.map(([title, hint, entries]) => ({ title, hint, entries, kind: "color" })),
  ...STATIC_GROUPS.map(([title, entries]) => ({ title, hint: "", entries, kind: "static" })),
];

let activeGroupTitle = ALL_GROUPS[0].title;

function renderSidebar() {
  const container = document.getElementById("sidebar-groups");
  container.innerHTML = "";
  for (const g of ALL_GROUPS) {
    const btn = document.createElement("button");
    btn.className = "sidebar-group" + (g.title === activeGroupTitle ? " on" : "");
    btn.innerHTML = `<span>${escapeHtml(g.title)}</span><span class="count">${g.entries.length}</span>`;
    btn.addEventListener("click", () => {
      activeGroupTitle = g.title;
      document.getElementById("sidebar-search").value = "";
      renderSidebar();
      renderGroupPanel(g);
    });
    container.appendChild(btn);
  }
}

function renderGroupPanel(group) {
  const container = document.getElementById("groups");
  container.innerHTML = "";
  const heading = document.createElement("div");
  heading.style.cssText = "font-size:14px;font-weight:700;margin-bottom:10px";
  heading.textContent = group.title;
  container.appendChild(heading);

  const body = document.createElement("div");
  if (group.kind === "color") {
    for (const [key, label] of group.entries) body.appendChild(renderColorRow(key, label));
  } else {
    for (const [key, label] of group.entries) body.appendChild(renderStaticRow(key, label));
  }
  container.appendChild(body);
}

function renderColorRow(key, label) {
  const row = document.createElement("div");
  row.className = "token-row";
  const rowLabel = document.createElement("div");
  rowLabel.className = "token-label";
  rowLabel.textContent = label;
  const rowName = document.createElement("div");
  rowName.className = "token-name";
  rowName.textContent = key;
  const pair = document.createElement("div");
  pair.className = "mode-pair";
  pair.append(makeModeSlot(key, label, "light"), makeModeSlot(key, label, "dark"));
  row.append(rowLabel, rowName, pair);
  return row;
}

function renderStaticRow(key, label) {
  const row = document.createElement("div");
  row.className = "static-row";
  const rowLabel = document.createElement("div");
  rowLabel.className = "token-label";
  rowLabel.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = tokens.static[key];
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => {
    tokens.static[key] = input.value;
    refreshPreview();
  });
  row.append(rowLabel, input);
  return row;
}

// Search: filters across ALL groups by key or French label, replaces the group panel with a flat results list.
function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  const container = document.getElementById("groups");
  container.innerHTML = "";
  const heading = document.createElement("div");
  heading.style.cssText = "font-size:14px;font-weight:700;margin-bottom:10px";
  heading.textContent = `Résultats pour « ${query} »`;
  container.appendChild(heading);

  let count = 0;
  for (const g of ALL_GROUPS) {
    for (const [key, label] of g.entries) {
      if (!key.toLowerCase().includes(q) && !label.toLowerCase().includes(q)) continue;
      count++;
      container.appendChild(g.kind === "color" ? renderColorRow(key, label) : renderStaticRow(key, label));
    }
  }
  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "Aucun token ne correspond.";
    container.appendChild(empty);
  }
}

document.getElementById("sidebar-search").addEventListener("input", (e) => {
  const q = e.target.value;
  if (q.trim() === "") {
    renderGroupPanel(ALL_GROUPS.find((g) => g.title === activeGroupTitle));
  } else {
    renderSearchResults(q);
  }
});
```

- [ ] **Step 4: Replace the bootstrap call at the bottom of the script**

```js
// Replace:  renderColorGroups();
// with:
renderSidebar();
renderGroupPanel(ALL_GROUPS[0]);
```

- [ ] **Step 5: Start the server, verify in a real browser**

```bash
node design_handoff_sift_refonte/token-sync/editor-server.cjs
```
Open `http://localhost:4756/`, confirm: sidebar shows all 12 group names each
with a token count, clicking a group swaps the main panel to just that
group's tokens, typing in the search box filters across all groups, clearing
the search box returns to the previously active group. Click a color picker
in a search result and confirm the quick preview updates (proves
`makeModeSlot`'s existing behavior survived the refactor unchanged).

- [ ] **Step 6: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/editor.html
git commit -m "feat(token-sync): sidebar + search navigation in editor.html, replacing stacked accordions"
```

---

### Task 8: Debounced auto-refresh for the full-mockup preview (Section C)

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/editor.html`

**Interfaces:**
- Consumes: the existing `refreshMockup()` function and `tabFull`/`tabQuick`
  click handlers (Task 7 does not touch these — they're outside `#form-col`/`#sidebar`).

- [ ] **Step 1: Track whether the mockup tab is active, add a debounced trigger**

```js
// Add near the top, alongside `let tokens = null;`:
let mockupTabActive = false;
let refreshMockupTimer = null;

function scheduleMockupRefresh() {
  if (!mockupTabActive) return; // don't refresh (or pay the network cost) for an invisible iframe
  clearTimeout(refreshMockupTimer);
  refreshMockupTimer = setTimeout(refreshMockup, 500);
}
```

- [ ] **Step 2: Call `scheduleMockupRefresh()` from every place that mutates `tokens`**

`makeModeSlot`'s `apply()` function and its two listeners, plus the static
`input` listener in `renderStaticRow`, each already call `refreshPreview()`
(the quick-preview CSS override) — add `scheduleMockupRefresh();` immediately
after each existing `refreshPreview();` call (3 call sites: `apply()` inside
`makeModeSlot`, the `text.addEventListener("input", ...)` inside
`makeModeSlot`, and the static row's `input.addEventListener("input", ...)`).

- [ ] **Step 3: Set `mockupTabActive` in the existing tab-switch handlers, force an immediate refresh on tab-in**

```js
// Replace the existing tabFull/tabQuick listeners:
tabQuick.addEventListener("click", () => {
  tabQuick.classList.add("on");
  tabFull.classList.remove("on");
  quickPreview.style.display = "";
  fullPreview.style.display = "none";
  mockupTabActive = false;
});
tabFull.addEventListener("click", () => {
  tabFull.classList.add("on");
  tabQuick.classList.remove("on");
  fullPreview.style.display = "";
  quickPreview.style.display = "none";
  mockupTabActive = true;
  refreshMockup(); // force immediate refresh on tab-in, don't wait for the next edit
});
```

- [ ] **Step 4: Update the manual button's label/hint text to reflect it's now a fallback, not the only way**

```html
<!-- Replace the #refresh-mockup-btn hint paragraph: -->
<span style="font-size:11.5px;color:#6b6459">
  C'est la vraie maquette Sift.dc.html — se met à jour automatiquement (~0.5s
  après ta dernière modif) tant que cet onglet est ouvert. Navigue entre les
  écrans, teste le mode Lot, ouvre le popover Destination. Fais défiler si ta
  fenêtre est plus étroite que la maquette (conçue pour 1440×900).
</span>
```

The button itself (`id="refresh-mockup-btn"`) and its click listener stay —
it remains a manual force-refresh fallback per the spec.

- [ ] **Step 5: Verify debounce + visibility behavior in a real browser**

```bash
node design_handoff_sift_refonte/token-sync/editor-server.cjs
```
Open `http://localhost:4756/`, switch to "Maquette complète" (confirm it
loads immediately, no manual click needed), switch back to "Aperçu rapide",
edit a color (confirm no network request fires — check the browser's network
tab), switch back to "Maquette complète" (confirm it refreshes immediately to
reflect the edit made while it was hidden). Then, with the mockup tab active,
edit a color picker and confirm the iframe reloads roughly half a second
after you stop dragging (not on every intermediate drag event).

- [ ] **Step 6: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/editor.html
git commit -m "feat(token-sync): debounced auto-refresh for the full-mockup preview"
```

---

## Post-plan verification (all tasks)

- [ ] Run the full sync chain and confirm everything is clean:

```bash
node design_handoff_sift_refonte/token-sync/sync-core.verify.cjs
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs
node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
node design_handoff_sift_refonte/token-sync/apply-tokens.cjs
git status --short frontend/styles.css design_handoff_sift_refonte/Sift.dc.html design_handoff_sift_refonte/DESIGN.md design_handoff_sift_refonte/token-sync/
```

Expected: every script reports no-op/nothing-to-pull, `apply-tokens.cjs`
prints `✓` for all 3 targets, and `git status --short` shows no uncommitted
diffs.

- [ ] Confirm `design-tokens.json` (the old canonical file) no longer exists
  and nothing still references it:

```bash
grep -rn "design-tokens.json" design_handoff_sift_refonte/token-sync/*.cjs
```
Expected: no matches (every reference should now say
`design-tokens.light.json`/`.dark.json` or go through `sync-core.loadCanonical()`).
