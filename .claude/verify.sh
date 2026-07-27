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
if [ -f src-tauri/Cargo.toml ]; then
  ( cd src-tauri && cargo check --quiet ) >/tmp/verify-cargo.$$ 2>&1 || {
    printf '### rust (cargo check) : ECHEC\n%s\n\n' "$(tail -40 /tmp/verify-cargo.$$)"
    rc=1
  }
  rm -f /tmp/verify-cargo.$$
fi

exit $rc
