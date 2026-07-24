#!/usr/bin/env node
// lint-tokens.mjs — detects hardcoded colors / z-index / px-spacing values that bypass
// the CSS custom-property tokens declared in frontend/styles.css.
//
// Approach: plain regex scanning, no CSS AST parser (per project constraint). This is a
// first-pass heuristic tool, not a full parser — see "known limitations" in the report.
//
// Spacing-token px set: tokens in styles.css are declared directly in px (--space-4:4px,
// --text-*:Npx, --h-40:40px, --border-radius-*). We do NOT convert rem->px here because
// styles.css does not use a rem-based spacing scale — every relevant numeric token is
// already a literal px value. If that changes, add a REM_BASE constant and convert.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const TOKEN_FILE = resolve(REPO_ROOT, 'frontend', 'styles.css');
const BASELINE_FILE = resolve(REPO_ROOT, 'scripts', 'lint-tokens-baseline.json');

// Ratchet mode: don't fail CI on the ~540 pre-existing findings (undoable in one pass, tracked
// separately in docs/superpowers/changes/2026-07-19-spacing-scale-sweep/design.md) — fail only
// when a run introduces MORE findings than the last recorded baseline, per category. Paying down
// debt lowers the ratchet (via --write-baseline); it can never silently climb back up unnoticed.
const WRITE_BASELINE = process.argv.includes('--write-baseline');

// '.claude' excludes native worktrees too (created under .claude/worktrees/ per
// ~/.claude/CLAUDE.md § Isolation native) — each one is a full checkout of frontend/, so
// leaving it unexcluded silently doubles (or worse) every count depending on how many worktree
// agents happen to be running on the machine at scan time. Caught by verify-gate crosscheck
// (2026-07-24): a baseline recorded while a worktree was present was ~2x the real count.
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'target', '.claude']);
// src-tauri\target — matched by checking the relative path contains src-tauri/target.
const SCAN_EXTS = new Set(['.css', '.ts', '.tsx']);

function shouldSkipDir(absDir) {
  const rel = relative(REPO_ROOT, absDir).split(/[\\/]/);
  if (rel.some((seg) => EXCLUDE_DIRS.has(seg))) return true;
  if (rel.join('/').includes('src-tauri/target')) return true;
  return false;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(abs)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(extname(entry.name))) out.push(abs);
    }
  }
  return out;
}

// ---- Step 1: parse tokens from styles.css --------------------------------------------

const tokenSrc = readFileSync(TOKEN_FILE, 'utf8');

// Matches `--name: value;` (value = anything up to the next `;`).
const TOKEN_DECL_RE = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;

const colorTokens = new Map(); // name -> value (for reporting nearest match, best-effort)
const spacingPxValues = new Map(); // px number -> token name (first one wins)

