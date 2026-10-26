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
(cd artifacts/api-server && ./node_modules/.bin/tsc -p tsconfig.json --noEmit) >> "$R" 2>&1; echo "api-typecheck exit=$?" >> "$R"

step "FE typecheck"
(cd artifacts/bow-down-visuals && ../../node_modules/.bin/tsc -p tsconfig.json --noEmit) >> "$R" 2>&1; echo "fe-typecheck exit=$?" >> "$R"

step "scoped lane tests (api)"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts src/lib/__tests__/sample-clearance.test.ts src/routes/__tests__/sample-clearance-routes.test.ts) >> "$R" 2>&1; echo "scoped-api exit=$?" >> "$R"

step "scoped lane tests (fe)"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts src/components/sample-clearance/sample-clearance-wiring.test.ts) >> "$R" 2>&1; echo "scoped-fe exit=$?" >> "$R"

step "full API suite"
(cd artifacts/api-server && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1; echo "full-api exit=$?" >> "$R"

step "full FE suite"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1; echo "full-fe exit=$?" >> "$R"

echo "ALLDONE $(date -u +%FT%TZ)" >> "$R"
