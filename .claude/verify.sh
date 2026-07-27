#!/usr/bin/env bash
# Gate de verification deterministe consommee par le hook Stop global
# (~/.claude/stop-verify.sh). Sortie non-zero = le tour est bloque et cette
# sortie est reinjectee. C'est la mise en oeuvre de la regle C1 : « terminé =
# démontrable », cote machine plutot que cote discipline.
#
# CONTRAINTE : ce script tourne a CHAQUE fin de tour. Il ne contient donc que
# des verifications rapides. Budget mesure le 2026-07-28 :
#   npx tsc --noEmit    3,4 s
#   npm run lint:tokens 0,7 s
#   cargo check         2,1 s en incremental (49 s a froid, une seule fois)
# La suite de tests complete (399 cas) et `cargo test` restent hors gate : ils
# appartiennent au pre-commit (verify-gate), pas a la fin de tour.
set -u

cd "$(dirname "$0")/.." || exit 0
rc=0

run() {
  local nom="$1"; shift
  local out
  if ! out=$("$@" 2>&1); then
    printf '### %s : ECHEC\n%s\n\n' "$nom" "$(printf '%s' "$out" | tail -40)"
    rc=1
  fi
}

run "typecheck (tsc --noEmit)" npx tsc --noEmit
run "tokens (lint:tokens)" npm run -s lint:tokens

# Rust : uniquement si le crate existe. `cargo check` et non `cargo build` —
# on veut l'erreur de type, pas l'artefact.
#
# BORNE DE TEMPS obligatoire : cargo prend le lock du target dir. Si un
# `tauri dev` compile en parallele, cargo ATTEND le lock au lieu d'echouer, et
# la fin de tour serait bloquee le temps de son rebuild. Le passage a froid
# (49 s mesurees) tombe sous la meme borne. Au-dela de 25 s on abandonne la
# verification Rust pour ce tour SANS echouer : une gate de fin de tour doit
# etre rapide ou muette, jamais lente. Le filet reste le hook pre-commit, qui
# lui execute la suite complete (417 tests, 34,7 s) avec un budget de 300 s.
if [ -f src-tauri/Cargo.toml ]; then
  log=$(mktemp "${TMPDIR:-/tmp}/verify-cargo-XXXXXX")
  if command -v timeout >/dev/null 2>&1; then
    ( cd src-tauri && timeout 25 cargo check --quiet ) >"$log" 2>&1
  else
    ( cd src-tauri && cargo check --quiet ) >"$log" 2>&1
  fi
  crc=$?
  if [ "$crc" -eq 124 ]; then
    printf '### rust (cargo check) : IGNORE ce tour (>25 s, lock cargo ou build a froid)\n\n'
  elif [ "$crc" -ne 0 ]; then
    printf '### rust (cargo check) : ECHEC\n%s\n\n' "$(tail -40 "$log")"
    rc=1
  fi
  rm -f "$log"
fi

exit $rc
