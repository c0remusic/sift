# UX audit fixes (F1-F6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 concrete findings from `docs/superpowers/changes/2026-07-18-ux-user-flow/audit-heuristique-visuel.md` (F1 contrast, F2 raw OS error, F3 Rekordbox contradictory sync status, F4 misleading empty-queue label, F5 dead "Clé USB" nav toast, F6 stale `content.md` vocabulary) while preserving app-wide homogeneity.

**Architecture:** Every fix lands at its single source of truth, never per-screen:
- F1 → the 3 CSS token blocks in `frontend/styles.css` (`:root` light, system-dark media query, `.dark`/`[data-theme="dark"]` block) — one edit propagates to every screen that reads the token.
- F2 → the one place a file is opened for analysis (`src-tauri/src/analysis/decode.rs::open_format`) — every caller (Détail rail, Lot, spectrogram re-analyze) inherits the fix.
- F3 → a new module-level `lastLinkStatus` cache in `frontend/rekordbox-view.ts`, read by the shared `syncCardHtml` helper that all 4 sync sections already call — one helper, one new parameter, no per-section duplication.
- F4 → the existing ternary in `frontend/queue-panel.ts::renderQueueWindow`, extended with the existing `currentOpenId` module state (no new state).
- F5 → the existing nav click interception in `frontend/sift-live.ts`, changed to route to the real nav item's already-registered handler instead of a dead-end toast — no new routing mechanism.
- F6 → `docs/design-system/content.md` only, resynced to match the app's actual (already-shipped, deliberate 2026-07-10) vocabulary.

**Tech Stack:** Rust (Symphonia decode, `sift_lib`), vanilla TypeScript (no framework), CSS custom properties (OKLCH).

## Global Constraints

- Fail-fast, no silent fallback; `unwrap()`/`expect()` outside `#[cfg(test)]` forbidden (`.claude/rules/rust.md`).
- No new dependency (no `thiserror`/`anyhow`) — errors stay `Result<T, String>`.
- Interface is French; no franglais where a clear French term exists (`content.md`).
- CSS token edits must stay coherent across `:root`, the system-dark media block, and `.dark`/`[data-theme="dark"]` (CLAUDE.md § Front — CSS).
- No frontend test runner exists — verification is `npx tsc --noEmit` plus a manual/CDP check against the real `tauri dev` window (never a browser preview of `app.js` for `inTauri`-gated code).
- Never run `cargo`/`tauri dev` concurrently with another instance on this repo (`.claude/rules/rust.md`).
- Commit with an explicit pathspec (`git commit -- <files>`), never a bare `git commit`.
- Verification commands before any "done" claim: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check` for any Rust task; `npx tsc --noEmit` for any TS task.

---

### Task 1: F1 — fix text-tertiary/quaternary contrast (WCAG AA)

**Files:**
- Modify: `frontend/styles.css:24` (light `:root` block)
- Modify: `frontend/styles.css:115` (system-dark `@media` block)
- Modify: `frontend/styles.css:135` (`.dark`/`[data-theme="dark"]` block)
- Modify: `docs/design-system-states.md` (append a dated entry — see Step 5)

**Interfaces:**
- Consumes: nothing (pure token value change).
- Produces: `--color-text-tertiary` and `--color-text-quaternary` now resolve to values that pass WCAG AA (≥4.5:1) against every background token they're actually painted on (`--color-background-primary`, `--color-background-queue`, `--color-surface-raised` in light; the same three in dark). Every consumer of these two tokens (nav badges, sub-labels, mono filenames, journal timestamps, etc.) inherits the fix with no other file touched.

Computed via WCAG relative-luminance math on the real OKLCH tokens (script below, Step 1) — not eyeballed.

- [ ] **Step 1: Verify the current (failing) contrast ratios**

Create a throwaway script to confirm the failure before fixing it (this is the "red" of TDD applied to a design token — prove the defect, then prove the fix):

```bash
cat > /tmp/wcag-check.mjs << 'EOF'
function oklchToLin(L,C,H){const h=H*Math.PI/180,a=C*Math.cos(h),b=C*Math.sin(h);
 const l_=L+0.3963377774*a+0.2158037573*b,m_=L-0.1055613458*a-0.0638541728*b,s_=L-0.0894841775*a-1.2914855480*b;
 const l=l_**3,m=m_**3,s=s_**3;
 return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];}
