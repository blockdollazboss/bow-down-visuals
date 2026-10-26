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
