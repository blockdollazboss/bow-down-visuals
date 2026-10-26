#!/bin/bash
# Community Grants (N15) verification chain — results appended as steps finish.
cd ~/workspace/bdv-wt-rem-grants
R=.verify/RESULTS.md
PNPM=~/workspace/pnpm-bin/node_modules/.bin/pnpm
export NODE_OPTIONS=--max-old-space-size=2048
echo "# Verify run $(date -Is)" >> $R

step() { echo "## $1" >> $R; }

step "build-libs (tsc --build root)"
$PNPM --filter @workspace/db run build >> .verify/libs.log 2>&1 || ./node_modules/.bin/tsc --build >> .verify/libs.log 2>&1
echo "exit=$?" >> $R

step "api-typecheck"
(cd artifacts/api-server && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit) > .verify/api-tc.log 2>&1
echo "exit=$? (log .verify/api-tc.log)" >> $R

step "fe-typecheck"
(cd artifacts/bow-down-visuals && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit) > .verify/fe-tc.log 2>&1
echo "exit=$? (log .verify/fe-tc.log)" >> $R

step "scoped-api-tests"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts src/lib/__tests__/community-grants.test.ts src/lib/__tests__/community-grants-settle.test.ts) > .verify/scoped-api.log 2>&1
echo "exit=$? (log .verify/scoped-api.log)" >> $R
grep -E "Test Files|Tests " .verify/scoped-api.log >> $R || true

step "scoped-fe-tests"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts src/pages/community-grants-wiring.test.ts src/lib/community-grants.test.ts) > .verify/scoped-fe.log 2>&1
echo "exit=$? (log .verify/scoped-fe.log)" >> $R
grep -E "Test Files|Tests " .verify/scoped-fe.log >> $R || true

step "full-api-suite"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts) > .verify/full-api.log 2>&1
echo "exit=$? (log .verify/full-api.log)" >> $R
grep -E "Test Files|Tests " .verify/full-api.log >> $R || true

step "full-fe-suite"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts) > .verify/full-fe.log 2>&1
echo "exit=$? (log .verify/full-fe.log)" >> $R
grep -E "Test Files|Tests " .verify/full-fe.log >> $R || true

echo "ALLDONE" >> $R