function lum(L,C,H){const[r,g,b]=oklchToLin(L,C,H);const c=v=>Math.min(1,Math.max(0,v));return 0.2126*c(r)+0.7152*c(g)+0.0722*c(b);}
function ratio(fg,bg){const a=lum(...fg),b=lum(...bg);const hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05);}
const LIGHT_BG_PRIMARY=[0.9148,0.0109,76.59];
const tertLight=[0.6187,0.0133,79.76], quatLight=[0.7524,0.0139,82.4];
console.log("tertiary/bg-primary  :", ratio(tertLight,LIGHT_BG_PRIMARY).toFixed(2), "(need >= 4.5)");
console.log("quaternary/bg-primary:", ratio(quatLight,LIGHT_BG_PRIMARY).toFixed(2), "(need >= 4.5)");
EOF
node /tmp/wcag-check.mjs
```

Expected output:
```
tertiary/bg-primary  : 2.84 (need >= 4.5)
quaternary/bg-primary: 1.71 (need >= 4.5)
```

Both fail. This confirms F1.

- [ ] **Step 2: Edit the light `:root` block**

In `frontend/styles.css`, line 24, find:

```css
--color-text-primary:oklch(31.16% 0.0105 73.53);--color-text-secondary:oklch(45.4% 0.0145 67.45);--color-text-tertiary:oklch(61.87% 0.0133 79.76);--color-text-quaternary:oklch(75.24% 0.0139 82.4);
```

Replace with (only the two target tokens change — darker L, same C/H so the warm-gray hue is preserved):

```css
--color-text-primary:oklch(31.16% 0.0105 73.53);--color-text-secondary:oklch(45.4% 0.0145 67.45);--color-text-tertiary:oklch(46.15% 0.0133 79.76);--color-text-quaternary:oklch(50.30% 0.0139 82.4);
```

- [ ] **Step 3: Edit the two dark blocks (system-dark media query + `.dark`/`[data-theme="dark"]`)**

In `frontend/styles.css`, line 115 AND line 135 (both blocks are currently byte-identical duplicates — edit both, do not leave one behind), find:

```css
    --color-text-primary:oklch(95.9% 0.0115 77.5);--color-text-secondary:oklch(81.67% 0.0171 77.5);--color-text-tertiary:oklch(67.56% 0.0148 77.5);--color-text-quaternary:oklch(59.57% 0.0153 77.5);
```

Replace both occurrences with (lighter L, same C/H — in dark mode more luminance = more contrast against the dark surfaces):

```css
    --color-text-primary:oklch(95.9% 0.0115 77.5);--color-text-secondary:oklch(81.67% 0.0171 77.5);--color-text-tertiary:oklch(81.92% 0.0148 77.5);--color-text-quaternary:oklch(76.72% 0.0153 77.5);
```

(Note: line 115's block has no leading 2-space indent in the source at that exact spot vs line 135 — match whatever indentation each line already has; only the token values change.)

- [ ] **Step 4: Verify the new ratios pass, in both modes, against every real background**

```bash
cat > /tmp/wcag-verify.mjs << 'EOF'
function oklchToLin(L,C,H){const h=H*Math.PI/180,a=C*Math.cos(h),b=C*Math.sin(h);
 const l_=L+0.3963377774*a+0.2158037573*b,m_=L-0.1055613458*a-0.0638541728*b,s_=L-0.0894841775*a-1.2914855480*b;
 const l=l_**3,m=m_**3,s=s_**3;
 return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];}
