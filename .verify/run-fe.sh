#!/usr/bin/env bash
# Continuation: the main chain's shell died after the full API suite
# completed (its summary — 527 files / 6,516 tests passed — is in
# RESULTS.md above) but before recording its exit line. This run
# records that line from the in-file summary and runs the FE suite.
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
R="$ROOT/.verify/RESULTS.md"
echo "full-api-suite: exit=0 (summary in file above: Test Files 527 passed, Tests 6516 passed; chain shell died before recording — continuation run-fe.sh)" >> "$R"
echo "== full FE suite ==" >> "$R"
(cd artifacts/bow-down-visuals && ./node_modules/.bin/vitest run --config vitest.config.ts) >> "$R" 2>&1
echo "full-fe-suite: exit=$?" >> "$R"
echo "ALLDONE" >> "$R"
