## build libs (tsc --build from repo root)
PASS: tsc --build (root libs incl. lib/db dist)
---
## API typecheck
PASS: api-server typecheck
---
## FE typecheck
FAIL(1): bow-down-visuals typecheck
---
## scoped lane tests (API scenes)
PASS: API scoped scenes tests
---
[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m
[2m      Tests [22m [1m[32m18 passed[39m[22m[90m (18)[39m
## scoped lane tests (FE scenes)
PASS: FE scoped scenes tests
---
[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m4 passed[39m[22m[90m (4)[39m
## full API suite
## run-2 recovery (chunked, maxWorkers=1) — run-1 chain died mid full-API suite (environmental)
## FE typecheck (re-run after TS18047 fix b3886dc5)
PASS: bow-down-visuals typecheck (run-2)
---
## full API suite chunk 1/3: src/lib/__tests__
FAIL(1): API full chunk lib
---
[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 29 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m157 passed[39m[22m[90m (159)[39m
[2m      Tests [22m [1m[31m29 failed[39m[22m[2m | [22m[1m[32m2051 passed[39m[22m[90m (2080)[39m
## full API suite chunk 2/3: src/routes/__tests__