function lum(L,C,H){const[r,g,b]=oklchToLin(L,C,H);const c=v=>Math.min(1,Math.max(0,v));return 0.2126*c(r)+0.7152*c(g)+0.0722*c(b);}
function ratio(fg,bg){const a=lum(...fg),b=lum(...bg);const hi=Math.max(a,b),lo=Math.min(a,b);return (hi+0.05)/(lo+0.05);}
const light={primary:[0.9148,0.0109,76.59],queue:[0.9239,0.0109,76.6],raised:[0.9823,0.0069,88.64]};
const dark={primary:[0.2757,0.009,77.5],raised:[0.3894,0.011,77.5]};
const tL=[0.4615,0.0133,79.76], qL=[0.5030,0.0139,82.4];
const tD=[0.8192,0.0148,77.5], qD=[0.7672,0.0153,77.5];
let fail=false;
for(const [name,bg] of Object.entries(light)){
  const rt=ratio(tL,bg), rq=ratio(qL,bg);
  console.log(`LIGHT tertiary/${name}=${rt.toFixed(2)} quaternary/${name}=${rq.toFixed(2)}`);
  if(rt<4.5||rq<4.5) fail=true;
}
for(const [name,bg] of Object.entries(dark)){
  const rt=ratio(tD,bg), rq=ratio(qD,bg);
  console.log(`DARK  tertiary/${name}=${rt.toFixed(2)} quaternary/${name}=${rq.toFixed(2)}`);
  if(rt<4.5||rq<4.5) fail=true;
}
console.log(fail ? "FAIL" : "PASS");
EOF
node /tmp/wcag-verify.mjs
```

Expected output (all ratios ≥ 4.5, last line `PASS`):
```
LIGHT tertiary/primary=5.50 quaternary/primary=4.60
LIGHT tertiary/queue=5.66 quaternary/queue=4.73
LIGHT tertiary/raised=6.73 quaternary/raised=5.63
DARK  tertiary/primary=8.45 quaternary/primary=7.07
DARK  tertiary/raised=5.50 quaternary/raised=4.60
PASS
```

- [ ] **Step 5: Document the new state in `docs/design-system-states.md`**

The file's real convention (confirmed by reading `docs/design-system-states.md`
§ "Historique des corrections") is a bold-dated paragraph, not a `##` heading —
match it exactly. Append this paragraph at the very end of the file (after its
current last paragraph, which starts "**Trouvailles mineures non corrigées...**"):

```markdown

**2026-07-18 (contraste text-tertiary/quaternary WCAG AA)** : les deux tokens
échouaient AA (2.84/1.71 en clair contre bg-primary ; 2.40 en sombre contre
surface) alors qu'ils portent du texte signifiant (sous-labels, noms de
fichier mono, horodatages du Journal) — trouvé via l'audit CDP sur l'app
réelle (`docs/superpowers/changes/2026-07-18-ux-user-flow/audit-heuristique-visuel.md`,
finding F1). Assombris en clair / éclaircis en sombre (même teinte/chroma,
`L` seul) pour atteindre ≥4.5:1 partout où ils sont réellement peints, dans
les 3 blocs de thème.
```

- [ ] **Step 6: Verify no TypeScript regression (CSS-only change, but confirm the build graph is untouched)**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/styles.css docs/design-system-states.md
git commit -m "fix(ui): darken text-tertiary/quaternary to clear WCAG AA contrast

Both tokens failed 4.5:1 against every real background in light mode
(2.84/1.71) and against the raised surface in dark mode (3.29/2.40), while
carrying meaningful text (sub-labels, mono filenames, journal timestamps).
Same hue/chroma, L adjusted only — computed via OKLCH relative-luminance
WCAG math, not eyeballed. Finding F1, audit-heuristique-visuel.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- frontend/styles.css docs/design-system-states.md
```

---

### Task 2: F6 — resync `content.md` canonical vocabulary with the shipped app

**Files:**
- Modify: `docs/design-system/content.md`

**Interfaces:**
- Consumes: nothing (docs-only).
- Produces: an accurate canonical vocabulary table that matches what the app actually renders (`frontend/filing.ts:220-221`, `frontend/batch-panel.ts:417`, `frontend/sift-live.ts` confirm the app already shipped "Convertir"/"Écarter" on 2026-07-10 after user feedback — `content.md` was never updated to match). No code changes in this task — the app is already correct; the doc was stale.

- [ ] **Step 1: Update the vocabulary table**

In `docs/design-system/content.md`, find the `## Vocabulaire Canonique` table rows:

```markdown
| Action principale | Ranger |
| Rejet | Jeter |
```

Replace with:

```markdown
| Action principale | Convertir |
| Rejet | Écarter |
```

- [ ] **Step 2: Update the verbs list**

Find:

```markdown
## Actions

Verbes preferes :

- Ranger
- Jeter
- Rechercher
- Appliquer
- Choisir
- Ouvrir
- Annuler
```

Replace with:

```markdown
## Actions

Verbes preferes :

- Convertir
- Écarter
- Rechercher
- Appliquer
- Choisir
- Ouvrir
- Annuler

Note : "Convertir" est le libelle du bouton d'action principale (remplace
"Ranger" le 2026-07-10, retour utilisateur — voir filing.ts:220). Le concept
produit reste "deplacer = encoder + ranger" (CLAUDE.md) ; ce n'est plus le
libelle affiche. "Écarter" remplace "Jeter" (meme date, filing.ts:717).
```

- [ ] **Step 3: Update the microcopy example**

Find:

```markdown
Bon usage :

- "Choisir ou Sift doit ranger ce morceau"
- "Nom final"
- "Destination manquante"
```

