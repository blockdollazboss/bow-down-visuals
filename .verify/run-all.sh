#!/bin/bash
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
