#!/bin/bash
cd ~/workspace/bdv-wt-rem-clearance || exit 1
export NODE_OPTIONS=--max-old-space-size=2048
R=.verify/RESULTS.md
echo "== full FE suite (re-run after process kill) ==" >> "$R"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1
echo "full-fe exit=$?" >> "$R"
echo "ALLDONE $(date -u +%FT%TZ)" >> "$R"
