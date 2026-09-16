#!/usr/bin/env bash
# Runs cargo against src-tauri with an isolated CARGO_TARGET_DIR, so it never
# touches the target/ dir a concurrent `npm run tauri dev` depends on —
# running cargo build/test/clippy on the shared target/ while tauri dev is
# active corrupts its incremental cache (see CLAUDE.md, memory
# avoid-concurrent-cargo-tauri-dev).
#
# Usage: scripts/cargo-isolated.sh test --lib rekordbox_masterdb
#        scripts/cargo-isolated.sh clippy --all-targets -- -D warnings
#        SIFT_ISOLATED_TARGET_DIR=/some/other/dir scripts/cargo-isolated.sh build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_TARGET_DIR="${LOCALAPPDATA:-$HOME/AppData/Local}/Temp/claude/sift-cargo-isolated-target"
# `SIFT_ISOLATED_TARGET_DIR` is the ONLY override point, and it has no caller in the repo (grep,
# 2026-09-16): a hand-typed escape hatch, documented in the Usage block above — kept deliberately,
# not dead configuration. The export below is UNCONDITIONAL, so a `CARGO_TARGET_DIR` the caller
# sets under THAT name is discarded here.
export CARGO_TARGET_DIR="${SIFT_ISOLATED_TARGET_DIR:-$DEFAULT_TARGET_DIR}"
mkdir -p "$CARGO_TARGET_DIR"

cd "$REPO_ROOT/src-tauri"
exec cargo "$@"
