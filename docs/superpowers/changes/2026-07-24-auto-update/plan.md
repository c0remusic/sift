# Auto-update Tauri (sans code-signing OS payant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `tauri-plugin-updater` + `tauri-plugin-process` into Sift so an
installed app can check for, download, and install updates from a GitHub
Release, using locally-generated signing keys (free, independent of any paid
OS code-signing certificate).

**Architecture:** A separate `tauri.release.conf.json` (merged only at
release-build time via `tauri build --config`) carries the updater's
`pubkey`/`endpoints` and `createUpdaterArtifacts: true`, so the routine
`build.yml` CI and local `npm run tauri build` are unaffected and need no
signing key. A new `frontend/updater.ts` checks for updates once at launch and
shows a dismissible banner. A new `.github/workflows/release.yml`, triggered
only by a `v*.*.*` tag, builds+signs+publishes the GitHub Release with
`latest.json` via `tauri-apps/tauri-action@v1.0.0`.

**Tech Stack:** Tauri v2.11.x (Rust) · `tauri-plugin-updater` 2.10.1 ·
`tauri-plugin-process` 2.3.1 · `@tauri-apps/plugin-updater` 2.10.1 ·
`@tauri-apps/plugin-process` 2.3.1 · vanilla TS frontend · GitHub Actions.

## Global Constraints

- No paid Apple Developer account, no Windows code-signing certificate, no
  custom domain — confirmed budget constraint (design.md, Contexte). Never
  introduce a step that assumes either exists.
- Release cadence is one-off/on-demand, not scheduled — never add automated
  version bumping or a periodic release trigger.
- `unwrap()`/`expect()` outside `#[cfg(test)]` is forbidden in this codebase's
  Rust (`.claude/rules/rust.md`) — fail fast with explicit error handling
  instead.
- Any string not fully owned by Sift's own code must go through `esc()`
  (`frontend/dom.ts:30`) before being interpolated into `innerHTML` — applies
  to `update.version` (GitHub Release content). Only when the destination is
  `innerHTML`: assigning to `.textContent` already escapes on its own, and
  running `esc()` first would double-encode entities.
- `build.yml` (routine CI on every push to `main`) must remain able to build
  with **zero** signing secrets present — the release-only config lives in
  `tauri.release.conf.json`, never in the base `tauri.conf.json`.
- Manifest coverage is limited to `windows-x86_64` + `darwin-aarch64` (the
  existing `build.yml:10-17` matrix) — no Linux, no Mac Intel. Do not silently
  expand or silently narrow this without updating the design doc.
- Follow existing project conventions: CSS via `var(--token)` only, never a
  hardcoded color/size (`npm run lint:tokens` enforces this in CI); no
  `border-left`/`border-right` colored accent (`CLAUDE.md` § Front — CSS).

---

### Task 1: Rust plugin registration (updater + process)

**Files:**
- Modify: `src-tauri/Cargo.toml:29-32` (add two deps after `tauri-plugin-dialog`)
- Modify: `src-tauri/src/lib.rs:77-79` (register two plugins after `tauri_plugin_os::init()`)
- Modify: `src-tauri/capabilities/default.json:8-16` (add two permissions)

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: the `tauri_plugin_updater`/`tauri_plugin_process` Rust crates
  available to the running app, and the `updater:default`/`process:default`
  capability permissions that gate the JS-side `check()`/`relaunch()` calls
  used in Task 3.

- [ ] **Step 1: Add the two Rust dependencies**

Edit `src-tauri/Cargo.toml`, in the `[dependencies]` block, right after the
`tauri-plugin-dialog` line (line 29):

```toml
tauri-plugin-dialog = "2.7.1"
tauri-plugin-updater = "2.10.1"
tauri-plugin-process = "2.3.1"
tauri-plugin-single-instance = "2"
```

- [ ] **Step 2: Verify the crates resolve**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles clean (may take a minute to fetch the two new crates).
If it fails with a version-resolution error, re-check the exact available
versions with `cargo search tauri-plugin-updater` / `cargo search
tauri-plugin-process` rather than guessing a different pin.

- [ ] **Step 3: Register the plugins in `lib.rs`**

Edit `src-tauri/src/lib.rs`, replacing lines 77-79:

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_os::init())
```

with:

```rust
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

(Order relative to `dialog`/`window-state`/`os` does not matter — only
`tauri_plugin_single_instance` at line 71 must stay first, per the existing
comment at `lib.rs:68-70`.)

- [ ] **Step 4: Add the two capability permissions**

Edit `src-tauri/capabilities/default.json`, replacing the `permissions` array:

