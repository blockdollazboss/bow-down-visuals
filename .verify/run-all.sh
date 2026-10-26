#!/bin/bash
# Wave-4 #46 verification chain — self-recording, detached.
cd ~/workspace/bdv-wt-rem-currency || exit 1
R=.verify/RESULTS.md
TSC=node_modules/.bin/tsc
FE=artifacts/bow-down-visuals
API=artifacts/api-server
echo "# VERIFY #46 rem-currency-display $(date -Is) head=$(git rev-parse --short HEAD)" >> $R

run() { echo "## $1" >> $R; shift; "$@" >> $R 2>&1; echo "EXIT=$? :: $1" >> $R; }

# 1. Scoped FE tests (currency + locale parity + pricing neighbours)
( cd $FE && ./node_modules/.bin/vitest run --config vitest.config.ts \
  src/lib/currency-display.test.ts \
  src/lib/locale-numeric-parity.test.ts \
  src/lib/locale-newest-surfaces.test.ts \
  src/lib/locale-waves-ar.test.ts src/lib/locale-waves-de.test.ts src/lib/locale-waves-es.test.ts \
  src/lib/locale-waves-fr.test.ts src/lib/locale-waves-hi.test.ts src/lib/locale-waves-it.test.ts \
  src/lib/locale-waves-ja.test.ts src/lib/locale-waves-ko.test.ts src/lib/locale-waves-pt.test.ts \
  src/lib/i18n-plural-categories.test.ts src/lib/i18n-plural-forms.test.ts \
  src/lib/pricing-reconcile.test.ts src/lib/honesty-copy-prices.test.ts \
  src/lib/shops.test.ts src/lib/storefront-product.test.ts src/lib/visual-bucs*.test.ts \
  ) >> $R 2>&1; echo "EXIT=$? :: scoped-fe-tests" >> $R

# 2. FE typecheck (2048 heap per brief — full-heap OOM-kills under load)
NODE_OPTIONS=--max-old-space-size=2048 $TSC -p $FE/tsconfig.json --noEmit >> $R 2>&1
echo "EXIT=$? :: fe-typecheck" >> $R

# 3. Lib typechecks (tsc -b covers lib/db dist freshness; no schema touched)
NODE_OPTIONS=--max-old-space-size=2048 $TSC --build >> $R 2>&1
echo "EXIT=$? :: libs-typecheck-build" >> $R

# 4. API typecheck
NODE_OPTIONS=--max-old-space-size=2048 $TSC -p $API/tsconfig.json --noEmit >> $R 2>&1
echo "EXIT=$? :: api-typecheck" >> $R

# 5. Full FE suite
( cd $FE && ./node_modules/.bin/vitest run --config vitest.config.ts ) >> $R 2>&1
echo "EXIT=$? :: full-fe-suite" >> $R

# 6. Full API suite
( cd $API && ./node_modules/.bin/vitest run --config vitest.config.ts ) >> $R 2>&1
echo "EXIT=$? :: full-api-suite" >> $R

echo "ALLDONE $(date -Is)" >> $R
