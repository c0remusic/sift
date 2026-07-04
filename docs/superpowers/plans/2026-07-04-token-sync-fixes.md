# Token-Sync Tool Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 findings from the code audit (2 parallel agents) and UI audit (`/impeccable audit`) run on `design_handoff_sift_refonte/token-sync/`, and add the missing `pull-theme-html.cjs` reconciliation script.

**Architecture:** Five self-contained tasks against an existing small Node/vanilla-JS tool set (no build step, no test framework — this codebase verifies scripts by running them with `node` and inspecting console output, not with a test runner; every task's verification steps follow that same convention). No new dependencies.

**Tech Stack:** Node.js (CommonJS `.cjs`), vanilla HTML/CSS/JS (`editor.html`), no npm packages beyond Node's built-ins (`fs`, `path`, `http`, `url`).

## Global Constraints

- Every generator script must keep its dual CLI/module shape: `module.exports = { run, ... }` plus `if (require.main === module) { ... }` for standalone CLI use (see `generate-styles-css.cjs:88-99` for the exact pattern to replicate).
- `frontend/styles.css` is CRLF — any new regex touching it must use `\r?\n`, never bare `\n` (see `generate-styles-css.cjs:56`).
- Dry-run by default, `--write` to persist, for every script that touches disk — no exceptions.
- Fail fast: `throw`/non-zero exit on any unexpected state, never a silent fallback or guessed value.
- All console/error output stays in French, matching the existing scripts' tone (e.g. `"Dry run only — pass --write to persist."` is the one English-leaning exception already in the codebase — keep matching whatever each specific file already does; don't mix languages within one file).

---

## Task 1: Shared `regex-utils.cjs` + fix unescaped key in `generate-theme-html.cjs`

**Files:**
- Create: `design_handoff_sift_refonte/token-sync/regex-utils.cjs`
- Modify: `design_handoff_sift_refonte/token-sync/generate-styles-css.cjs:15-17` (remove local `escapeRegex`, import shared one)
- Modify: `design_handoff_sift_refonte/token-sync/generate-design-md.cjs:58-60` (remove local `escapeRegex`, import shared one)
- Modify: `design_handoff_sift_refonte/token-sync/generate-theme-html.cjs:27-40` (escape `key` before building the `RegExp`)
- Modify: `design_handoff_sift_refonte/token-sync/pull-styles-css.cjs:20` (use shared `escapeRegex` instead of the inline `.replace(...)`)

**Interfaces:**
- Produces: `regex-utils.cjs` exports `escapeRegex(s: string): string` — escapes regex metacharacters for safe interpolation into `new RegExp(...)`.
- Consumed by: all 4 files above, via `const { escapeRegex } = require("./regex-utils.cjs");`.

- [ ] **Step 1: Create `regex-utils.cjs`**

```js
// Shared by every generator/pull script that builds a RegExp from a runtime string
// (a token name or legacy key) — one escaping implementation instead of N copies.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { escapeRegex };
```

- [ ] **Step 2: Verify it loads and escapes correctly**

Run: `node -e "const {escapeRegex}=require('./design_handoff_sift_refonte/token-sync/regex-utils.cjs'); console.log(escapeRegex('a.b*c'));"`
Expected output: `a\.b\*c`

- [ ] **Step 3: Wire `generate-styles-css.cjs` to the shared helper**

In `design_handoff_sift_refonte/token-sync/generate-styles-css.cjs`, replace lines 15-17:

```js
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

with:

```js
const { escapeRegex } = require("./regex-utils.cjs");
```

(Keep this new line right after the existing `const path = require("path");` at line 9, and delete the old function definition entirely — don't leave both.)

- [ ] **Step 4: Verify `generate-styles-css.cjs` still round-trips clean**

Run: `node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs`
Expected: `No-op: styles.css already matches design-tokens.json for every known token.`

- [ ] **Step 5: Wire `generate-design-md.cjs` to the shared helper**

In `design_handoff_sift_refonte/token-sync/generate-design-md.cjs`, replace lines 58-60:

```js
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

with:

```js
const { escapeRegex } = require("./regex-utils.cjs");
```