```json
  "permissions": [
    "core:default",
    "dialog:default",
    "window-state:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "updater:default",
    "process:default"
  ]
```

- [ ] **Step 5: Full verification**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx tsc --noEmit
```
Expected: all three clean (392 passed / 6 ignored on `cargo test`, matching
the pre-existing baseline — this task adds no new Rust logic, only plugin
registration, so the count should not change).

- [ ] **Step 6: Commit**

```bash
git add -- src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(updater): register tauri-plugin-updater and tauri-plugin-process"
```

---

### Task 2: Signer keypair + release-only config override

**Files:**
- Create: `src-tauri/tauri.release.conf.json`
- Modify: `.gitignore` (ensure the private key file, if ever generated inside
  the repo tree, can never be committed)

**Interfaces:**
- Consumes: nothing (independent of Task 1's Rust changes).
- Produces: `src-tauri/tauri.release.conf.json`, containing the real
  `pubkey` generated in Step 1 — consumed by Task 4's `release.yml`
  (`--config src-tauri/tauri.release.conf.json`) and referenced by the
  private-key half in GitHub Actions secrets (never committed).

- [ ] **Step 1: Generate the signing keypair**

Run (do **not** run this inside the repo directory — write the private key
outside any git-tracked path):

```bash
npx tauri signer generate -w ~/.tauri/sift-updater.key
```

Expected output includes a public key block. Copy the **public** key content
printed to stdout (or read `~/.tauri/sift-updater.key.pub`) — that content is
what goes into `tauri.release.conf.json` below. The private key stays at
`~/.tauri/sift-updater.key` and must be pasted into a new GitHub Actions
repository secret named `TAURI_SIGNING_PRIVATE_KEY` (Settings → Secrets and
variables → Actions on `github.com/c0remusic/sift`) — if the key was
generated with a password, also add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
This is a manual one-time action outside this plan's file changes; it has no
automated test — the test for this step is that the secret exists in the
GitHub repo settings before Task 4's workflow is ever triggered by a tag.

- [ ] **Step 2: Confirm `.gitignore` already excludes local `.key` files**

Run: `grep -n "\.key" .gitignore`
Expected: if there is no existing rule, add one so a key accidentally
generated inside the repo can never be staged. Add to `.gitignore`:

```
*.key
*.key.pub
```

- [ ] **Step 3: Write `src-tauri/tauri.release.conf.json`**

Create the file with the real public key from Step 1 substituted for
`<PUBKEY-FROM-STEP-1>` (paste the exact multi-line key content as a single
JSON string, matching the format Tauri prints — no placeholder should remain
in the committed file):

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<PUBKEY-FROM-STEP-1>",
      "endpoints": [
        "https://github.com/c0remusic/sift/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

- [ ] **Step 4: Verify the JSON is well-formed and the base config is untouched**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.release.conf.json','utf8')); console.log('valid json')"
git diff --stat -- src-tauri/tauri.conf.json
```
Expected: `valid json` printed; the `git diff --stat` on `tauri.conf.json`
shows no output (confirms the base config was not touched — the whole point
of the override file).

- [ ] **Step 5: Prove the routine build path is genuinely unaffected**

This is the actual test of the Global Constraint "`build.yml` must build with
zero signing secrets" — not just an inspection of the diff. Run the exact
command `build.yml` runs, with no `--config` flag and no
`TAURI_SIGNING_PRIVATE_KEY` in the environment:

```bash
npm run tauri build
```

Expected: the build completes exactly as it did before this task (unsigned
installers in `src-tauri/target/release/bundle/`, same as documented in
`CLAUDE.md` § Commandes) — `tauri.release.conf.json` existing on disk but
never passed via `--config` must have zero effect on this build. If this
fails or starts asking for a signing key, `tauri.release.conf.json` is
leaking into the default build somehow (e.g. via a platform-specific
auto-merge naming collision) — stop and investigate before continuing, do
not paper over it.

- [ ] **Step 6: Confirm the override actually merges (dry check, no signing needed)**

The merge itself only matters at a real release build (Task 4), which
requires the private key secret from Step 1 and is not run locally here.
Skip a local `tauri build --config ...` invocation — it would fail without
`TAURI_SIGNING_PRIVATE_KEY` set locally, which is not a real bug, just an
expected missing precondition outside CI. Do not silence this by exporting
the private key locally "to test" — the key belongs only in the GitHub
secret and the maintainer's local `~/.tauri/` path.

- [ ] **Step 7: Commit**