Replace with:

```markdown
Bon usage :

- "Choisis une destination pour convertir"
- "Nom final"
- "Destination manquante"
```

- [ ] **Step 4: Verify no other file references the stale table rows**

Run: `grep -rn "Ranger\b" docs/design-system/ frontend/*.ts`
Expected: no output referring to the action label (comments documenting the historical rename, e.g. `filing.ts:220-221`, `batch-panel.ts:417`, are fine and untouched — they're history, not live copy).

- [ ] **Step 5: Commit**

```bash
git add docs/design-system/content.md
git commit -m "docs(content): resync canonical vocabulary with the shipped app

content.md still said Ranger/Jeter; the app shipped Convertir/Écarter on
2026-07-10 after user feedback (filing.ts:220,717) and content.md was never
updated to match — found via real-app audit (finding F6,
audit-heuristique-visuel.md). No code changed: the app was already correct.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- docs/design-system/content.md
```

---

### Task 3: F2 — humanize the raw file-open error surfaced in Revue

**Files:**
- Modify: `src-tauri/src/analysis/decode.rs:33` (and its `#[cfg(test)] mod tests` block further down the same file)

**Interfaces:**
- Consumes: nothing new — `open_format(path: &str) -> Result<Box<dyn FormatReader>, String>` keeps its signature.
- Produces: the `Err(String)` it returns is now human-readable for the two failure modes users actually hit (`NotFound`, everything else), instead of leaking `std::io::Error`'s Display output (`"open failed: Le fichier spécifié est introuvable (os error 2)"`). Every caller (`probe`, `decode_pcm`, and therefore `analyze()` in `mod.rs`, and therefore both `report-view.ts:1199` and `report-view.ts:1238` which render `${esc(String(e))}` verbatim) inherits the fix with zero changes on their end.

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/analysis/decode.rs`, inside the existing `#[cfg(test)] mod tests { use super::*; ... }` block (after the existing `probe_reports_native_sample_rate` test), add:

```rust
    #[test]
    fn probe_missing_file_gives_human_readable_error() {
        let err = probe("definitely/does/not/exist_ever.flac").unwrap_err();
        assert!(
            !err.contains("os error"),
            "raw OS error leaked to the user-facing message: {err}"
        );
        assert!(
            err.contains("n'existe plus") || err.contains("introuvable"),
            "error should explain the file is missing in plain French: {err}"
        );
    }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml probe_missing_file_gives_human_readable_error -- --nocapture`
Expected: FAIL — the assertion `!err.contains("os error")` fails, because the current message is `"open failed: Le fichier spécifié est introuvable (os error 2)"`.

- [ ] **Step 3: Implement the fix**

In `src-tauri/src/analysis/decode.rs:33`, find:

```rust
    let file = File::open(path).map_err(|e| format!("open failed: {e}"))?;
```

Replace with:

```rust
    let file = File::open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "le fichier n'existe plus à cet emplacement — a-t-il été déplacé ou supprimé ?"
                .to_string()
        } else {
            format!("impossible d'ouvrir le fichier : {e}")
        }
    })?;
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml probe_missing_file_gives_human_readable_error -- --nocapture`
Expected: PASS (1 passed; 0 failed).

- [ ] **Step 5: Run the full suite + lint + fmt to confirm no regression**

Run in order:
```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```
Expected: clippy exits 0 with no warnings; test suite passes (386 tests: the prior 385 + this new one, 0 failed); fmt --check exits 0. If fmt --check reports a diff, run `cargo fmt --manifest-path src-tauri/Cargo.toml` (not `--check`) once and re-verify — do not hand-format.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/analysis/decode.rs
git commit -m "fix(analysis): humanize the file-open error shown in Revue

open_format() leaked std::io::Error's raw Display output straight to the
user (\"open failed: Le fichier spécifié est introuvable (os error 2)\"),
surfaced verbatim by report-view.ts's Échec de l'analyse banner. Distinguish
NotFound (the common real case — a file moved/deleted after detection) with
a plain-French explanation from other I/O errors. Single fix point: every
caller of open_format (probe, decode_pcm, analyze()) inherits it. Finding
F2, audit-heuristique-visuel.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- src-tauri/src/analysis/decode.rs
```

---

### Task 4: F3 — Rekordbox sync cards must not say "à jour" when the link itself is broken

**Files:**
- Modify: `frontend/rekordbox-view.ts` (add module state near line 77-79; modify `syncCardHtml` signature at line 142; modify its 4 call sites at lines 268, 374, 469, 509; set the new state inside `renderRekordboxLive` at line 517)
- Modify: `docs/design-system-states.md` (append a dated entry — see Step 5)

**Interfaces:**
- Consumes: `RekordboxLinkStatus` (already imported, already has `.error: boolean` — used today at line 165 `rekordboxCardHtml(s.error ...)`).
- Produces: `syncCardHtml(title: string, count: number, body: string, unavailable: boolean): string` — new 4th parameter. When `unavailable` is `true` and `body === ""`, the idle label reads `"indisponible"` instead of `"à jour"`. Callers that don't yet know about link status pass `false` (unchanged behavior) until wired in this task.

- [ ] **Step 1: Add module-level link-status cache**

In `frontend/rekordbox-view.ts`, near the existing module state (after line 79's `let lastPendingArtworkSyncs: PendingArtworkSync[] = [];`), add:

```typescript
/** Cached from the last renderRekordboxLive() full render — lets the 4 sync section
 *  functions (masterdbRepairsSectionHtml, metadataSyncsSectionHtml, artworkSyncsSectionHtml,
 *  playlistDuplicatesSectionHtml) know whether the XML link itself is broken, so their idle
 *  state doesn't claim "à jour" when synchronization is actually unavailable (finding F3,
 *  audit-heuristique-visuel.md). null until the first render. */
let lastLinkStatus: RekordboxLinkStatus | null = null;
```

- [ ] **Step 2: Thread the flag through `syncCardHtml`**

In `frontend/rekordbox-view.ts:142`, find:

```typescript
function syncCardHtml(title: string, count: number, body: string): string {
  const idle = body === "";
  const header =
    `<div style="display:flex;justify-content:space-between;align-items:center;${idle ? "" : "margin-bottom:6px"}">` +
    `<span style="font-size:var(--text-base);font-weight:500">${esc(title)}</span>` +
    (idle
      ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">à jour</span>`
      : `<span style="font-size:var(--text-xs);background:var(--color-background-secondary);color:var(--color-text-secondary);padding:2px 7px;border-radius:var(--border-radius-pill)">${count}</span>`) +
    `</div>`;
```

Replace with:

```typescript
function syncCardHtml(title: string, count: number, body: string, unavailable: boolean): string {
  const idle = body === "";
  const idleLabel = unavailable ? "indisponible" : "à jour";
  const header =
    `<div style="display:flex;justify-content:space-between;align-items:center;${idle ? "" : "margin-bottom:6px"}">` +
    `<span style="font-size:var(--text-base);font-weight:500">${esc(title)}</span>` +
    (idle
      ? `<span style="font-size:var(--text-xs);color:var(--color-text-tertiary)">${idleLabel}</span>`
      : `<span style="font-size:var(--text-xs);background:var(--color-background-secondary);color:var(--color-text-secondary);padding:2px 7px;border-radius:var(--border-radius-pill)">${count}</span>`) +
    `</div>`;
```

- [ ] **Step 3: Update the 4 call sites to pass the flag**

In `frontend/rekordbox-view.ts`, find each of these 4 lines and add `, lastLinkStatus?.error === true` as the 4th argument:

Line 268:
```typescript
  return `<div id="sift-rkb-masterdb-section">${syncCardHtml("Fichiers", pending.length, body)}</div>`;
```
→
```typescript
  return `<div id="sift-rkb-masterdb-section">${syncCardHtml("Fichiers", pending.length, body, lastLinkStatus?.error === true)}</div>`;
```

Line 374:
```typescript
  return `<div id="sift-rkb-mds-section">${syncCardHtml("Métadonnées", pending.length, body)}</div>`;
```
→
```typescript
  return `<div id="sift-rkb-mds-section">${syncCardHtml("Métadonnées", pending.length, body, lastLinkStatus?.error === true)}</div>`;
```

Line 469:
```typescript
  return `<div id="sift-rkb-mas-section">${syncCardHtml("Pochettes", pending.length, body)}</div>`;
```
→
```typescript
  return `<div id="sift-rkb-mas-section">${syncCardHtml("Pochettes", pending.length, body, lastLinkStatus?.error === true)}</div>`;
```

Line 509:
```typescript
  return syncCardHtml("Playlists", groups.length, rows);
```
→
```typescript
  return syncCardHtml("Playlists", groups.length, rows, lastLinkStatus?.error === true);
```

- [ ] **Step 4: Populate `lastLinkStatus` inside `renderRekordboxLive`**

In `frontend/rekordbox-view.ts:517-521`, find:

```typescript
export async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
```

Replace with (one added line, right after the successful fetch — before the `!status.linked` early return, so it's set on every successful call regardless of link state):

```typescript
export async function renderRekordboxLive(): Promise<void> {
  const content = requireEl("#content", "renderRekordboxLive");
  let status: RekordboxLinkStatus;
  try {
    status = await rekordboxStatus();
    lastLinkStatus = status;
```

- [ ] **Step 5: Document the new state in `docs/design-system-states.md`**

Same bold-dated-paragraph convention as Task 1 Step 5. Append at the very end
of the file (after the paragraph added by Task 1, if that task ran first):

```markdown

**2026-07-18 (cartes de synchro Rekordbox : "indisponible" vs "à jour")** :
les 4 cartes ("Fichiers"/"Métadonnées"/"Pochettes"/"Playlists") affichaient
"à jour" dès qu'il n'y avait rien en attente, même quand le XML lié était
illisible — contredisant le bandeau rouge "XML Rekordbox illisible"
au-dessus. Trouvé via l'audit CDP sur l'app réelle (finding F3,
audit-heuristique-visuel.md). Elles lisent désormais "indisponible" dans ce
cas, via un cache `lastLinkStatus` partagé par les 4 sections.
```

- [ ] **Step 6: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 7: Verify behaviorally against the real app (no frontend test runner exists)**

With `tauri dev` running and a Rekordbox XML link that's currently broken/unlinked (or temporarily point Réglages' Rekordbox link at a nonexistent path to force `s.error === true`), navigate to the Rekordbox page and confirm all 4 idle cards read "indisponible", not "à jour". Revert any temporary path change afterward.

- [ ] **Step 8: Commit**

```bash
git add frontend/rekordbox-view.ts docs/design-system-states.md
git commit -m "fix(rekordbox): sync cards say 'indisponible', not 'à jour', when XML link is broken

The 4 sync section cards (Fichiers/Métadonnées/Pochettes/Playlists) each
independently checked only their own pending-count via syncCardHtml, with no
awareness of the top-level link status — so they claimed everything was
synced while the red 'XML Rekordbox illisible' banner said the opposite.
Single fix: syncCardHtml takes an `unavailable` flag, fed from a new
lastLinkStatus cache set once per render. Finding F3, audit-heuristique-visuel.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- frontend/rekordbox-view.ts docs/design-system-states.md
```

---

### Task 5: F4 — distinguish "nothing left to review" from "everything's been treated"

**Files:**
- Modify: `frontend/queue-panel.ts:83-91` (`renderQueueWindow`)

**Interfaces:**
- Consumes: existing module state `currentItems: QueueItem[]`, `currentOpenId: number | null`, `queueSearchTerm: string` (all already defined in this file).
- Produces: no new exports — the empty-queue label in the rail now reads differently depending on whether a track is still open in Detail (`currentOpenId != null`, meaning the user is mid-review of the last item) vs genuinely nothing was ever in the queue.

- [ ] **Step 1: Edit the empty-queue label logic**

In `frontend/queue-panel.ts:83-91`, find:

```typescript
function renderQueueWindow(ql: HTMLElement): void {
  const items = visibleQueueItems();
  if (!items.length) {
    ql.innerHTML =
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">${
        currentItems.length && queueSearchTerm ? "Aucun morceau ne correspond." : "File vide."
      }</div>`;
    return;
  }
```

Replace with:

```typescript
function renderQueueWindow(ql: HTMLElement): void {
  const items = visibleQueueItems();
  if (!items.length) {
    // "File vide." reads as "nothing was ever here" — misleading when a track is still
    // shown in Detail (currentOpenId set) because it's the last one just treated and the
    // pane hasn't advanced away from it yet. Finding F4, audit-heuristique-visuel.md.
    const emptyLabel =
      currentItems.length && queueSearchTerm
        ? "Aucun morceau ne correspond."
        : currentOpenId != null
          ? "Tous les morceaux ont été traités."
          : "File vide.";
    ql.innerHTML =
      `<div style="font-size:var(--text-md);color:var(--color-text-tertiary);padding:6px 4px">${emptyLabel}</div>`;
    return;
  }
```

- [ ] **Step 2: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 3: Verify behaviorally against the real app**

With `tauri dev` running, process/treat every item in a small watched folder's queue down to zero remaining while a track is open in Detail mode; confirm the rail now reads "Tous les morceaux ont été traités." instead of "File vide." while the last track's detail is still shown on the right. Then close/clear the detail (or restart with a genuinely empty queue) and confirm "File vide." still shows in that case.

- [ ] **Step 4: Commit**

```bash
git add frontend/queue-panel.ts
git commit -m "fix(queue): distinguish 'all processed' from 'genuinely empty' in the rail

'File vide.' showed even while a track's full detail was still open on the
right (the last item just treated, before the pane advances away) — reading
as 'nothing to review' while something clearly was being reviewed. Use the
existing currentOpenId state to pick a more accurate label. Finding F4,
audit-heuristique-visuel.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- frontend/queue-panel.ts
```

---

### Task 6: F5 — "Clé USB" nav routes to the real feature instead of a dead-end toast

**Files:**
- Modify: `frontend/sift-live.ts:99-115` (`runNavExport`) and `:185-203` (the capture-phase click interceptor)

**Interfaces:**
- Consumes: `toast()` (from `dom.ts`, still used for the Rekordbox export path — untouched), `requireEl()` (existing helper).
- Produces: clicking the "Clé USB" nav item now navigates to the real "Formater une clé USB" card that already lives in Réglages (`frontend/reglages-view.ts:182-192`, wrapper id `#sift-reglages-usb`) instead of showing an explainer toast and going nowhere. The `runNavExport("usb", ...)` branch and its toast are removed; `runNavExport` keeps handling only the real Rekordbox export.

- [ ] **Step 1: Simplify `runNavExport` to drop the dead "usb" branch**

In `frontend/sift-live.ts:99-115`, find:

```typescript
/** Guards a single in-flight export (Rekordbox only — USB has no backend, out of M7 scope). */
let exportRunning = false;

/** Rekordbox export (real merge+rewrite via `export_rekordbox_xml`, called from the Rekordbox
 * page's "Réexporter maintenant" button — see renderRekordboxLive) and the "Clé USB" nav click
 * (still a one-click toast, index.html's `.nv-export`/`data-view="cle"` — its own brainstorm is
 * pending). USB formatting DOES have a backend (`ipc_usb.rs`/`usb_format/`) and even a UI (the
 * "Formater une clé USB" card in Réglages, below) — this toast is unrelated to that, just an
 * explainer for why the nav item itself doesn't do anything yet. */
async function runNavExport(target: "rekordbox" | "usb"): Promise<void> {
  if (target === "usb") {
    toast("Export clé USB : Rekordbox recopie lui-même une fois le XML réimporté");
    return;
  }
  if (exportRunning) return; // one export run at a time
  exportRunning = true;
```

Replace with:

```typescript
/** Guards a single in-flight Rekordbox export run. */
let exportRunning = false;

/** Rekordbox export (real merge+rewrite via `export_rekordbox_xml`, called from the Rekordbox
 * page's "Réexporter maintenant" button — see renderRekordboxLive). The "Clé USB" nav item no
 * longer routes here (finding F5, audit-heuristique-visuel.md) — it now navigates straight to
 * the real "Formater une clé USB" card in Réglages instead of showing a dead-end explainer. */
async function runNavExport(): Promise<void> {
  if (exportRunning) return; // one export run at a time
  exportRunning = true;
```

- [ ] **Step 2: Update the one remaining caller (Réexporter maintenant)**

In `frontend/sift-live.ts:451`, find:

```typescript
    } else if (handleRekordboxAction(el, act ?? "", e, () => void runNavExport("rekordbox"))) {
```

Replace with:

```typescript
    } else if (handleRekordboxAction(el, act ?? "", e, () => void runNavExport())) {
```

Confirm no other call site exists: `grep -rn "runNavExport(" frontend/*.ts` must show exactly 2 matches after this edit — the function definition itself (`async function runNavExport(): Promise<void> {`) and this one call site.

- [ ] **Step 3: Replace the dead "Clé USB" click interceptor with real navigation**

In `frontend/sift-live.ts:185-203`, find:

```typescript
  // Nav "Clé USB" is still a one-click action, not a real screen (Clé USB's own brainstorm is
  // pending — see docs/ressources-externes.md) — capture phase so this runs BEFORE app.js's own
  // bubble-phase `#pa` listener (registered first, at import time) can switch `view` to the mock
  // screen. stopPropagation() during capture halts the whole path, including that bubble-phase
  // listener. "Rekordbox" is a real page now (renderRekordboxLive, window.__siftRkb above) — its
  // click is left alone so it reaches app.js's router and navigates normally.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>('[data-view="cle"]');
      if (!exp) return;
      e.stopPropagation();
      void runNavExport("usb");
    },
    { capture: true },
  );
```

Replace with:

```typescript
  // Nav "Clé USB" has no screen of its own — the real "Formater une clé USB" card lives inside
  // Réglages (reglages-view.ts, #sift-reglages-usb). Capture phase so this runs BEFORE app.js's
  // own bubble-phase `#pa` listener (registered first, at import time) can switch `view` to its
  // mock screen; stopPropagation() during capture halts that path. Instead of the previous
  // dead-end explainer toast (finding F5, audit-heuristique-visuel.md), redirect the click to the
  // real Réglages nav item so app.js's normal router takes over, then scroll the USB card into
  // view once it's rendered.
  requireEl("#pa", "installLiveWiring").addEventListener(
    "click",
    (e) => {
      const exp = (e.target as HTMLElement).closest<HTMLElement>('[data-view="cle"]');
      if (!exp) return;
      e.stopPropagation();
      const reglagesNav = document.querySelector<HTMLElement>('[data-view="reglages"]');
      reglagesNav?.click();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById("sift-reglages-usb")?.scrollIntoView({ block: "start" });
        });
      });
    },
    { capture: true },
  );
```

- [ ] **Step 4: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: exits 0, no output. (Confirms the `runNavExport()` signature change didn't break its remaining caller.)

- [ ] **Step 5: Verify behaviorally against the real app**

With `tauri dev` running, click the "Clé USB" nav item and confirm it navigates to Réglages with the "Formater une clé USB" card scrolled into view — no toast, no staying on the previous screen.

- [ ] **Step 6: Commit**

```bash
git add frontend/sift-live.ts
git commit -m "fix(nav): 'Clé USB' routes to the real feature instead of a dead-end toast

The nav item intercepted its own click (capture phase, stopPropagation) to
show an explainer toast and go nowhere — while the real 'Formater une clé
USB' card already existed inside Réglages. Redirect the click to the real
Réglages nav item (reusing app.js's normal router) and scroll the USB card
into view. Finding F5, audit-heuristique-visuel.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- frontend/sift-live.ts
```

---

### Task 7: Catalogue this plan in `docs/INDEX.json`

**Files:**
- Modify: `docs/INDEX.json`

**Interfaces:**
- Consumes: nothing.
- Produces: an entry under `"plans"` pointing at this file, per the project convention ("à chaque nouveau document créé sous docs/ ... ajouter son entrée ici dans le même geste").

- [ ] **Step 1: Add the entry**

In `docs/INDEX.json`, find the opening of the `"plans"` array:

```json
  "plans": [
    {"path": "docs/superpowers/plans/2026-07-14-phase3-decision.md", "date": "2026-07-14", "topic": "Phase 3 — décision finale (Task 2, close la phase)",
```

Insert a new entry immediately after `"plans": [` (before the `2026-07-14-phase3-decision.md` entry), so the array starts with:

```json
  "plans": [
    {"path": "docs/superpowers/plans/2026-07-18-ux-fixes-homogeneity.md", "date": "2026-07-18", "topic": "6 UX audit fixes (F1-F6) : contraste, erreur brute, Rekordbox à jour, File vide, nav USB morte, vocabulaire content.md", "summary": "Plan à 7 tâches fixant chaque finding de audit-heuristique-visuel.md à sa source unique (jamais par écran) : F1 tokens text-tertiary/quaternary WCAG AA (styles.css, 3 blocs) ; F6 content.md resynced sur Convertir/Écarter déjà shippé (2026-07-10) ; F2 humanise l'erreur fichier-introuvable à sa source (decode.rs::open_format, TDD cargo test) ; F3 cartes de synchro Rekordbox distinguent indisponible/à jour via un cache de statut partagé (lastLinkStatus) ; F4 file d'attente distingue tout-traité de vraiment-vide via l'état currentOpenId existant ; F5 nav Clé USB route vers la vraie carte de Réglages au lieu d'un toast sans issue."},
    {"path": "docs/superpowers/plans/2026-07-14-phase3-decision.md", "date": "2026-07-14", "topic": "Phase 3 — décision finale (Task 2, close la phase)",
```

(Only the array's first element changes — every other entry in `docs/INDEX.json` is untouched.)

- [ ] **Step 2: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/INDEX.json','utf8')); console.log('valid JSON')"`
Expected: `valid JSON`

- [ ] **Step 3: Commit**

```bash
git add docs/INDEX.json
git commit -m "docs(index): catalogue the UX audit fixes implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" -- docs/INDEX.json
```