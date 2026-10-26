#!/bin/bash
# Verification chain for stack200/rem-top-supporter (Wave-4 #49 + N6).
# Self-recording: appends results to .verify/RESULTS.md, ends with ALLDONE.
cd ~/workspace/bdv-wt-rem-supporter || exit 1
R=.verify/RESULTS.md
TSC=~/workspace/bdv-wt-rem-supporter/node_modules/.bin/tsc
VITEST_API=~/workspace/bdv-wt-rem-supporter/artifacts/api-server/node_modules/.bin/vitest
VITEST_FE=~/workspace/bdv-wt-rem-supporter/artifacts/bow-down-visuals/node_modules/.bin/vitest
export NODE_OPTIONS=--max-old-space-size=2048

echo "=== run-all started $(date -u +%FT%TZ) ===" >> $R

echo "--- lib/db dist rebuild (tsc -b .) ---" >> $R
(cd lib/db && $TSC -b . >> ../../$R 2>&1); echo "db_build_exit=$?" >> $R

echo "--- API typecheck ---" >> $R
(cd artifacts/api-server && $TSC -p tsconfig.json --noEmit >> ../../$R 2>&1); echo "api_typecheck_exit=$?" >> $R

echo "--- FE typecheck ---" >> $R
(cd artifacts/bow-down-visuals && $TSC -p tsconfig.json --noEmit >> ../../$R 2>&1); echo "fe_typecheck_exit=$?" >> $R

echo "--- API scoped tests: supporter-board ---" >> $R
(cd artifacts/api-server && $VITEST_API run --config vitest.config.ts --maxWorkers=1 src/lib/__tests__/supporter-board.test.ts >> ../../$R 2>&1); echo "api_scoped_exit=$?" >> $R

echo "--- FE scoped tests: supporter-board ---" >> $R
(cd artifacts/bow-down-visuals && $VITEST_FE run --config vitest.config.ts --maxWorkers=1 src/lib/supporter-board.test.ts >> ../../$R 2>&1); echo "fe_scoped_exit=$?" >> $R

echo "--- API full suite ---" >> $R
(cd artifacts/api-server && $VITEST_API run --config vitest.config.ts --maxWorkers=1 >> ../../$R 2>&1); echo "api_full_exit=$?" >> $R

echo "--- FE full suite ---" >> $R
(cd artifacts/bow-down-visuals && $VITEST_FE run --config vitest.config.ts --maxWorkers=1 >> ../../$R 2>&1); echo "fe_full_exit=$?" >> $R

echo "ALLDONE $(date -u +%FT%TZ)" >> $R