```bash
git add -- src-tauri/tauri.release.conf.json .gitignore
git commit -m "feat(updater): add release-only Tauri config override with signing pubkey"
```

---

### Task 3: Frontend update banner

**Files:**
- Create: `frontend/updater.ts`
- Modify: `frontend/main.ts:9` (import) and `frontend/main.ts:16-17` (call at launch)
- Modify: `frontend/styles.css` (append banner rules near `.sift-toast`, line ~1171)
- Modify: `package.json:24-31` (add two `dependencies`)

**Interfaces:**
- Consumes: `esc()` from `frontend/dom.ts:30` (already exported); the
  `updater:default`/`process:default` capability permissions from Task 1
  (this task's code only works correctly once Task 1 is merged, but is
  independently `tsc`-checkable before that).
- Produces: `installUpdateBanner(): void`, called once from `main.ts` inside
  the existing `if (inTauri)` block — no other module depends on this yet.

- [ ] **Step 1: Add the two JS plugin dependencies**

Edit `package.json`, in `dependencies`, after `@tauri-apps/plugin-os`:

```json
    "@tauri-apps/plugin-dialog": "^2.7.2",
    "@tauri-apps/plugin-os": "^2.3.2",
    "@tauri-apps/plugin-process": "^2.3.1",
    "@tauri-apps/plugin-updater": "^2.10.1",
    "wavesurfer.js": "^7.12.11"
```

Run: `npm install`
Expected: `package-lock.json` updates, no errors.

- [ ] **Step 2: Write `frontend/updater.ts`**

```typescript
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { esc } from "./dom";

const BANNER_ID = "sift-update-banner";

function renderBanner(update: Update): void {
  document.getElementById(BANNER_ID)?.remove();
  const el = document.createElement("div");
  el.id = BANNER_ID;
  el.className = "sift-update-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML =
    `<span>Mise à jour ${esc(update.version)} disponible.</span>` +
    '<button data-upd="install" class="sift-update-banner-install">Installer et redémarrer</button>' +
    '<button data-upd="later" class="sift-update-banner-later">Plus tard</button>';
  document.body.appendChild(el);

  el.querySelector('[data-upd="later"]')?.addEventListener("click", () => {
    el.remove();
  });

  el.querySelector('[data-upd="install"]')?.addEventListener("click", () => {
    void installAndRelaunch(update, el);
  });
}

async function installAndRelaunch(update: Update, banner: HTMLElement): Promise<void> {
  const span = banner.querySelector("span");
  try {
    await update.downloadAndInstall();
    if (span) span.textContent = "Installation terminée, redémarrage...";
    await relaunch();
  } catch (e) {
    // .textContent, not .innerHTML — the browser escapes it on assignment, so esc() here
    // would double-encode entities (literal "&amp;" shown to the user instead of "&").
    if (span) span.textContent = `Échec de la mise à jour : ${String(e)}`;
    console.error("update install failed", e);
  }
}

/** Checks for an update once, at app launch. Called only from the `inTauri` block in
 *  main.ts — this module talks to the real updater plugin and has no meaning outside
 *  a running Tauri shell. No periodic re-check: release cadence is one-off, not
 *  scheduled (design.md, Contexte). */
export async function installUpdateBanner(): Promise<void> {
  try {
    const update = await check();
    if (update?.available) {
      renderBanner(update);
    }
  } catch (e) {
    // Silent: no network / GitHub unreachable is a normal offline case, not an error
    // worth interrupting the user for. Logged only.
    console.error("update check failed", e);
  }
}
```

- [ ] **Step 3: Wire it into `main.ts`**

Edit `frontend/main.ts`, add the import after line 9
(`import { installLiveWiring } from "./sift-live";`):

```typescript
import { installLiveWiring } from "./sift-live";
import { installUpdateBanner } from "./updater";
```

Then, inside the `if (inTauri) {` block, right after the
`installLiveWiring();` call (line 17):

```typescript
if (inTauri) {
  installLiveWiring();
  void installUpdateBanner();
  (async () => {
```

- [ ] **Step 4: Add the banner CSS**

Edit `frontend/styles.css`, right after the `.sift-toast-undo` rule (line
1171), append:

```css
.sift-update-banner{position:fixed;left:50%;top:30px;transform:translateX(-50%);z-index:var(--z-toast);display:flex;align-items:center;gap:12px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-secondary);border-radius:0 0 var(--border-radius-md) var(--border-radius-md);padding:9px 16px;font-size:var(--text-md);color:var(--color-text-primary);box-shadow:var(--shadow-toast)}
.sift-update-banner-install{font-size:var(--text-sm);padding:2px 9px}
.sift-update-banner-later{font-size:var(--text-sm);padding:2px 9px;background:transparent;color:var(--color-text-secondary)}
```

