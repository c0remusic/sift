---
name: run-sift
description: Build, launch, screenshot and drive the real Sift desktop app (Tauri v2 + WebView2). Use when asked to run Sift, start the dev app, take a screenshot of a screen, measure computed styles, open a track, or verify a UI change in the actual window rather than in a browser.
---

Sift is a Tauri v2 desktop app (Rust backend, Vite + vanilla TypeScript frontend). Most of
its frontend **never executes in a plain browser**: `frontend/main.ts` only installs the
live wiring when `__TAURI_INTERNALS__` is present, so `sift-live.ts`, `filing*.ts`,
`report-view.ts` and every IPC path exist only in the real window. A screenshot from
`npm run dev` proves nothing about them.

Drive it with **`.claude/skills/run-sift/driver.mjs`**, which launches the window with a
CDP debug port and talks to it through the repo's own `.claude/scripts/cdp.cjs`.

All paths below are relative to the repo root. Verified on Windows 10, Node 22.

## Prerequisites

Bootstrap once. `fetch-ffmpeg` downloads the bundled sidecar into `src-tauri/binaries/`
(gitignored):

```bash
npm ci && npm run fetch-ffmpeg
```

Rust toolchain is pinned by `rust-toolchain.toml` at the repo **root** (not in
`src-tauri/`). Nothing else to install on Windows.

## Run — agent path

```bash
node .claude/skills/run-sift/driver.mjs status
```

```bash
node .claude/skills/run-sift/driver.mjs launch
```

`launch` picks a free debug port (9333+), starts `tauri dev`, and waits until a CDP target
**whose title is Sift** answers. It reuses an already-running window instead of starting a
second one. A cold or interrupted Rust rebuild genuinely takes 10–25 minutes; an
incremental one is far quicker.

Reach a state where the detail pane is actually painted — this is the prerequisite for
almost any UI measurement:

```bash
node .claude/skills/run-sift/driver.mjs open-track
```

```
{ "opened": true, "queueRows": 56, "mid": 1, "zones": 2 }
```

Evaluate anything in the page, and take screenshots:

```bash
node .claude/skills/run-sift/driver.mjs eval 'JSON.stringify({rows:document.querySelectorAll(".qi[data-id]").length})'
```

```bash
node .claude/skills/run-sift/driver.mjs shot shot.png
```

Typography floor check (no text below 10px — the HIG macOS minimum the project adopted on
2026-08-05). It always reports `nbTexts` and `minPx` next to the offenders, on purpose:

```bash
node .claude/skills/run-sift/driver.mjs floor
```

```
{ "nbTexts": 177, "minPx": 10, "under10": [] }
```

Stop everything — npm parent, Vite, and the window:

```bash
node .claude/skills/run-sift/driver.mjs stop
```

## Run — human path

```bash
npm run tauri dev
```

Opens the window with hot reload. This is the project's default for visual work, and it is
useless headless: there is no debug port unless you set one at launch (see Gotchas).

## Test

⚠️ Never run these while `tauri dev` is compiling — they fight over the `target/` lock.

```bash
npx tsc --noEmit
```

```bash
npm run lint:tokens
```

```bash
npm run check:security
```

## Gotchas

- **Verify the debug port belongs to Sift.** On this machine ports **9222 and 9223 were
  both held by a different Tauri project** whose CDP answers normally. Measuring it and
  reporting the result as Sift's is a silent, total failure. `driver.mjs` only accepts a
  target whose title matches Sift; if you use `cdp.cjs` directly, check
  `curl http://127.0.0.1:<port>/json/list` first.
- **Never set the debug port in `tauri.conf.json`.** It would ship in distributed builds
  and overrides wry's own arguments. It goes in the environment at launch only:
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`.
- **Never pipe a dev server through `tail`.** `tail` buffers until EOF, which never comes,
  so the log stays empty and a running build looks dead.
- **On Windows the dev log is empty anyway.** A detached `npm` does not write into the
  inherited descriptor: `tauri-dev.log` sits at 0 bytes through a perfectly healthy
  15-minute build. Use process liveness (`cargo`/`rustc`/`sift` in `tasklist`) as the
  progress signal — that is what `driver.mjs` does.
- **Stopping kills three processes, not one.** The npm parent, the orphan Vite on 5173
  (which then blocks the next launch), and the WebView2 window that keeps holding the debug
  port. Kill only the parent and `status` still reports *running*. Always by exact PID —
  never `taskkill /IM node.exe`, other projects on this machine use node.
- **An empty measurement is not a pass.** Filtering for offenders returns `[]` both when a
  screen is compliant and when nothing was painted. Every check must carry a positive count
  (`nbTexts`, `minPx`). This produced three false "conformant" results before being caught.
- **Clicking a queue row does not mean the track opened.** `#mid` stays empty for seconds
  while the report loads. Poll `childElementCount`, never trust the click returning.
- **`cdp.cjs open-track` fails on the live DOM** — it returns
  `{"firstTrackFound":false}`. Use `driver.mjs open-track`, which reloads first and polls.
- **`frontend/app.js` is a mockup that runs in production.** It is imported
  unconditionally. Clicking *its* mode toggle repaints the mockup **over** the live view,
  with demo tracks (Mr. Fingers, Chez Damier…). If you see those names, you are driving the
  mockup. Reload and use the real path.
- **Git Bash mangles `tasklist /FI`** into a path via MSYS conversion. Use the PowerShell
  tool for Windows process queries.
- **`src-tauri/fixtures/*` is gitignored.** On a fresh clone the `analysis::decode` tests
  fail with *file not found* — not a real bug. Regenerate:
  `node scripts/make-fixtures.mjs`.
- **`.claude/*` is gitignored** with a narrow whitelist. This skill is re-allowed
  explicitly in `.gitignore`; a new file elsewhere under `.claude/` is invisible to git by
  default, silently.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `status` says `running: false` right after `launch` | Rust still compiling. `tasklist \| grep -i cargo` — if processes are there, wait; a cold rebuild reaches 25 min. |
| `no free debug port in 9333..9359` | Another Tauri project is squatting the range. Pass one explicitly: `--port 9400`. |
| `open-track` exits with *no queue rows* | The library is empty or still scanning. Add a source folder on Accueil first — the OS folder picker is native and cannot be driven by CDP. |
| `open-track` exits with *track never painted* | Analysis is slow on a cold cache (`analyze_path` runs the decode + FFT inline, synchronously). Retry, or pick an already-analysed track. |
| `floor` exits non-zero with `nbTexts: 0` | Nothing was painted — the result is meaningless. Run `open-track` or navigate to a screen first. |
| `launch` reports *the launch died silently* | The build failed with an empty log. Run `npm run tauri dev` in the foreground to see the real error. |