(Move this line up next to the other `require`s at the top of the file, e.g. right after line 10's `const path = require("path");`, and delete the old function body.)

- [ ] **Step 6: Verify `generate-design-md.cjs` still round-trips clean**

Run: `node design_handoff_sift_refonte/token-sync/generate-design-md.cjs`
Expected:
```
No-op: DESIGN.md bullets already match design-tokens.json for every present bullet.
NOTE: dark section has no "Track" bullet at all — left alone (documentation gap, not generated).
```

- [ ] **Step 7: Fix the unescaped key in `generate-theme-html.cjs`**

In `design_handoff_sift_refonte/token-sync/generate-theme-html.cjs`, add the import right after line 9 (`const path = require("path");`):

```js
const { escapeRegex } = require("./regex-utils.cjs");
```

Then in `replaceKeysInObjectLiteral` (lines 27-40), change line 31 from:

```js
    const re = new RegExp(`${key}\\s*:\\s*'[^']*'`);
```

to:

```js
    const re = new RegExp(`${escapeRegex(key)}\\s*:\\s*'[^']*'`);
```

- [ ] **Step 8: Verify `generate-theme-html.cjs` still round-trips clean**

Run: `node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs`
Expected: `No-op: Sift.dc.html theme() already matches design-tokens.json for every mapped key.`

- [ ] **Step 9: Wire `pull-styles-css.cjs` to the shared helper**

In `design_handoff_sift_refonte/token-sync/pull-styles-css.cjs`, add the import right after line 7 (`const path = require("path");`):

```js
const { escapeRegex } = require("./regex-utils.cjs");
```

Then change line 20 from:

```js
    const re = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([^;]+);`);
```

to:

```js
    const re = new RegExp(`${escapeRegex(key)}:([^;]+);`);
```

- [ ] **Step 10: Verify `pull-styles-css.cjs` still round-trips clean**

Run: `node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs`
Expected: `Nothing to pull: styles.css matches design-tokens.json for every token.`

- [ ] **Step 11: Prove the fix actually matters (regression check)**

Run this to confirm `generate-theme-html.cjs` no longer throws on a key with a regex metacharacter (it would have thrown "Invalid regular expression" or silently failed to match before the fix):

```bash
node -e "
const { escapeRegex } = require('./design_handoff_sift_refonte/token-sync/regex-utils.cjs');
const re = new RegExp(escapeRegex('a.b') + \"\\\\s*:\\\\s*'[^']*'\");
console.log(re.test(\"a.b:'x'\"));   // true: matches literal 'a.b'
console.log(re.test(\"axb:'x'\"));   // false: '.' no longer means 'any char'
"
```
Expected output:
```
true
false
```

- [ ] **Step 12: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/regex-utils.cjs design_handoff_sift_refonte/token-sync/generate-styles-css.cjs design_handoff_sift_refonte/token-sync/generate-design-md.cjs design_handoff_sift_refonte/token-sync/generate-theme-html.cjs design_handoff_sift_refonte/token-sync/pull-styles-css.cjs
git commit -m "fix(token-sync): share escapeRegex helper, escape key in generate-theme-html.cjs"
```

---

## Task 2: Shape validation on `POST /validate` and `POST /preview-tokens`

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/editor-server.cjs:93-98` (replace the truthy check), and the `/preview-tokens` handler at lines 72-76 (add the same check).

**Interfaces:**
- Produces: `validateTokensShape(tokens)` — throws `Error` with a descriptive message if `tokens` doesn't match `{ colors: { [key]: { light: string, dark: string } }, static: { [key]: string } }`. Returns nothing on success (throw-only contract, matching every other validation function in this codebase, e.g. `generate-theme-html.cjs:33`).
- Consumed by: the `/validate` and `/preview-tokens` request handlers in `editor-server.cjs`, wrapped in a try/catch that already exists at the outer level of the server (lines 51 and 120-122) — a thrown error there already gets turned into a `500` JSON response, so no new catch is needed, just call the function and let it throw.

- [ ] **Step 1: Add `validateTokensShape` to `editor-server.cjs`**

In `design_handoff_sift_refonte/token-sync/editor-server.cjs`, add this function right after the `readBody` function (after line 46, before `const server = http.createServer(...)`):

```js
function validateTokensShape(tokens) {
  if (!tokens || typeof tokens !== "object") {
    throw new Error("expected a JSON object with { colors, static }");
  }
  if (!tokens.colors || typeof tokens.colors !== "object") {
    throw new Error("expected tokens.colors to be an object");
  }
  for (const [key, value] of Object.entries(tokens.colors)) {
    if (!value || typeof value !== "object" || typeof value.light !== "string" || typeof value.dark !== "string") {
      throw new Error(`tokens.colors["${key}"] must be { light: string, dark: string }, got ${JSON.stringify(value)}`);
    }
  }
  if (!tokens.static || typeof tokens.static !== "object") {
    throw new Error("expected tokens.static to be an object");
  }
  for (const [key, value] of Object.entries(tokens.static)) {
    if (typeof value !== "string") {
      throw new Error(`tokens.static["${key}"] must be a string, got ${JSON.stringify(value)}`);
    }
  }
}
```

