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
FAIL(1): API full chunk routes
---
[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 31 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m269 passed[39m[22m[90m (271)[39m
[2m      Tests [22m [1m[31m31 failed[39m[22m[2m | [22m[1m[32m2742 passed[39m[22m[90m (2773)[39m
## full API suite chunk 3/3: generate + middlewares + data tests
PASS: API full chunk generate/misc
---
[2m Test Files [22m [1m[32m97 passed[39m[22m[90m (97)[39m
[2m      Tests [22m [1m[32m1657 passed[39m[22m[90m (1657)[39m
## full FE suite
FAIL(1): FE full suite
---
[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 3 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
[2m Test Files [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m408 passed[39m[22m[90m (410)[39m
[2m      Tests [22m [1m[31m3 failed[39m[22m[2m | [22m[1m[32m5332 passed[39m[22m[90m (5335)[39m
ALLDONE
---
## run-3 addendum — isolated re-runs are the verdict for every run-1/run-2 failure
- operator-knowledge + operator-door-mapping (lib): PASS 70/70 — fixed by ROUTE_MATRIX/allowlist registration + KB regeneration + sourced descriptions (two-arg usePageTitle).
- lib catalog-import: PASS 27/27 — fixed by declared_city in its full-mirror pg-mem fixture.
- routes tutorials + move-home + catalog-import: PASS 47/47 — chunk-2 failures were the same fixture class, read before the fixture patch landed.
- FE public-routes + seo-share-invariants + prerender-sitemap-lockdown + scenes lib: PASS 160/160 + 4/4 — allowlist pin 46→48 with representative positives, /scenes added to sitemap.xml + SITEMAP_PUBLIC_SET.
- FE typecheck re-run after all edits: PASS.
- Net full-suite picture: API 527 files — lib 159 (2 files since fixed in isolation), routes 271 (2 files since fixed in isolation), generate/misc 97 clean; FE 410 files / 5,335 tests (3 failures since fixed in isolation). Scoped lane tests: API 18/18, FE 4/4.
ALLDONE3
