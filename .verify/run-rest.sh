#!/usr/bin/env bash
# N10 verify recovery (run-2): the run-1 chain was killed mid full-API
# suite (VM-wide memory pressure from parallel lanes — api-full.log
# stops mid-stream at 16:41 with no verdict). This run finishes the
# remaining steps chunked, single-worker, appending to RESULTS.md.
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
R="$ROOT/.verify/RESULTS.md"
TSC="$ROOT/node_modules/.bin/tsc"
export NODE_OPTIONS=--max-old-space-size=2048

{
  echo "## run-2 recovery (chunked, maxWorkers=1) — run-1 chain died mid full-API suite (environmental)"
} >> "$R"

step() { echo "## $1" >> "$R"; }
verdict() {
  if [ "$2" -eq 0 ]; then echo "PASS: $1" >> "$R"; else echo "FAIL($2): $1" >> "$R"; fi
  echo "---" >> "$R"
}

step "FE typecheck (re-run after TS18047 fix b3886dc5)"
( cd artifacts/bow-down-visuals && "$TSC" -p tsconfig.json --noEmit ) > .verify/fe-typecheck2.log 2>&1
verdict "bow-down-visuals typecheck (run-2)" $?

cd artifacts/api-server
step "full API suite chunk 1/3: src/lib/__tests__"
./node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=1 src/lib/__tests__ > "$ROOT/.verify/api-full-lib.log" 2>&1
verdict "API full chunk lib" $?
grep -E "Test Files|Tests " "$ROOT/.verify/api-full-lib.log" | tail -4 >> "$R"

step "full API suite chunk 2/3: src/routes/__tests__"
./node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=1 src/routes/__tests__ > "$ROOT/.verify/api-full-routes.log" 2>&1
verdict "API full chunk routes" $?
grep -E "Test Files|Tests " "$ROOT/.verify/api-full-routes.log" | tail -4 >> "$R"

step "full API suite chunk 3/3: generate + middlewares + data tests"
./node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=1 src/routes/generate/__tests__ src/middlewares/__tests__ src/data/__tests__ > "$ROOT/.verify/api-full-gen.log" 2>&1
verdict "API full chunk generate/misc" $?
grep -E "Test Files|Tests " "$ROOT/.verify/api-full-gen.log" | tail -4 >> "$R"
cd "$ROOT"

step "full FE suite"
( cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=1 ) \
  > .verify/fe-full.log 2>&1
verdict "FE full suite" $?
grep -E "Test Files|Tests " .verify/fe-full.log | tail -4 >> "$R"

echo "ALLDONE" >> "$R"
