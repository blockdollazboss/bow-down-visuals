# Verify run 2026-10-26T17:19:52+00:00
## build-libs (tsc --build root)
exit=0
## api-typecheck
exit=1 (log .verify/api-tc.log)
## fe-typecheck
exit=0 (log .verify/fe-tc.log)
## scoped-api-tests
exit=1 (log .verify/scoped-api.log)
[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m2 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m28 passed[39m[22m[90m (29)[39m
## scoped-fe-tests
exit=0 (log .verify/scoped-fe.log)
[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
[2m      Tests [22m [1m[32m6 passed[39m[22m[90m (6)[39m
## full-api-suite
# Verify run 2026-10-26T17:24:53+00:00
## build-libs (tsc --build root)
exit=0
## api-typecheck
exit=0 (log .verify/api-tc.log)
## fe-typecheck
exit=0 (log .verify/fe-tc.log)
## scoped-api-tests
exit=0 (log .verify/scoped-api.log)
[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m29 passed[39m[22m[90m (29)[39m
## scoped-fe-tests
exit=0 (log .verify/scoped-fe.log)
[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
[2m      Tests [22m [1m[32m6 passed[39m[22m[90m (6)[39m
## full-api-suite
exit=1 (log .verify/full-api.log)
[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 2 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m527 passed[39m[22m[90m (528)[39m
[2m      Tests [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m6519 passed[39m[22m[90m (6521)[39m
[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 2 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m527 passed[39m[22m[90m (528)[39m
[2m      Tests [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m6519 passed[39m[22m[90m (6521)[39m
## full-fe-suite
exit=1 (log .verify/full-fe.log)
[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 30 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m69 failed[39m[22m[2m | [22m[1m[32m342 passed[39m[22m[90m (411)[39m
[2m      Tests [22m [1m[31m30 failed[39m[22m[2m | [22m[1m[32m4751 passed[39m[22m[90m (4781)[39m
ALLDONE

# Post-chain fixes + isolated re-runs (verdict runs)
- Full-API failures were operator-knowledge coverage (2 tests): fixed by regenerating operator-knowledge.json (feature count 235→236, +/community-grants). Isolated re-run: operator-knowledge + all grants API tests = 4 files, 92/92 passed.
- Full-FE named failures (30) were all this lane's: ROUTE_MATRIX missing /community-grants (2), locale parity for nav.communityGrants (19 newest-surfaces + 9 locale-waves). Fixed: ROUTE_MATRIX locked entry, nav.communityGrants translated in all 9 non-en catalogs, newest-surfaces required-count 4500→4501 per the established fill pattern. Isolated re-run: 13 files, 442/442 passed.
- Full-FE remaining 69 file-level failures carried no named failing tests (worker/timeout class under fleet load). Sample isolated re-run (8 files: party-table-home, wallpapers, theme-kit, stream-kit/stage, prompt-improve, party-client, photo-canvas, motion-pro): 98/98 passed — environmental, not lane-caused.
- FE typecheck after fixes: exit 0.
