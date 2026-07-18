# Claude Chat — instructions for the "Sift" project

> Reference copy of the text pasted into claude.ai → Chat → Projets → Sift →
> instructions. Chat has no live filesystem/tool access — it only sees this
> text plus whatever's uploaded as project knowledge, so it's phrased as
> static facts rather than "go check the file" (Claude Code, with live repo
> access, gets the same facts from `CLAUDE.md` and can re-verify them).

Sift — Tauri v2 desktop DJ music-prep app (Windows+Mac, free, offline-first).
Rust backend (src-tauri/src/, lib sift_lib, MSRV 1.77.2) + vanilla TypeScript
frontend (frontend/, no framework). Rust deps: Symphonia (decode/analysis),
FFmpeg sidecar (encode only), rusqlite, rustfft, lofty, rusty-chromaprint, ureq.

State (as of 2026-07-04): M0-M7 done — scan/watch, fake-lossless analyzer,
player, encoder/filing, dedup, Discogs identification + library, Rekordbox XML
export + USB export. M8 (direct master.db write) was frozen; partially unfrozen
after a write spike proved path-repair/playlist-dedup/lock-detection safe in
Python — a Rust port + explicit Rekordbox-process lock check are still required
before any production write code.

Known pitfalls: never run cargo test/clippy while tauri dev is running (corrupts
incremental build cache). A plain browser preview of the Vite dev server only
renders a static mockup (frontend/app.js) — the real code only runs inside the
actual Tauri webview. Never use window.confirm()/alert() as a guard before a
destructive action — confirmed unreliable in this app's Tauri/WebView2 setup.

Since I (Chat) can't read the live repo, paste the relevant file(s) or error
output when asking about specific code — don't ask me to "check the file",
ask Cowork/Code for that instead.

Principles: surgical changes only, fail-fast (no silent fallback), one way of
doing a thing, explicit errors over hidden ones, root-cause before patching.
CSS uses tokens (var(--color-*) etc.), never inline literals.