- [ ] **Step 2: Call it from `/preview-tokens`**

Change lines 72-76 from:

```js
    if (req.method === "POST" && url.pathname === "/preview-tokens") {
      const body = await readBody(req);
      pendingTokens = JSON.parse(body);
      return sendJson(res, 200, { ok: true });
    }
```

to:

```js
    if (req.method === "POST" && url.pathname === "/preview-tokens") {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      validateTokensShape(parsed);
      pendingTokens = parsed;
      return sendJson(res, 200, { ok: true });
    }
```

- [ ] **Step 3: Call it from `/validate`, replacing the truthy check**

Change lines 93-98 from:

```js
    if (req.method === "POST" && url.pathname === "/validate") {
      const body = await readBody(req);
      const edited = JSON.parse(body);
      if (!edited.colors || !edited.static) {
        return sendJson(res, 400, { error: "expected { colors, static }" });
      }
      fs.writeFileSync(tokensPath, JSON.stringify(edited, null, 2), "utf8");
```

to:

```js
    if (req.method === "POST" && url.pathname === "/validate") {
      const body = await readBody(req);
      const edited = JSON.parse(body);
      validateTokensShape(edited);
      fs.writeFileSync(tokensPath, JSON.stringify(edited, null, 2), "utf8");
```

- [ ] **Step 4: Restart the server and verify the happy path still works**

This project already has the server registered as `token-editor` in `.claude/launch.json` (stop it and start it again via the preview tool, since `editor-server.cjs` itself changed). Then re-run the existing no-op validate smoke test:

```bash
curl -s -X POST http://localhost:4756/validate -H "Content-Type: application/json" --data @design_handoff_sift_refonte/token-sync/design-tokens.json
```
Expected: JSON response with `results.stylesCss.noOp === true`, `results.themeHtml.noOp === true`, `results.designMd.noOp === true` (same as the unchanged-tokens smoke test already verified earlier in the project) — confirms the new validation didn't break the legitimate shape.

- [ ] **Step 5: Verify the fix actually rejects malformed input**

```bash
curl -s -X POST http://localhost:4756/validate -H "Content-Type: application/json" --data '{"colors":{"--color-text-primary":"just-a-string"},"static":{}}'
```
Expected: a `500` response whose JSON body's `error` field contains `tokens.colors["--color-text-primary"] must be { light: string, dark: string }` — and, critically, confirm `design-tokens.json` was **not** overwritten:
```bash
git status --short design_handoff_sift_refonte/token-sync/design-tokens.json
```
Expected: no output (file unchanged) — the validation must run and throw *before* `fs.writeFileSync` on line 99, so a bad request never reaches the write.

- [ ] **Step 6: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/editor-server.cjs
git commit -m "fix(token-sync): validate token shape before writing design-tokens.json"
```

---

## Task 3: Structural-drift detection in `generate-design-md.cjs`

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/generate-design-md.cjs:88-116` (the `run` function)

**Interfaces:**
- Produces: `run()` now throws if the actual bullet count in a section doesn't match what `lightBullets`/`darkBullets` expect — no new exported symbols, this hardens existing behavior.
- Consumes: nothing new; reuses `lightSection`/`restFromDark` already computed in `run()`.

- [ ] **Step 1: Add a bullet-counting helper**

In `design_handoff_sift_refonte/token-sync/generate-design-md.cjs`, add this function right after `replaceCtaBullet` (after line 86, before `function run`):

