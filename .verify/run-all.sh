#!/usr/bin/env bash
# N10 Local Scenes — verification chain. Each step appends its result to
# .verify/RESULTS.md as it finishes; ALLDONE marks the end.
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
R="$ROOT/.verify/RESULTS.md"
TSC="$ROOT/node_modules/.bin/tsc"
export NODE_OPTIONS=--max-old-space-size=2048

: > "$R"
step() { echo "## $1" >> "$R"; }
verdict() { # $1 = label, $2 = exit code
  if [ "$2" -eq 0 ]; then echo "PASS: $1" >> "$R"; else echo "FAIL($2): $1" >> "$R"; fi
  echo "---" >> "$R"
}

step "build libs (tsc --build from repo root)"
"$TSC" --build > .verify/build-libs.log 2>&1; verdict "tsc --build (root libs incl. lib/db dist)" $?

step "API typecheck"
( cd artifacts/api-server && "$TSC" -p tsconfig.json --noEmit ) > .verify/api-typecheck.log 2>&1
verdict "api-server typecheck" $?

step "FE typecheck"
( cd artifacts/bow-down-visuals && "$TSC" -p tsconfig.json --noEmit ) > .verify/fe-typecheck.log 2>&1
verdict "bow-down-visuals typecheck" $?

step "scoped lane tests (API scenes)"
( cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts \
    src/routes/__tests__/scenes.test.ts src/lib/__tests__/scenes-lib.test.ts ) \
  > .verify/api-scoped.log 2>&1
verdict "API scoped scenes tests" $?
grep -E "Test Files|Tests " .verify/api-scoped.log | tail -4 >> "$R"

step "scoped lane tests (FE scenes)"
( cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts \
    src/lib/scenes.test.ts ) \
  > .verify/fe-scoped.log 2>&1
verdict "FE scoped scenes tests" $?
grep -E "Test Files|Tests " .verify/fe-scoped.log | tail -4 >> "$R"

step "full API suite"
( cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts ) \
  > .verify/api-full.log 2>&1
verdict "API full suite" $?
grep -E "Test Files|Tests " .verify/api-full.log | tail -4 >> "$R"

step "full FE suite"
( cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts ) \
  > .verify/fe-full.log 2>&1
verdict "FE full suite" $?
grep -E "Test Files|Tests " .verify/fe-full.log | tail -4 >> "$R"

echo "ALLDONE" >> "$R"
