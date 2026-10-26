#!/usr/bin/env bash
# N14 Stems Player — full verification chain. Each step appends to RESULTS.md.
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
R="$ROOT/.verify/RESULTS.md"
: > "$R"
step() { echo "== $1 ==" >> "$R"; }
res() { echo "$1: exit=$2" >> "$R"; }

step "build libs (tsc --build root)"
NODE_OPTIONS=--max-old-space-size=2048 "$ROOT/node_modules/.bin/tsc" --build . >> "$R" 2>&1
res "build-libs" $?

step "API typecheck"
(cd artifacts/api-server && NODE_OPTIONS=--max-old-space-size=2048 "$ROOT/node_modules/.bin/tsc" -p tsconfig.json --noEmit) >> "$R" 2>&1
res "api-typecheck" $?

step "FE typecheck"
(cd artifacts/bow-down-visuals && NODE_OPTIONS=--max-old-space-size=2048 "$ROOT/node_modules/.bin/tsc" -p tsconfig.json --noEmit) >> "$R" 2>&1
res "fe-typecheck" $?

step "scoped lane tests (API)"
(cd artifacts/api-server && "$ROOT/node_modules/.bin/vitest" run --config vitest.config.ts src/lib/__tests__/stems-player.test.ts src/routes/__tests__/stems-player.test.ts) >> "$R" 2>&1
res "scoped-api-tests" $?

step "scoped lane tests (FE)"
(cd artifacts/bow-down-visuals && "$ROOT/node_modules/.bin/vitest" run --config vitest.config.ts src/lib/stems-player.test.ts src/lib/stems-player-source.test.ts) >> "$R" 2>&1
res "scoped-fe-tests" $?

step "full API suite"
(cd artifacts/api-server && "$ROOT/node_modules/.bin/vitest" run --config vitest.config.ts) >> "$R" 2>&1
res "full-api-suite" $?

step "full FE suite"
(cd artifacts/bow-down-visuals && "$ROOT/node_modules/.bin/vitest" run --config vitest.config.ts) >> "$R" 2>&1
res "full-fe-suite" $?

echo "ALLDONE" >> "$R"