```js
// Counts real "- Label : `value`" bullet lines in a section of DESIGN.md's prose.
// Used to detect when the file gained/lost a bullet the hardcoded lightBullets/
// darkBullets lists don't know about yet (a case the per-bullet regex above can't
// catch, since it only checks "is my known label still there").
function countBulletLines(text) {
  const matches = text.match(/^- .+ : `[^`]+`$/gm);
  return matches ? matches.length : 0;
}
```

- [ ] **Step 2: Verify the counter against the real file**

```bash
node -e "
const fs = require('fs');
const md = fs.readFileSync('design_handoff_sift_refonte/DESIGN.md', 'utf8');
const parts = md.split(/(## Palette — mode sombre)/);
const countBulletLines = (text) => (text.match(/^- .+ : \`[^\`]+\`\$/gm) || []).length;
console.log('light:', countBulletLines(parts[0]));
console.log('dark:', countBulletLines(parts[2]));
"
```
Expected: `light: 16` (14 simple bullets from `lightBullets` + 1 CTA line + 1 "Désactivé" line the generator doesn't touch) and `dark: 15` (13 simple bullets from `darkBullets`, one fewer than light since "Track" is missing, + 1 CTA + 1 "Désactivé"). **Run this step for real and use its actual output** for the expected counts in Step 4 below — don't guess; if the numbers differ from 16/15, use what you actually observed.

- [ ] **Step 3: Wire the check into `run()`**

In `run()` (lines 88-116), after line 97 (`const [lightSection, darkHeading, restFromDark] = parts;`), add:

```js
  const expectedLightCount = lightBullets.length + 1; // +1 for the CTA line
  const expectedDarkCount = darkBullets.length + 1;
  const actualLightCount = countBulletLines(lightSection);
  const actualDarkCount = countBulletLines(restFromDark);
  if (actualLightCount !== expectedLightCount) {
    throw new Error(
      `DESIGN.md's light section has ${actualLightCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's lightBullets list only knows about ${expectedLightCount} ` +
      `(${lightBullets.length} entries + 1 CTA line). Update lightBullets in this file to match.`
    );
  }
  if (actualDarkCount !== expectedDarkCount) {
    throw new Error(
      `DESIGN.md's dark section has ${actualDarkCount} bullet(s) matching the "- Label : \`value\`" ` +
      `shape, but generate-design-md.cjs's darkBullets list only knows about ${expectedDarkCount} ` +
      `(${darkBullets.length} entries + 1 CTA line). Update darkBullets in this file to match.`
    );
  }
```

Note: this check counts bullets whose value is wrapped in single backticks (`` `value` ``) — the "Désactivé" line matches this shape too but isn't in `lightBullets`/`darkBullets` (it's the intentionally-unmanaged `disabled` key). If Step 2's actual counts don't include "Désactivé" as expected (i.e. if the regex doesn't match it for some formatting reason), adjust the `+1`/expected math in this step to match what Step 2 actually measured — the goal is the check passing against today's real file, not a specific number.

- [ ] **Step 4: Verify the tool still round-trips clean with the new check active**

Run: `node design_handoff_sift_refonte/token-sync/generate-design-md.cjs`
Expected: same as before —
```
No-op: DESIGN.md bullets already match design-tokens.json for every present bullet.
NOTE: dark section has no "Track" bullet at all — left alone (documentation gap, not generated).
```
If instead you get a "bullet count mismatch" error, the math in Step 3 doesn't match reality — go back to Step 2's actual output and fix the expected-count formula (don't hardcode a number that "should" be right; use what the file actually contains).

- [ ] **Step 5: Prove the check catches real drift**

```bash
cp design_handoff_sift_refonte/DESIGN.md /tmp_design_backup.md 2>/dev/null || cp design_handoff_sift_refonte/DESIGN.md "$TMPDIR/design_backup.md"
```

(Use whatever scratchpad directory this session already established for backups instead of `/tmp` if that write fails — this repo's Bash tool cannot write to `/`.)

Then inject a fake extra bullet into the light section and confirm the generator refuses to run silently:

```bash
node -e "
const fs = require('fs');
const p = 'design_handoff_sift_refonte/DESIGN.md';
let md = fs.readFileSync(p, 'utf8');
md = md.replace('- Canvas : \`#E7E2DB\`', '- Canvas : \`#E7E2DB\`\n- Fausse bullet : \`#000000\`');
fs.writeFileSync(p, md);
"
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs; echo "exit=$?"
```
Expected: a non-zero exit and an error mentioning "DESIGN.md's light section has 17 bullet(s)... only knows about 16" (or whatever the real before/after numbers are) — NOT a silent no-op.

- [ ] **Step 6: Restore DESIGN.md**

```bash
cp /tmp_design_backup.md design_handoff_sift_refonte/DESIGN.md 2>/dev/null || cp "$TMPDIR/design_backup.md" design_handoff_sift_refonte/DESIGN.md
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs
```
Expected: back to the clean no-op output from Step 4, and `git status --short design_handoff_sift_refonte/DESIGN.md` shows no diff.

- [ ] **Step 7: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/generate-design-md.cjs
git commit -m "fix(token-sync): detect DESIGN.md bullet-count drift instead of failing silently"
```

---

## Task 4: `editor.html` accessibility fixes (aria-label, contrast, lang, iframe title)

**Files:**
- Modify: `design_handoff_sift_refonte/token-sync/editor.html`

**Interfaces:** None (self-contained HTML/CSS/JS file, no other file depends on its internals).

- [ ] **Step 1: Add `lang="fr"`**

Change line 2 from:
```html
<html>
```
to:
```html
<html lang="fr">
```

- [ ] **Step 2: Add a title to the mockup iframe**

Change line 140 from:
```html
      <iframe id="mockup-frame" style="width:1440px;height:900px;max-width:none;border:1px solid #ccc;border-radius:10px;background:#fff;flex:none"></iframe>
```
to:
```html
      <iframe id="mockup-frame" title="Maquette interactive Sift" style="width:1440px;height:900px;max-width:none;border:1px solid #ccc;border-radius:10px;background:#fff;flex:none"></iframe>
```

- [ ] **Step 3: Fix contrast — replace `#918a7d` and `#a39c8f` with `#6b6459`**

In the `<style>` block, make these exact replacements:

Line 32 (`details.group summary::after`), change:
```css
  details.group summary::after { content: "▸"; font-size: 11px; color: #918a7d; transition: transform .15s; }
```
to:
```css
  details.group summary::after { content: "▸"; font-size: 11px; color: #6b6459; transition: transform .15s; }
```

Line 34 (`.group-hint`), change:
```css
  details.group summary .group-hint { font-size: 11px; font-weight: 400; color: #918a7d; }
```
to:
```css
  details.group summary .group-hint { font-size: 11px; font-weight: 400; color: #6b6459; }
```

Line 40 (`.token-name`), change:
```css
  .token-name { font-size: 10px; font-family: "JetBrains Mono", monospace; color: #a39c8f; margin-bottom: 8px; }
```
to:
```css
  .token-name { font-size: 10px; font-family: "JetBrains Mono", monospace; color: #6b6459; margin-bottom: 8px; }
```

Line 43 (`.mode-tag`), change:
```css
  .mode-slot .mode-tag { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #918a7d; width: 44px; flex: none; }
```
to:
```css
  .mode-slot .mode-tag { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #6b6459; width: 44px; flex: none; }
```

Line 60 (`.preview-tab` default state), change:
```css
  .preview-tab {
    padding: 7px 16px; font-size: 12.5px; font-weight: 500; border: 1px solid #ddd5c8;
    border-radius: 999px; background: #fff; cursor: pointer; color: #6b6459;
  }
```
This one is already `#6b6459` — no change needed here, skip it.

Line 81 (`#report .empty-note`), change:
```css
  #report .empty-note { color: #918a7d; font-style: italic; }
```
to:
```css
  #report .empty-note { color: #6b6459; font-style: italic; }
```

Also check the inline style in the "Maquette complète" hint text at line 133 (`<span style="font-size:11.5px;color:#918a7d">`) — change to:
```html
        <span style="font-size:11.5px;color:#6b6459">
```

- [ ] **Step 4: Verify no `#918a7d` or `#a39c8f` remain**

Run: `grep -n "918a7d\|a39c8f" design_handoff_sift_refonte/token-sync/editor.html`
Expected: no output (both colors fully replaced).

- [ ] **Step 5: Add `aria-label` to color-mode inputs in `makeModeSlot()`**

In the `<script>` block, find `makeModeSlot(key, mode)` (starts around line 255). After the line that creates `tag.textContent = mode === "light" ? "Clair" : "Sombre";` and before `const value = tokens.colors[key][mode];`, the function currently reads:

```js
function makeModeSlot(key, mode) {
  const wrap = document.createElement("div");
  wrap.className = "mode-slot";
  const tag = document.createElement("span");
  tag.className = "mode-tag";
  tag.textContent = mode === "light" ? "Clair" : "Sombre";

  const value = tokens.colors[key][mode];
```

`makeModeSlot` doesn't currently receive the human-readable `label` (only the raw `key`) — it needs it to build a meaningful `aria-label`. Change its signature and every call site:

Change the function signature from:
```js
function makeModeSlot(key, mode) {
```
to:
```js
function makeModeSlot(key, label, mode) {
```

Then, still inside `makeModeSlot`, right after the `text.value = value;` line (a few lines below), add:

```js
  const modeText = mode === "light" ? "Clair" : "Sombre";
  if (picker.tagName === "INPUT") picker.setAttribute("aria-label", `${label} — ${modeText}`);
  text.setAttribute("aria-label", `${label} — ${modeText}, valeur`);
```

Now update the one call site in `renderColorGroups()` — find this line (around line 321):
```js
      pair.append(makeModeSlot(key, "light"), makeModeSlot(key, "dark"));
```
and change it to:
```js
      pair.append(makeModeSlot(key, label, "light"), makeModeSlot(key, label, "dark"));
```
(`label` is already in scope there, from the enclosing `for (const [key, label] of entries)` loop.)

- [ ] **Step 6: Add `aria-label` to static-row inputs**

In `renderColorGroups()`, find the static-groups loop (around line 342):
```js
      const input = document.createElement("input");
      input.type = "text";
      input.value = tokens.static[key];
      input.addEventListener("input", () => {
```
Add one line right after `input.value = tokens.static[key];`:
```js
      input.setAttribute("aria-label", label);
```

- [ ] **Step 7: Reload the tool and verify labels are present**

Restart the `token-editor` preview server (edits to `editor.html` are served fresh on each request, no restart needed — just reload the page), then run:

```js
// via preview_eval against the running token-editor server
(() => {
  const input = document.querySelector('.mode-slot input[type=text]');
  return { hasAriaLabel: input.hasAttribute('aria-label'), ariaLabel: input.getAttribute('aria-label') };
})()
```
Expected: `{ hasAriaLabel: true, ariaLabel: "<something> — Clair, valeur" }` (or the Sombre equivalent, depending which input was picked).

- [ ] **Step 8: Verify contrast improved**

Via `preview_inspect` (or `preview_eval` + `getComputedStyle`) on `.token-name`:
Expected `color` is now `rgb(107, 100, 89)` (the RGB form of `#6b6459`), not `rgb(163, 156, 143)`.

- [ ] **Step 9: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/editor.html
git commit -m "fix(token-sync): a11y — aria-label on inputs, contrast fix, lang, iframe title"
```

---

## Task 5: `pull-theme-html.cjs` — reconcile Sift.dc.html into canonical

**Files:**
- Create: `design_handoff_sift_refonte/token-sync/pull-theme-html.cjs`

**Interfaces:**
- Consumes: `design-tokens.json`, `alias-map.json`, `last-sync.json` (the same baseline file `pull-styles-css.cjs` already reads/writes at `design_handoff_sift_refonte/token-sync/last-sync.json`), and `Sift.dc.html`'s `theme()` literal (same extraction pattern as `generate-theme-html.cjs`'s `transform()`).
- Produces: a CLI script, dry-run by default, `--write` persists into `design-tokens.json` and updates `last-sync.json`. No module exports needed (unlike the generators, nothing else in this codebase calls this one programmatically yet).

- [ ] **Step 1: Write `pull-theme-html.cjs`**

Create `design_handoff_sift_refonte/token-sync/pull-theme-html.cjs`:

```js
// Pull: reconcile hand/Claude-Design edits made directly to Sift.dc.html's theme() back
// into design-tokens.json (canonical). One direction only (Sift.dc.html -> canonical).
// Shares last-sync.json with pull-styles-css.cjs: the baseline represents "what did the
// canonical look like at the last full sync", not a property of any one source file, so
// one baseline file correctly serves both pull directions.
// Dry-run by default; --write persists the pull and updates the shared baseline.
const fs = require("fs");
const path = require("path");
const { escapeRegex } = require("./regex-utils.cjs");

const tokenDir = __dirname;
const htmlPath = path.join(tokenDir, "..", "Sift.dc.html");
const tokensPath = path.join(tokenDir, "design-tokens.json");
const aliasPath = path.join(tokenDir, "alias-map.json");
const baselinePath = path.join(tokenDir, "last-sync.json");

const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
const aliasMap = JSON.parse(fs.readFileSync(aliasPath, "utf8"));
const html = fs.readFileSync(htmlPath, "utf8");

function extractThemeBranch(regex, label) {
  const m = html.match(regex);
  if (!m) throw new Error(`Could not locate ${label} branch of theme() in Sift.dc.html`);
  const pairs = {};
  for (const [, key, value] of m[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    pairs[key] = value;
  }
  return pairs;
}

const darkTheme = extractThemeBranch(/isDark\(\)\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/, "dark");
const lightTheme = extractThemeBranch(/\}\s*:\s*\{([\s\S]*?)\}\s*;\s*\n\s*\}/, "light");

// Bootstrap: first run ever, nothing to compare against yet.
if (!fs.existsSync(baselinePath)) {
  let alreadyInSync = true;
  for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
    if (prodKey === null) continue;
    const canonical = tokens.colors[prodKey];
    if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
    if (lightTheme[legacyKey] !== canonical.light || darkTheme[legacyKey] !== canonical.dark) {
      alreadyInSync = false;
      break;
    }
  }
  if (!alreadyInSync) {
    throw new Error(
      "No last-sync.json baseline found, and Sift.dc.html does not currently match design-tokens.json. " +
      "Reconcile by hand once (either edit design-tokens.json to match Sift.dc.html, or run the push " +
      "generator) before pull can start tracking a safe baseline."
    );
  }
  fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
  console.log("No baseline existed yet. Sift.dc.html already matches design-tokens.json — baseline initialized, nothing to pull.");
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

const pulls = [];
const conflicts = [];

for (const [legacyKey, prodKey] of Object.entries(aliasMap)) {
  if (prodKey === null) continue; // e.g. "disabled" — no production equivalent, not this script's business
  const canonical = tokens.colors[prodKey];
  if (!canonical) throw new Error(`alias-map points ${legacyKey} -> ${prodKey}, missing from design-tokens.json`);
  const baselineEntry = baseline.colors[prodKey];
  if (!baselineEntry) throw new Error(`${prodKey} missing from last-sync.json baseline — run pull-styles-css.cjs or delete last-sync.json to reset it.`);

  for (const mode of ["light", "dark"]) {
    const htmlValue = mode === "light" ? lightTheme[legacyKey] : darkTheme[legacyKey];
    const canonicalValue = canonical[mode];
    const baselineValue = baselineEntry[mode];
    if (htmlValue === canonicalValue) continue; // already in sync
    if (canonicalValue === baselineValue) {
      pulls.push({ prodKey, legacyKey, mode, from: canonicalValue, to: htmlValue });
    } else {
      conflicts.push({ prodKey, legacyKey, mode, canonical: canonicalValue, html: htmlValue, baseline: baselineValue });
    }
  }
}

if (conflicts.length > 0) {
  console.error(`${conflicts.length} conflict(s) — both Sift.dc.html and design-tokens.json changed since the last sync. Not resolving automatically:\n`);
  for (const c of conflicts) {
    console.error(`  ${c.prodKey} (${c.mode}): baseline="${c.baseline}" canonical(now)="${c.canonical}" Sift.dc.html(now)="${c.html}"`);
  }
  console.error("\nResolve by hand (edit design-tokens.json to the value you want to keep), then re-run pull.");
  process.exit(1);
}

if (pulls.length === 0) {
  console.log("Nothing to pull: Sift.dc.html matches design-tokens.json for every mapped token.");
  process.exit(0);
}

console.log(`${pulls.length} value(s) to pull from Sift.dc.html into design-tokens.json:\n`);
for (const p of pulls) {
  console.log(`  ${p.prodKey} (${p.mode}) [legacy: ${p.legacyKey}]: "${p.from}" -> "${p.to}"`);
}

const writeFlag = process.argv.includes("--write");
if (!writeFlag) {
  console.log("\nDry run only — pass --write to persist these into design-tokens.json.");
  process.exit(0);
}

for (const p of pulls) {
  tokens.colors[p.prodKey][p.mode] = p.to;
}
fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf8");
fs.writeFileSync(baselinePath, JSON.stringify(tokens, null, 2), "utf8");
console.log("\nWritten to design-tokens.json, baseline updated.");
```

(Note: `escapeRegex` is imported but unused directly in this script's own regex construction — the theme-branch extraction regexes are fixed literals, not built from a runtime key, same as `verify-roundtrip.cjs`'s equivalent extraction. Remove the unused import if lint complains; there's no linter configured for this directory currently, so this is a judgment call, not a blocker.)

- [ ] **Step 2: Verify it round-trips clean against the current (in-sync) state**

Run: `node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs`
Expected: `Nothing to pull: Sift.dc.html matches design-tokens.json for every mapped token.`

- [ ] **Step 3: Back up the 3 files this test will touch**

```bash
SCRATCH="$(node -e "console.log(require('os').tmpdir())")/sift-pull-theme-test"
mkdir -p "$SCRATCH"
cp design_handoff_sift_refonte/Sift.dc.html "$SCRATCH/Sift.dc.html.bak"
cp design_handoff_sift_refonte/token-sync/design-tokens.json "$SCRATCH/design-tokens.json.bak"
cp design_handoff_sift_refonte/token-sync/last-sync.json "$SCRATCH/last-sync.json.bak"
```

- [ ] **Step 4: Prove a safe pull is detected and applied**

```bash
node -e "
const fs = require('fs');
let html = fs.readFileSync('design_handoff_sift_refonte/Sift.dc.html', 'utf8');
html = html.replace(\"canvas:'#E7E2DB'\", \"canvas:'#e0dccf'\");
fs.writeFileSync('design_handoff_sift_refonte/Sift.dc.html', html);
"
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
```
Expected: reports 1 value to pull, `--color-background-primary (light) [legacy: canvas]: "#E7E2DB" -> "#e0dccf"`.

```bash
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs --write
node -e "console.log(require('./design_handoff_sift_refonte/token-sync/design-tokens.json').colors['--color-background-primary'].light)"
```
Expected: `#e0dccf` — canonical updated for real.

- [ ] **Step 5: Restore, then prove a real conflict is refused**

```bash
cp "$SCRATCH/Sift.dc.html.bak" design_handoff_sift_refonte/Sift.dc.html
cp "$SCRATCH/design-tokens.json.bak" design_handoff_sift_refonte/token-sync/design-tokens.json
cp "$SCRATCH/last-sync.json.bak" design_handoff_sift_refonte/token-sync/last-sync.json
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
```
Expected: `Nothing to pull` (confirms restore worked).

Now diverge both sides on the same key since the baseline:
```bash
node -e "
const fs = require('fs');
let html = fs.readFileSync('design_handoff_sift_refonte/Sift.dc.html', 'utf8');
html = html.replace(\"canvas:'#E7E2DB'\", \"canvas:'#111111'\");
fs.writeFileSync('design_handoff_sift_refonte/Sift.dc.html', html);

const p = 'design_handoff_sift_refonte/token-sync/design-tokens.json';
const t = JSON.parse(fs.readFileSync(p, 'utf8'));
t.colors['--color-background-primary'].light = '#222222';
fs.writeFileSync(p, JSON.stringify(t, null, 2));
"
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs; echo "exit=$?"
```
Expected: exit code `1`, output contains `1 conflict(s)`, `--color-background-primary (light): baseline="#E7E2DB" canonical(now)="#222222" Sift.dc.html(now)="#111111"`, and no files written (verify with `git status --short design_handoff_sift_refonte/token-sync/design-tokens.json` immediately after — should show a diff only from the manual edit above, not from the script).

- [ ] **Step 6: Restore everything to the real original state**

```bash
cp "$SCRATCH/Sift.dc.html.bak" design_handoff_sift_refonte/Sift.dc.html
cp "$SCRATCH/design-tokens.json.bak" design_handoff_sift_refonte/token-sync/design-tokens.json
cp "$SCRATCH/last-sync.json.bak" design_handoff_sift_refonte/token-sync/last-sync.json
rm -rf "$SCRATCH"
node design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
node design_handoff_sift_refonte/token-sync/generate-styles-css.cjs
node design_handoff_sift_refonte/token-sync/generate-theme-html.cjs
node design_handoff_sift_refonte/token-sync/generate-design-md.cjs
node design_handoff_sift_refonte/token-sync/pull-styles-css.cjs
git status --short frontend/styles.css design_handoff_sift_refonte/Sift.dc.html design_handoff_sift_refonte/DESIGN.md
```
Expected: all 5 commands report clean no-op/nothing-to-pull, and the final `git status` shows no output (all three real files byte-identical to before this task started).

- [ ] **Step 7: Commit**

```bash
git add design_handoff_sift_refonte/token-sync/pull-theme-html.cjs
git commit -m "feat(token-sync): add pull-theme-html.cjs, reconciles Sift.dc.html into canonical"
```

---

## Post-plan verification (run once, after all 5 tasks)

- [ ] Run every script's clean-state check in sequence to confirm nothing regressed:

```bash
cd design_handoff_sift_refonte/token-sync
node generate-styles-css.cjs
node generate-theme-html.cjs
node generate-design-md.cjs
node pull-styles-css.cjs
node pull-theme-html.cjs
node apply-tokens.cjs
```
Expected: every line reports no-op / nothing-to-pull / already-up-to-date — zero diffs anywhere.

- [ ] Confirm the editor server still boots and serves the updated `editor.html`:

Restart the `token-editor` preview server, load the page, and verify (via `preview_eval`) that a color input now has a non-empty `aria-label`, and that `document.documentElement.lang === "fr"`.