`top:30px` — not `top:0` — because the custom titlebar (`#sift-titlebar`,
`frontend/chrome.ts:108`) is a fixed 30px drag region at the very top of the
window; a `top:0` banner would sit on top of it and cover the
`data-tauri-drag-region` zones, breaking window dragging while the banner is
visible.

- [ ] **Step 5: Verify**

Run:
```bash
npm run lint:tokens
npx tsc --noEmit
```
Expected: both clean — `lint:tokens` confirms every value above resolves to
an existing token (no hardcoded color/size slipped in), `tsc` confirms the
new module and `main.ts` wiring type-check.

Manual verification (no frontend test runner in this codebase, per
`CLAUDE.md` § Vérification UI): this module only exercises real behavior
once Task 1 (capabilities) and Task 2 (real `tauri.release.conf.json`
pubkey/endpoint) are both merged and a real tagged release exists — that
end-to-end check is the design's own Test section, run once after Task 4
lands, not per-task here.

- [ ] **Step 6: Commit**

```bash
git add -- frontend/updater.ts frontend/main.ts frontend/styles.css package.json package-lock.json
git commit -m "feat(updater): add dismissible update-available banner"
```

---

### Task 4: Release CI workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  GitHub secrets (set manually in Task 2, Step 1); `src-tauri/tauri.release.conf.json`
  from Task 2.
- Produces: on a `v*.*.*` tag push, a GitHub Release with signed installers +
  `latest.json`, matching the endpoint URL baked into Task 2's config.

- [ ] **Step 1: Re-confirm the `tauri-action` version before pinning it**

The design and this plan were written against `tauri-apps/tauri-action`
`v1.0.0` (confirmed at planning time via `gh api
repos/tauri-apps/tauri-action/releases/latest` → `{"tagName":"v1.0.0", ...}`
and `gh api repos/tauri-apps/tauri-action/tags` listing both `v1.0.0` and the
floating `v1` tag). Time may have passed between planning and execution —
re-run the same command before writing Step 2's YAML:

```bash
gh api repos/tauri-apps/tauri-action/releases/latest --jq '.tag_name'
```

Expected: `v1.0.0`, or a newer tag. If it's newer, use that exact tag in
Step 2 below instead of `v1.0.0` — never keep a stale pin just because it
was what the plan originally said.

- [ ] **Step 2: Write `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            triple: x86_64-pc-windows-msvc
          - os: macos-latest
            triple: aarch64-apple-darwin
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: "src-tauri -> target"

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install npm deps
        run: npm ci

      - name: Fetch ffmpeg sidecar
        run: npm run fetch-ffmpeg

      - name: Build, sign and publish release
        uses: tauri-apps/tauri-action@v1.0.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Sift ${{ github.ref_name }}"
          releaseBody: "Voir les fichiers joints. Installation non signée : docs/install-non-signe.md."
          releaseDraft: true
          prerelease: false
          args: --config src-tauri/tauri.release.conf.json
```

(`releaseDraft: true` — the maintainer reviews and publishes manually; matches
the on-demand, non-automated release cadence from the design. **This draft
step is not cosmetic**: GitHub's `/releases/latest/` resolution — the exact
URL baked into `tauri.release.conf.json`'s `endpoints` — only ever resolves
to a **published, non-draft, non-prerelease** release. Until the maintainer
clicks "Publish release" on the GitHub UI for this draft, `check()` in every
installed app will find nothing, silently, forever. This is a required manual
step after every tag push, not an optional review — document it as such
wherever the release flow is described to the maintainer.)

- [ ] **Step 3: Verify the YAML is well-formed**

Run:
```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('valid yaml')"
```
(If `yaml` is not installed: `pip install --quiet pyyaml` first — a one-off
local tool, not a project dependency.)
Expected: `valid yaml` printed.

- [ ] **Step 4: Verify `build.yml` is untouched**

Run: `git diff --stat -- .github/workflows/build.yml`
Expected: no output — confirms the routine CI workflow was not touched by
this task (Global Constraints: `build.yml` must keep building with zero
signing secrets).

- [ ] **Step 5: Commit**

```bash
git add -- .github/workflows/release.yml
git commit -m "ci: add tag-triggered release workflow (signed updater artifacts)"
```

---

### Task 5: Unsigned-install documentation

