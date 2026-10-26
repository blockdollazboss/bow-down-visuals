#!/bin/bash
# Retry/completion chain after the 12:08 daemon restart killed run-all.sh
# during the full FE suite. Appends to the same RESULTS.md.
cd ~/workspace/bdv-wt-rem-currency || exit 1
R=.verify/RESULTS.md
TSC=node_modules/.bin/tsc
FE=artifacts/bow-down-visuals
API=artifacts/api-server
{
  echo ""
  echo "# RETRY CHAIN $(date -Is) head=$(git rev-parse --short HEAD)"
  echo "NOTE: first-run FE typecheck retry in foreground PASSED (exit 0, NODE_OPTIONS=--max-old-space-size=2048) — recorded by the lane agent; the three 137s in run 1 were system OOM kills under load ~32 (run.log 'Killed' lines)."
} >> $R

NODE_OPTIONS=--max-old-space-size=2048 $TSC --build >> $R 2>&1
echo "EXIT=$? :: libs-typecheck-build RETRY" >> $R

NODE_OPTIONS=--max-old-space-size=2048 $TSC -p $API/tsconfig.json --noEmit >> $R 2>&1
echo "EXIT=$? :: api-typecheck RETRY" >> $R

( cd $FE && ./node_modules/.bin/vitest run --config vitest.config.ts \
  src/lib/findability-nav.test.ts \
  src/lib/signature-sounds.test.ts \
  src/lib/stream-kit/background-changer.test.ts \
  src/lib/motion-pro.test.ts \
  src/components/mobile-touch-targets.test.ts \
  src/lib/ugc-ads.test.ts \
  src/lib/scheduler.test.ts \
  src/lib/commerce-pixels.test.ts \
  ) >> $R 2>&1
echo "EXIT=$? :: isolated-reruns-of-full-fe-casualties" >> $R

( cd $API && ./node_modules/.bin/vitest run --config vitest.config.ts ) >> $R 2>&1
echo "EXIT=$? :: full-api-suite RETRY" >> $R

( cd $FE && ./node_modules/.bin/vitest run --config vitest.config.ts ) >> $R 2>&1
echo "EXIT=$? :: full-fe-suite RETRY" >> $R

echo "ALLDONE2 $(date -Is)" >> $R
