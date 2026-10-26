#!/bin/bash
# Sample Clearance Lane (N2) verification chain — self-recording.
cd ~/workspace/bdv-wt-rem-clearance || exit 1
export NODE_OPTIONS=--max-old-space-size=2048
R=.verify/RESULTS.md
echo "# Verify run $(date -u +%FT%TZ) head=$(git rev-parse --short HEAD)" >> "$R"

step() { echo "== $1 ==" >> "$R"; }

step "build-libs (tsc --build root)"
./node_modules/.bin/tsc --build 2>&1 | tail -5 >> "$R"; echo "build-libs exit=${PIPESTATUS[0]}" >> "$R"

step "API typecheck"
(cd artifacts/api-server && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit) >> "$R" 2>&1; echo "api-typecheck exit=$?" >> "$R"

step "FE typecheck"
(cd artifacts/bow-down-visuals && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit) >> "$R" 2>&1; echo "fe-typecheck exit=$?" >> "$R"

step "scoped lane tests (api)"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts src/lib/__tests__/sample-clearance.test.ts) >> "$R" 2>&1; echo "scoped-api exit=$?" >> "$R"

step "scoped lane tests (fe)"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts src/components/sample-clearance/sample-clearance-wiring.test.ts) >> "$R" 2>&1; echo "scoped-fe exit=$?" >> "$R"

step "full API suite"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1; echo "full-api exit=$?" >> "$R"

step "full FE suite"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1; echo "full-fe exit=$?" >> "$R"

echo "ALLDONE $(date -u +%FT%TZ)" >> "$R"
# Feature Verse Market (N7) verification chain — self-recording.
cd "$(dirname "$0")/.."
R=.verify/RESULTS.md
: > "$R"
step() { echo "## $1" >> "$R"; }
done_step() { echo "exit=$1" >> "$R"; }
export NODE_OPTIONS=--max-old-space-size=2048
step "build-libs"
( ./node_modules/.bin/tsc --build . ) >> .verify/build.log 2>&1; done_step $?
step "api-typecheck"
( cd artifacts/api-server && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json ) >> .verify/api-tc.log 2>&1; done_step $?
step "fe-typecheck"
( cd artifacts/bow-down-visuals && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json ) >> .verify/fe-tc.log 2>&1; done_step $?
step "scoped-lane-tests"
( cd artifacts/api-server && ./node_modules/.bin/vitest run src/lib/__tests__/feature-verse.test.ts src/routes/__tests__/feature-verse.test.ts --maxWorkers=1 ) >> .verify/scoped.log 2>&1; done_step $?
( cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run src/lib/feature-verse.test.ts --maxWorkers=1 ) >> .verify/scoped.log 2>&1; echo "fe-scoped-exit=$?" >> "$R"
step "full-api-suite"
( cd artifacts/api-server && ./node_modules/.bin/vitest run --maxWorkers=1 ) >> .verify/full-api.log 2>&1; done_step $?
step "full-fe-suite"
( cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --maxWorkers=1 ) >> .verify/full-fe.log 2>&1; done_step $?
echo "ALLDONE" >> "$R"