**Files:**
- Create: `docs/install-non-signe.md`
- Modify: `README.md` (add a reference near "Lancer l'app (dev)")
- Modify: `docs/INDEX.json` (add the new doc's entry, per `CLAUDE.md`'s
  "same-gesture" convention)

**Interfaces:**
- Consumes: nothing (pure documentation, no code dependency on other tasks).
- Produces: `docs/install-non-signe.md`, linked from `README.md` and indexed
  in `docs/INDEX.json`.

- [ ] **Step 1: Write `docs/install-non-signe.md`**

```markdown
# Installer Sift (build non signé)

Sift n'a pas encore de certificat de signature de code Windows ni de compte
Apple Developer (notarization macOS) — voir
`docs/superpowers/changes/2026-07-24-auto-update/design.md` pour le contexte.
Le premier lancement d'un installeur télécharché déclenche donc un
avertissement de l'OS. Ces étapes ne sont nécessaires qu'à la **première**
installation manuelle — les mises à jour suivantes passent par l'auto-update
intégré à l'app.

## Windows

1. Double-cliquer l'installeur (`.exe` ou `.msi`) téléchargé.
2. Windows SmartScreen affiche « Windows a protégé votre ordinateur ».
3. Cliquer **Informations complémentaires**, puis **Exécuter quand même**.

## macOS

1. Ouvrir le `.dmg`, glisser Sift dans Applications.
2. Un double-clic normal affiche « Sift ne peut pas être ouvert car il
   provient d'un développeur non identifié » et bloque le lancement.
3. Clic droit (ou Ctrl+clic) sur Sift.app dans Applications → **Ouvrir** →
   confirmer **Ouvrir** dans la boîte de dialogue. Nécessaire une seule fois.
4. Alternative en ligne de commande, si l'étape 3 ne débloque pas :
   `xattr -d com.apple.quarantine /Applications/Sift.app`
```

- [ ] **Step 2: Reference it from the README**

Read `README.md` around the "Lancer l'app (dev)" section first to find the
exact current heading text, then add, right after that section's closing
line, a new subsection:

```markdown
## Installer (utilisateur final)

Un premier lancement affiche un avertissement Windows SmartScreen ou macOS
Gatekeeper (build non signé) — voir
[`docs/install-non-signe.md`](docs/install-non-signe.md) pour le contourner.
Nécessaire une seule fois ; les mises à jour suivantes sont automatiques.
```

- [ ] **Step 3: Add the `docs/INDEX.json` entry**

Edit `docs/INDEX.json`, in the `reference` array, add (as the last entry
before the array's closing `]`):

```json
    {"path": "docs/install-non-signe.md", "topic": "installation utilisateur final (build non signé)", "summary": "Instructions de contournement SmartScreen (Windows) et Gatekeeper (macOS) pour le premier install manuel, tant qu'il n'y a pas de certificat de signature payant. Référencé depuis le README."}
```

- [ ] **Step 4: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('docs/INDEX.json','utf8')); console.log('valid json')"`
Expected: `valid json` printed (confirms the added entry didn't break the
JSON structure — a trailing/missing comma is the common mistake here).

- [ ] **Step 5: Commit**

```bash
git add -- docs/install-non-signe.md README.md docs/INDEX.json
git commit -m "docs: unsigned-install instructions for Windows/macOS"
```

---

## Post-implementation verification (manual, not a coded task)

Once Tasks 1-5 are merged, in this order:

1. **Bump the version first** — a tag matching the currently-installed
   version can never show as an update: `check()` compares the running app's
   own `current_version` against the tag's version, so testing requires a
   *higher* version than whatever was last built. Bump all three files per
   `CLAUDE.md` § Outillage (`package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json`) from `0.0.1` to `0.0.2`, commit.
2. Build and install `0.0.1` (the pre-bump version) on a Windows and a macOS
   machine first — this is the "old" version the test needs to update *from*.
3. `git tag v0.0.2 && git push --tags` — triggers `release.yml`.
4. **Publish the draft release** on GitHub (Releases tab → Edit → Publish) —
   required, not optional (see the note on `releaseDraft` above). Skipping
   this step means `/releases/latest/` never resolves and the whole test
   silently finds nothing.
5. Launch the installed `0.0.1` app, confirm the banner appears at version
   `0.0.2`, click Installer, confirm relaunch on `0.0.2`.
6. Reinstall `0.0.1` and repeat, this time clicking Plus tard — confirm the
   banner dismisses without re-triggering before the next launch.
7. Note during step 5 whether Gatekeeper intervenes during the auto-update
   itself on macOS (the open risk flagged in design.md) — update the design
   doc's "Risque ouvert" section with the finding either way.