let m;
while ((m = TOKEN_DECL_RE.exec(tokenSrc))) {
  const name = m[1];
  const value = m[2].trim();

  if (/^(color|overlay)-/.test(name) || /^oklch\(|^rgba?\(|^#/.test(value)) {
    colorTokens.set(name, value);
  }

  // Pull every literal `Npx` out of the value (covers --space-*, --text-*, --h-*,
  // --border-radius-base, and calc() expressions that reference literal px numbers).
  const pxRe = /(-?\d+(?:\.\d+)?)px/g;
  let pm;
  while ((pm = pxRe.exec(value))) {
    const px = parseFloat(pm[1]);
    if (!spacingPxValues.has(px)) spacingPxValues.set(px, `--${name}`);
  }
}

// ---- Step 2: scan files ----------------------------------------------------------------

// Scan styles.css too (not just other files) — most real drift lives THERE, in the
// component rules below the token declarations, not in other files bypassing it. We
// blank out the :root/dark-mode token-declaration blocks (same length, newlines kept,
// so line numbers stay correct) so a token's own value never flags itself, while the
// rest of the file still gets scanned. Fixes a codex-crosscheck HAUTE finding
// (2026-07-19): the previous version excluded the whole file, missing the majority of
// off-scale spacing/color/z-index sites — the file most in need of this lint.
const TOKEN_BLOCK_RE = /(@media[^{]*\{\s*:root(\[[^\]]*\])?\s*\{[^{}]*\}\s*\})|(:root(\[[^\]]*\])?\s*\{[^{}]*\})/g;
function blankOutTokenBlocks(text) {
  return text.replace(TOKEN_BLOCK_RE, (block) => block.replace(/[^\n]/g, ' '));
}

const files = walk(REPO_ROOT, []);

const COLOR_RE = /(#(?:[0-9a-fA-F]{3}){1,2}\b|#[0-9a-fA-F]{8}\b|\brgba?\([^)]*\)|\boklch\([^)]*\))/g;
const ZINDEX_RE = /z-index\s*:\s*(-?\d+(?:\.\d+)?)/g;
const SPACING_PROP_RE = /\b(padding|margin|width|height|gap)(-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;{}]+);/g;
const PX_VALUE_RE = /(-?\d+(?:\.\d+)?)px/g;

const findings = []; // { file, line, category, value, suggestion }

function nearestSpacingToken(px) {
  if (spacingPxValues.has(px)) return spacingPxValues.get(px);
  let best = null;
  let bestDist = Infinity;
  for (const [val, name] of spacingPxValues) {
    const d = Math.abs(val - px);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best && bestDist <= 2 ? `${best} (off by ${bestDist}px)` : 'no matching token — new value';
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (resolve(file) === resolve(TOKEN_FILE)) text = blankOutTokenBlocks(text);
  const rel = relative(REPO_ROOT, file).split('\\').join('/');

  // --- colors ---
  let cm;
  COLOR_RE.lastIndex = 0;
  while ((cm = COLOR_RE.exec(text))) {
    const value = cm[0];
    // skip url() contents crudely: if immediately preceded by "url(" ignore (best-effort).
    const before = text.slice(Math.max(0, cm.index - 5), cm.index);
    if (/url\($/.test(before)) continue;
    findings.push({
      file: rel,
      line: lineAt(text, cm.index),
      category: 'color',
      value,
      suggestion: 'use a --color-*/--overlay-* token instead of a literal color',
    });
  }

  // --- z-index ---
  let zm;
  ZINDEX_RE.lastIndex = 0;
  while ((zm = ZINDEX_RE.exec(text))) {
    const num = parseFloat(zm[1]);
    if (num === 0 || num === 1 || num === -1) continue;
    findings.push({
      file: rel,
      line: lineAt(text, zm.index),
      category: 'z-index',
      value: zm[1],
      suggestion: 'use --z-popover/--z-toast/--z-modal (or add a new named layer token) instead of a literal z-index',
    });
  }

  // --- px spacing on padding/margin/width/height/gap ---
  let sm2;
  SPACING_PROP_RE.lastIndex = 0;
  while ((sm2 = SPACING_PROP_RE.exec(text))) {
    const declValue = sm2[3];
    let pxm;
    PX_VALUE_RE.lastIndex = 0;
    while ((pxm = PX_VALUE_RE.exec(declValue))) {
      const px = parseFloat(pxm[1]);
      if (!spacingPxValues.has(px)) {
        const offset = sm2.index + sm2[0].indexOf(declValue);
        findings.push({
          file: rel,
          line: lineAt(text, offset),
          category: 'px-spacing',
          value: `${px}px`,
          suggestion: nearestSpacingToken(px),
        });
      }
    }
  }
}

// ---- Step 3: report --------------------------------------------------------------------

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const counts = { color: 0, 'z-index': 0, 'px-spacing': 0 };
for (const f of findings) counts[f.category]++;

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`lint-tokens: baseline written to ${relative(REPO_ROOT, BASELINE_FILE)}:`, counts);
  process.exit(0);
}

if (findings.length === 0) {
  console.log('lint-tokens: no hardcoded values found bypassing tokens.');
  process.exit(0);
}

console.log(`lint-tokens: ${findings.length} finding(s) across ${byFile.size} file(s)\n`);

for (const [file, list] of [...byFile.entries()].sort()) {
  console.log(file + ':');
  for (const f of list.sort((a, b) => a.line - b.line)) {
    console.log(`  ${f.line}: [${f.category}] ${f.value} -> ${f.suggestion}`);
  }
  console.log('');
}

console.log('Summary:');
console.log(`  colors:      ${counts.color}`);
console.log(`  z-index:     ${counts['z-index']}`);
console.log(`  px-spacing:  ${counts['px-spacing']}`);

// ---- Step 4: ratchet against baseline ---------------------------------------------------

if (!existsSync(BASELINE_FILE)) {
  console.log(
    `\nlint-tokens: no baseline at ${relative(REPO_ROOT, BASELINE_FILE)} — run with ` +
    `--write-baseline once to record the current count as the starting ratchet, then commit it.`,
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const regressed = [];
for (const cat of Object.keys(counts)) {
  if (counts[cat] > (baseline[cat] ?? 0)) {
    regressed.push(`${cat}: ${baseline[cat] ?? 0} -> ${counts[cat]} (+${counts[cat] - (baseline[cat] ?? 0)})`);
  }
}

if (regressed.length > 0) {
  console.log('\nlint-tokens: NEW findings beyond the recorded baseline — this run is a regression:');
  for (const r of regressed) console.log(`  ${r}`);
  console.log(
    '\nFix the new drift, or if this reduction/addition is deliberate and reviewed, ' +
    're-run with --write-baseline to update the ratchet.',
  );
  process.exit(1);
}

const improved = Object.keys(counts).filter((cat) => counts[cat] < (baseline[cat] ?? 0));
if (improved.length > 0) {
  console.log(
    `\nlint-tokens: below baseline on [${improved.join(', ')}] — nothing blocking, but consider ` +
    `re-running with --write-baseline to lock in the improvement.`,
  );
}
console.log(`\nlint-tokens: within baseline (${relative(REPO_ROOT, BASELINE_FILE)}) — pass.`);
process.exit(0);
