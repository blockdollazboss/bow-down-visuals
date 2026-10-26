# Verify run 2026-10-26T15:14:20Z head=ecc63098
== build-libs (tsc --build root) ==
build-libs exit=0
== API typecheck ==
.verify/run-all.sh: line 14: ./node_modules/.bin/tsc: No such file or directory
api-typecheck exit=127
== FE typecheck ==
fe-typecheck exit=0
== scoped lane tests (api) ==

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.1 [39m[90m/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server[39m

[31mNo test files found, exiting with code 1
[39m
[2mfilter: [22m[33msrc/lib/__tests__/sample-clearance.test.ts[2m, [22msrc/routes/__tests__/sample-clearance-routes.test.ts[39m
[2minclude: [22m[33msrc/**/__tests__/**/*.test.ts[39m
[2mexclude:  [22m[33m**/node_modules/**[2m, [22m**/.git/**[39m

scoped-api exit=1
== scoped lane tests (fe) ==

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.1 [39m[90m/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/bow-down-visuals[39m

[31mNo test files found, exiting with code 1
[39m
[2mfilter: [22m[33msrc/components/sample-clearance/sample-clearance-wiring.test.ts[39m
[2minclude: [22m[33msrc/**/*.test.ts[39m
[2mexclude:  [22m[33m**/node_modules/**[2m, [22m**/.git/**[39m

scoped-fe exit=1
== full API suite ==

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.1 [39m[90m/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server[39m

 [32m✓[39m src/routes/generate/__tests__/email-automations.test.ts [2m([22m[2m36 tests[22m[2m)[22m[33m 6700[2mms[22m[39m
   [32m✓[39m provisioning + API [2m(4)[22m
     [33m[2m✓[22m[39m provisions the four starters disabled, with defaults, exactly once[33m 798[2mms[22m[39m
     [33m[2m✓[22m[39m rejects unknown kinds and out-of-range patches[33m 333[2mms[22m[39m
   [32m✓[39m runner — abandoned checkout [2m(1)[22m
     [33m[2m✓[22m[39m fires once for a pending checkout that never paid; paid groups and emailless checkouts never fire[33m 361[2mms[22m[39m
   [32m✓[39m runner — no provider + per-creator isolation [2m(2)[22m
     [33m[2m✓[22m[39m two creators' automations fire only from their own shops, sales, and lists[33m 489[2mms[22m[39m
   [32m✓[39m carrier campaigns are not newsletters [2m(1)[22m
     [33m[2m✓[22m[39m stay out of campaign history and refuse manual dispatch at both doors[33m 342[2mms[22m[39m
   [32m✓[39m abandoned checkout — the runner fires the recorded expiry once [2m(6)[22m
     [33m[2m✓[22m[39m sends exactly one carrier for a recorded storefront expiry; replays and re-runs never double-send[33m 425[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/operator-knowledge.test.ts [2m([22m[2m63 tests[22m[2m)[22m[33m 2206[2mms[22m[39m
   [32m✓[39m operator knowledge — sourced facts only [2m(4)[22m
     [33m[2m✓[22m[39m every price names the registry as its source and is a whole VB figure[33m 369[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/world-room.test.ts [2m([22m[2m68 tests[22m[2m)[22m[33m 854[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/payment-reversals.test.ts [2m([22m[2m30 tests[22m[2m)[22m[33m 13735[2mms[22m[39m
   [32m✓[39m credit packs — the VB rail [2m(12)[22m
     [33m[2m✓[22m[39m a full refund claws back exactly the granted VB, with a ledger row and a completed audit row[33m 2150[2mms[22m[39m
     [33m[2m✓[22m[39m a lost dispute claws the FULL grant even though nothing was 'refunded'[33m 437[2mms[22m[39m
     [33m[2m✓[22m[39m a full reversal run twice moves BOTH balances exactly once (pack + referral legs)[33m 325[2mms[22m[39m
     [33m[2m✓[22m[39m D7 replay: pack claw landed, referral leg failed — the retry runs the referral leg only, nothing claws twice[33m 1202[2mms[22m[39m
     [33m[2m✓[22m[39m express packs (payment row keyed on the PI itself) claw back through the same lookup[33m 467[2mms[22m[39m
     [33m[2m✓[22m[39m a failed reversal marks the row failed, throws, and the retry reclaims and finishes[33m 630[2mms[22m[39m
   [32m✓[39m referral lifetime total — total_referrer_earned follows the clawback [2m(6)[22m
     [33m[2m✓[22m[39m a full refund decrements the award's referrals row by exactly the clawed amount[33m 316[2mms[22m[39m
     [33m[2m✓[22m[39m a replayed reversal decrements once — the duplicate run moves nothing[33m 350[2mms[22m[39m
     [33m[2m✓[22m[39m partial refunds decrement pro-rata; the completing refund decrements only the remainder[33m 375[2mms[22m[39m
     [33m[2m✓[22m[39m the decrement never drives the total negative — it floors at 0[33m 807[2mms[22m[39m
     [33m[2m✓[22m[39m a reversal with no referral award touches no lifetime total[33m 326[2mms[22m[39m
     [33m[2m✓[22m[39m when the referral leg lands on a Stripe retry, the decrement lands with it — once[33m 352[2mms[22m[39m
   [32m✓[39m memberships — entitlement revocation [2m(3)[22m
     [33m[2m✓[22m[39m a full refund revokes the membership and its gift row[33m 497[2mms[22m[39m
     [33m[2m✓[22m[39m a partial refund keeps the entitlement (and records that it did); completing the refund revokes[33m 613[2mms[22m[39m
   [32m✓[39m beats / digital / marketplace — access + seller ledger [2m(5)[22m
     [33m[2m✓[22m[39m a refunded exclusive license flips to 'refunded' and the beat is sellable again[33m 546[2mms[22m[39m
     [33m[2m✓[22m[39m a refunded digital sale flips status and its download links die immediately[33m 686[2mms[22m[39m
     [33m[2m✓[22m[39m a refunded digital sale revokes its license key (Wave 4 #35)[33m 718[2mms[22m[39m
     [33m[2m✓[22m[39m a refunded BUNDLE sale unwinds its series grant rows — but never the buyer's standalone purchase of the same series[33m 540[2mms[22m[39m
     [33m[2m✓[22m[39m marketplace lines flip out of 'sale' so payouts and earnings stop counting them[33m 421[2mms[22m[39m
[15:20:55.405] [31mERROR[39m (5256): [36m[distribution] release announcement failed — release stays packaged[39m
    [35mreleaseId[39m: "e56d03d5-0432-4671-98a3-8ec2bce1a7cf"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    \nparams: cfb1f977-81b7-4b99-b80e-b99ff3064e37: relation \"creator_profiles\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n      SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1\n    ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
                SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1
              
          params: cfb1f977-81b7-4b99-b80e-b99ff3064e37
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at announceRelease (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1273:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1469:5
          caused by: Error: relation "creator_profiles" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
                SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1
              ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    ",
      "params": [
        "cfb1f977-81b7-4b99-b80e-b99ff3064e37"
      ]
    }
[15:20:55.599] [31mERROR[39m (5256): [36m[distribution] release announcement failed — release stays packaged[39m
    [35mreleaseId[39m: "876f0ad9-9feb-47b5-bca9-c64e7e214878"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    \nparams: cfb1f977-81b7-4b99-b80e-b99ff3064e37: relation \"creator_profiles\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n      SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1\n    ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
                SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1
              
          params: cfb1f977-81b7-4b99-b80e-b99ff3064e37
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at announceRelease (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1273:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1469:5
          caused by: Error: relation "creator_profiles" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
                SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1
              ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    ",
      "params": [
        "cfb1f977-81b7-4b99-b80e-b99ff3064e37"
      ]
    }
[15:20:55.695] [31mERROR[39m (5256): [36m[distribution] aggregator submission failed[39m
    err: {
      "type": "Error",
      "message": "boom",
      "stack":
          Error: boom
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/__tests__/distribution.test.ts:558:70
              at file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/vitest@5.0.1_@types+node@25.9.8_vite@8.3.0_@types+node@25.9.8_esbuild@0.28.1_jiti@2.7.0_tsx@4.23.15_yaml@2.9.1_/node_modules/vitest/dist/chunks/run.C5UmxDPh.js:2783:20
    }
[15:20:55.988] [31mERROR[39m (5256): [36m[distribution] metadata generation failed[39m
    err: {
      "type": "Error",
      "message": "provider exploded",
      "stack":
          Error: provider exploded
              at Object.testState.openAiImpl (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/__tests__/distribution.test.ts:609:13)
              at Object.create (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/__tests__/distribution.test.ts:69:54)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:542:59
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:20:56.161] [31mERROR[39m (5256): [36m[distribution] metadata generation failed[39m
    err: {
      "type": "Error",
      "message": "Model returned no usable metadata",
      "stack":
          Error: Model returned no usable metadata
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:599:13
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:20:56.839] [31mERROR[39m (5256): [36m[distribution] strategy generation failed[39m
    err: {
      "type": "Error",
      "message": "provider exploded",
      "stack":
          Error: provider exploded
              at Object.testState.openAiImpl (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/__tests__/distribution.test.ts:670:13)
              at Object.create (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/__tests__/distribution.test.ts:69:54)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:640:59
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:21:08.544] [31mERROR[39m (5256): [36m[distribution] release announcement failed — release stays packaged[39m
    [35mreleaseId[39m: "cb2b0c10-3487-45a0-bddf-4e0ebc58d474"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    \nparams: cfb1f977-81b7-4b99-b80e-b99ff3064e37: relation \"creator_profiles\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n      SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1\n    ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
                SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1
              
          params: cfb1f977-81b7-4b99-b80e-b99ff3064e37
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at announceRelease (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1273:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/distribution.ts:1469:5
          caused by: Error: relation "creator_profiles" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
                SELECT id, slug FROM creator_profiles WHERE user_id = 'cfb1f977-81b7-4b99-b80e-b99ff3064e37' LIMIT 1
              ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n      SELECT id, slug FROM creator_profiles WHERE user_id = $1 LIMIT 1\n    ",
      "params": [
        "cfb1f977-81b7-4b99-b80e-b99ff3064e37"
      ]
    }
 [32m✓[39m src/routes/__tests__/distribution.test.ts [2m([22m[2m72 tests[22m[2m)[22m[33m 23137[2mms[22m[39m
   [32m✓[39m pricing constants [2m(2)[22m
     [33m[2m✓[22m[39m charges 1 credit per AI generation[33m 1295[2mms[22m[39m
   [32m✓[39m platform list [2m(2)[22m
     [33m[2m✓[22m[39m covers 9 platforms with a label for each[33m 507[2mms[22m[39m
   [32m✓[39m strategySchema [2m(2)[22m
     [33m[2m✓[22m[39m rejects an unknown platform[33m 321[2mms[22m[39m
   [32m✓[39m POST /api/distribution/releases [2m(3)[22m
     [33m[2m✓[22m[39m creates a draft release (free — no credit charge)[33m 1199[2mms[22m[39m
   [32m✓[39m GET /api/distribution/releases [2m(2)[22m
     [33m[2m✓[22m[39m returns only the caller's releases[33m 689[2mms[22m[39m
   [32m✓[39m GET /api/distribution/releases/:id [2m(1)[22m
     [33m[2m✓[22m[39m 404s for another user's release[33m 524[2mms[22m[39m
   [32m✓[39m PATCH /api/distribution/releases/:id [2m(2)[22m
     [33m[2m✓[22m[39m updates a draft[33m 794[2mms[22m[39m
   [32m✓[39m DELETE /api/distribution/releases/:id [2m(2)[22m
     [33m[2m✓[22m[39m deletes a draft[33m 477[2mms[22m[39m
     [33m[2m✓[22m[39m 409s when the release is already packaged[33m 456[2mms[22m[39m
   [32m✓[39m POST /api/distribution/releases/:id/submit [2m(7)[22m
     [33m[2m✓[22m[39m 400s when the release checklist is incomplete[33m 305[2mms[22m[39m
   [32m✓[39m barcode helpers [2m(7)[22m
     [33m[2m✓[22m[39m generate-barcode endpoint mints an internal barcode (free, draft only)[33m 312[2mms[22m[39m
     [33m[2m✓[22m[39m generate-barcode refuses to overwrite an official UPC[33m 385[2mms[22m[39m
   [32m✓[39m ISRC validation [2m(7)[22m
     [33m[2m✓[22m[39m prefills genre/isrc/cover/lyrics from the song when the wizard omits them[33m 341[2mms[22m[39m
     [33m[2m✓[22m[39m writes wizard-supplied metadata back to the song row[33m 631[2mms[22m[39m
     [33m[2m✓[22m[39m PATCH on a linked release keeps the song's metadata in step[33m 930[2mms[22m[39m
   [32m✓[39m PUT /api/distribution/releases/:id/splits [2m(5)[22m
     [33m[2m✓[22m[39m saves splits that total 100 and returns them on detail[33m 821[2mms[22m[39m
     [33m[2m✓[22m[39m versions agreements: re-saving supersedes the old version (future earnings only)[33m 601[2mms[22m[39m
   [32m✓[39m splits share links + invites [2m(2)[22m
     [33m[2m✓[22m[39m mints an idempotent share slug and serves the agreement publicly[33m 578[2mms[22m[39m
     [33m[2m✓[22m[39m records invites and fails clearly without an email provider[33m 899[2mms[22m[39m
   [32m✓[39m pre-save links [2m(5)[22m
     [33m[2m✓[22m[39m mints a slug and serves it publicly[33m 899[2mms[22m[39m
     [33m[2m✓[22m[39m refreshes a stored artwork ref for the public hero (https passes through, null stays null)[33m 1331[2mms[22m[39m
     [33m[2m✓[22m[39m serves the tracklist preview: owner titles in order, durations where stored, nothing else[33m 640[2mms[22m[39m
     [33m[2m✓[22m[39m serves an empty tracklist when the release carries no tracks[33m 613[2mms[22m[39m
   [32m✓[39m GET /api/distribution/releases/:id/platforms [2m(2)[22m
     [33m[2m✓[22m[39m returns queued statuses right after submit[33m 395[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/world-palace.test.ts [2m([22m[2m49 tests[22m[2m)[22m[33m 686[2mms[22m[39m
 [32m✓[39m src/routes/generate/__tests__/email-list-opens-honesty.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 4122[2mms[22m[39m
   [32m✓[39m subscribers stats honesty (tracked era) [2m(2)[22m
     [33m[2m✓[22m[39m reports opensTracked false + null rate before any tracked send[33m 462[2mms[22m[39m
   [32m✓[39m open/click dedupe — first signal wins [2m(4)[22m
     [33m[2m✓[22m[39m the same webhook delivered twice (provider retry) records once[33m 339[2mms[22m[39m
   [32m✓[39m segments [2m(7)[22m
     [33m[2m✓[22m[39m derives presave / member / buyer auto tags from house rows[33m 801[2mms[22m[39m
     [33m[2m✓[22m[39m sources match ANY; engagement none/opened follow recorded signals[33m 688[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/store-bundles.test.ts [2m([22m[2m26 tests[22m[2m)[22m[33m 11406[2mms[22m[39m
   [32m✓[39m GET /api/store/item/bundle/:id [2m(4)[22m
     [33m[2m✓[22m[39m itemizes contents, the bought-separately total and the honest saving[33m 514[2mms[22m[39m
   [32m✓[39m POST /api/store/checkout — bundle [2m(4)[22m
     [33m[2m✓[22m[39m charges the bundle total with the 5% fee split once, on the total[33m 403[2mms[22m[39m
[15:22:14.968] [33mWARN[39m (6143): [36mloyalty: award failed[39m
    [35muserId[39m: "user-holder"
    [35mprofileId[39m: "prof-creator"
    [35mpoints[39m: 2
    err: {
      "type": "TypeError",
      "message": "__vite_ssr_import_1__.db.insert(...).values(...).onConflictDoUpdate is not a function",
      "stack":
          TypeError: __vite_ssr_import_1__.db.insert(...).values(...).onConflictDoUpdate is not a function
              at awardLoyaltyPoints (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/loyalty.ts:65:8)
              at awardChatPoints (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/loyalty.ts:80:11)
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:22:14.986] [31mERROR[39m (6143): [36m[keyword-automations] trigger evaluation failed[39m
    err: {
      "type": "TypeError",
      "message": "Cannot read properties of undefined (reading 'filter')",
      "stack":
          TypeError: Cannot read properties of undefined (reading 'filter')
              at handleKeywordComment (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/keyword-automations.ts:298:28)
              at runNextTicks (node:internal/process/task_queues:65:5)
              at processImmediate (node:internal/timers:541:9)
    }
[15:22:15.000] [33mWARN[39m (6143): [36mloyalty: award failed[39m
    [35muserId[39m: "user-holder"
    [35mprofileId[39m: "prof-creator"
    [35mpoints[39m: 5
    err: {
      "type": "TypeError",
      "message": "__vite_ssr_import_1__.db.insert(...).values(...).onConflictDoUpdate is not a function",
      "stack":
          TypeError: __vite_ssr_import_1__.db.insert(...).values(...).onConflictDoUpdate is not a function
              at awardLoyaltyPoints (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/loyalty.ts:65:8)
              at awardTipPoints (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/loyalty.ts:92:11)
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
 [32m✓[39m src/routes/__tests__/live-tickets.test.ts [2m([22m[2m20 tests[22m[2m)[22m[33m 2486[2mms[22m[39m
   [32m✓[39m the media plane (HLS + heartbeat) [2m(4)[22m
     [33m[2m✓[22m[39m the entitled playlist carries the token into its segment lines, and segments honor it[33m 315[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/community-tier-gate.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 3862[2mms[22m[39m
   [32m✓[39m tier gate — setting the gate (channel settings, admin+) [2m(3)[22m
     [33m[2m✓[22m[39m a channel can be created gated, and the gate must be the group owner's own active tier[33m 866[2mms[22m[39m
     [33m[2m✓[22m[39m PATCH sets and clears the gate; plain members cannot touch it[33m 514[2mms[22m[39m
     [33m[2m✓[22m[39m channel managers get the owner's gate options in the list payload; members do not[33m 378[2mms[22m[39m
   [32m✓[39m tier gate — the knock door on the channel list [2m(1)[22m
     [33m[2m✓[22m[39m a gated channel is listed with what it is, its tier, and the join door — for every viewer state[33m 387[2mms[22m[39m
   [32m✓[39m tier gate — enforcement on READ [2m(3)[22m
     [33m[2m✓[22m[39m non-qualifying viewers get the knock (403 + tier_gate), never the threads[33m 420[2mms[22m[39m
[15:23:06.450] [32mINFO[39m (6510): [36m[wishlists] price-drop alerts sent[39m
    [35mitemKind[39m: "store_product"
    [35mitemId[39m: "b06a54d0-51b5-4d41-b280-a9b215679ef8"
    [35mnewPriceCents[39m: 3900
    [35malerted[39m: 1
[15:23:06.932] [32mINFO[39m (6510): [36m[wishlists] price-drop alerts sent[39m
    [35mitemKind[39m: "store_product"
    [35mitemId[39m: "b06a54d0-51b5-4d41-b280-a9b215679ef8"
    [35mnewPriceCents[39m: 3500
    [35malerted[39m: 1
 [32m✓[39m src/routes/__tests__/courses.test.ts [2m([22m[2m21 tests[22m[2m)[22m[33m 21713[2mms[22m[39m
   [32m✓[39m courses — pure helpers [2m(4)[22m
     [33m[2m✓[22m[39m lessonLock: preview always open; owner always open; non-buyer purchase-locked[33m 1370[2mms[22m[39m
   [32m✓[39m courses — creation [2m(4)[22m
     [33m[2m✓[22m[39m creating a course requires a creator profile[33m 621[2mms[22m[39m
     [33m[2m✓[22m[39m price is required and creator-set: missing or negative price is refused, $0 is a free course[33m 791[2mms[22m[39m
     [33m[2m✓[22m[39m the stored price is exactly the creator's price[33m 416[2mms[22m[39m
     [33m[2m✓[22m[39m a stranger cannot edit, publish, or rewrite someone else's course[33m 1216[2mms[22m[39m
   [32m✓[39m courses — curriculum [2m(3)[22m
     [33m[2m✓[22m[39m array order IS the order: sections and lessons come back in the order sent[33m 1109[2mms[22m[39m
     [33m[2m✓[22m[39m a text lesson without a body is refused; a foreign or unpublished video is refused[33m 1092[2mms[22m[39m
   [32m✓[39m courses — server-side content gating [2m(6)[22m
     [33m[2m✓[22m[39m the public outline NEVER carries lesson content[33m 849[2mms[22m[39m
     [33m[2m✓[22m[39m learn requires auth; a non-buyer gets preview content and NOTHING else[33m 1627[2mms[22m[39m
     [33m[2m✓[22m[39m a completed order unlocks; the drip lesson stays locked with its unlock date[33m 787[2mms[22m[39m
     [33m[2m✓[22m[39m after the drip window the lesson opens[33m 1283[2mms[22m[39m
     [33m[2m✓[22m[39m a REFUNDED order locks the course again[33m 1201[2mms[22m[39m
     [33m[2m✓[22m[39m the owner always has full access, drip included[33m 1318[2mms[22m[39m
   [32m✓[39m courses — buyer progress [2m(3)[22m
     [33m[2m✓[22m[39m progress beats derive status and the resume position only moves forward[33m 2057[2mms[22m[39m
     [33m[2m✓[22m[39m progress is refused on purchase-locked and drip-locked lessons, allowed on previews[33m 1809[2mms[22m[39m
     [33m[2m✓[22m[39m progress is per-buyer and surfaces on the learn view + My Courses shelf[33m 2004[2mms[22m[39m
   [32m✓[39m courses — wishlist price-drop alerts [2m(1)[22m
     [33m[2m✓[22m[39m a price cut in the course builder alerts a fan who wishlisted the course, once per drop; a rise stays silent[33m 1240[2mms[22m[39m
[15:23:26.849] [32mINFO[39m (6744): [36m[storefront] product created[39m
    [35muserId[39m: "95c258d3-77a0-4e93-ba47-a8474c243b27"
    [35mproductId[39m: "31f31ea1-1ff7-4c38-9cb9-96f48da9d711"
    [35mkind[39m: "digital"
[15:23:27.789] [32mINFO[39m (6744): [36m[storefront] product created[39m
    [35muserId[39m: "95c258d3-77a0-4e93-ba47-a8474c243b27"
    [35mproductId[39m: "d563d8df-bacf-4de5-bfa0-b270e6ddda90"
    [35mkind[39m: "digital"
[15:23:28.669] [32mINFO[39m (6744): [36m[storefront] product created[39m
    [35muserId[39m: "95c258d3-77a0-4e93-ba47-a8474c243b27"
    [35mproductId[39m: "d1bc2b88-7725-4f61-912a-1474e6d69486"
    [35mkind[39m: "digital"
[15:23:29.429] [33mWARN[39m (6744): [36m[api-webhooks] endpoint lookup failed; event not delivered (fail-closed)[39m
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = $1 and \"api_webhooks\".\"status\" = $2)\nparams: 95c258d3-77a0-4e93-ba47-a8474c243b27,active: relation \"api_webhooks\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = '95c258d3-77a0-4e93-ba47-a8474c243b27' and \"api_webhooks\".\"status\" = 'active');\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: select "id", "user_id", "url", "events", "secret_prefix", "secret_hash", "status", "consecutive_failures", "created_at", "disabled_at" from "api_webhooks" where ("api_webhooks"."user_id" = $1 and "api_webhooks"."status" = $2)
          params: 95c258d3-77a0-4e93-ba47-a8474c243b27,active
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at runNextTicks (node:internal/process/task_queues:65:5)
              at processImmediate (node:internal/timers:541:9)
              at file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/node-postgres/session.js:117:22
              at Object.listActiveForEvent (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/api-webhooks.ts:346:18)
              at emitWebhookEvent (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/api-webhooks.ts:540:17)
          caused by: Error: relation "api_webhooks" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: select "id", "user_id", "url", "events", "secret_prefix", "secret_hash", "status", "consecutive_failures", "created_at", "disabled_at" from "api_webhooks" where ("api_webhooks"."user_id" = '95c258d3-77a0-4e93-ba47-a8474c243b27' and "api_webhooks"."status" = 'active');
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = $1 and \"api_webhooks\".\"status\" = $2)",
      "params": [
        "95c258d3-77a0-4e93-ba47-a8474c243b27",
        "active"
      ]
    }
[15:23:29.893] [32mINFO[39m (6744): [36m[storefront] order recorded[39m
    [35msessionId[39m: "cs_fab_1"
    [35morderId[39m: "22f26a58-2394-4fdd-80a2-056e660bae78"
    [35mkind[39m: "digital"
    [35mamountCents[39m: 10000
[15:23:30.074] [33mWARN[39m (6744): [36m[storefront] upsell offer unavailable for this order[39m
    [35morderId[39m: "22f26a58-2394-4fdd-80a2-056e660bae78"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  \nparams: 22f26a58-2394-4fdd-80a2-056e660bae78: relation \"store_upsell_offers\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = '22f26a58-2394-4fdd-80a2-056e660bae78' LIMIT 1\n  ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1
            
          params: 22f26a58-2394-4fdd-80a2-056e660bae78
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at loadUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2308:13)
              at ensureUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2369:20)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:3092:21
          caused by: Error: relation "store_upsell_offers" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = '22f26a58-2394-4fdd-80a2-056e660bae78' LIMIT 1
            ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  ",
      "params": [
        "22f26a58-2394-4fdd-80a2-056e660bae78"
      ]
    }
[15:23:30.404] [32mINFO[39m (6744): [36m[storefront] verify: duplicate ignored[39m
    [35msessionId[39m: "cs_fab_1"
    [35morderId[39m: "22f26a58-2394-4fdd-80a2-056e660bae78"
[15:23:30.466] [33mWARN[39m (6744): [36m[storefront] upsell offer unavailable for this order[39m
    [35morderId[39m: "22f26a58-2394-4fdd-80a2-056e660bae78"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  \nparams: 22f26a58-2394-4fdd-80a2-056e660bae78: relation \"store_upsell_offers\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = '22f26a58-2394-4fdd-80a2-056e660bae78' LIMIT 1\n  ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1
            
          params: 22f26a58-2394-4fdd-80a2-056e660bae78
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at loadUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2308:13)
              at ensureUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2369:20)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:3092:21
          caused by: Error: relation "store_upsell_offers" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = '22f26a58-2394-4fdd-80a2-056e660bae78' LIMIT 1
            ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  ",
      "params": [
        "22f26a58-2394-4fdd-80a2-056e660bae78"
      ]
    }
[15:23:32.693] [32mINFO[39m (6744): [36mpayment reversal: applied[39m
    [35mchargeId[39m: "ch_split_store_1"
    [35mrail[39m: "storefront_order"
    [35mcreditsClawed[39m: 0
    [35mreferralClawed[39m: 0
    [35mshortfall[39m: 0
    [35mstatus[39m: "completed"
[15:23:33.689] [32mINFO[39m (6744): [36m[storefront] product created[39m
    [35muserId[39m: "95c258d3-77a0-4e93-ba47-a8474c243b27"
    [35mproductId[39m: "cdb3ffd0-c5ce-4b6c-9c03-43308e7c7675"
    [35mkind[39m: "digital"
[15:23:34.044] [33mWARN[39m (6744): [36m[api-webhooks] endpoint lookup failed; event not delivered (fail-closed)[39m
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = $1 and \"api_webhooks\".\"status\" = $2)\nparams: 95c258d3-77a0-4e93-ba47-a8474c243b27,active: relation \"api_webhooks\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = '95c258d3-77a0-4e93-ba47-a8474c243b27' and \"api_webhooks\".\"status\" = 'active');\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: select "id", "user_id", "url", "events", "secret_prefix", "secret_hash", "status", "consecutive_failures", "created_at", "disabled_at" from "api_webhooks" where ("api_webhooks"."user_id" = $1 and "api_webhooks"."status" = $2)
          params: 95c258d3-77a0-4e93-ba47-a8474c243b27,active
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at runNextTicks (node:internal/process/task_queues:65:5)
              at processImmediate (node:internal/timers:541:9)
              at file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/node-postgres/session.js:117:22
              at Object.listActiveForEvent (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/api-webhooks.ts:346:18)
              at emitWebhookEvent (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/api-webhooks.ts:540:17)
          caused by: Error: relation "api_webhooks" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: select "id", "user_id", "url", "events", "secret_prefix", "secret_hash", "status", "consecutive_failures", "created_at", "disabled_at" from "api_webhooks" where ("api_webhooks"."user_id" = '95c258d3-77a0-4e93-ba47-a8474c243b27' and "api_webhooks"."status" = 'active');
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "select \"id\", \"user_id\", \"url\", \"events\", \"secret_prefix\", \"secret_hash\", \"status\", \"consecutive_failures\", \"created_at\", \"disabled_at\" from \"api_webhooks\" where (\"api_webhooks\".\"user_id\" = $1 and \"api_webhooks\".\"status\" = $2)",
      "params": [
        "95c258d3-77a0-4e93-ba47-a8474c243b27",
        "active"
      ]
    }
[15:23:34.068] [32mINFO[39m (6744): [36m[storefront] order recorded[39m
    [35msessionId[39m: "cs_fab_1"
    [35morderId[39m: "299b8ad4-740e-4f0c-bd20-f4003eb83045"
    [35mkind[39m: "digital"
    [35mamountCents[39m: 10000
[15:23:34.091] [33mWARN[39m (6744): [36m[storefront] upsell offer unavailable for this order[39m
    [35morderId[39m: "299b8ad4-740e-4f0c-bd20-f4003eb83045"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  \nparams: 299b8ad4-740e-4f0c-bd20-f4003eb83045: relation \"store_upsell_offers\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n    SELECT * FROM store_upsell_offers WHERE parent_order_id = '299b8ad4-740e-4f0c-bd20-f4003eb83045' LIMIT 1\n  ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1
            
          params: 299b8ad4-740e-4f0c-bd20-f4003eb83045
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at loadUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2308:13)
              at ensureUpsellOffer (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:2369:20)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/storefront.ts:3092:21
          caused by: Error: relation "store_upsell_offers" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
              SELECT * FROM store_upsell_offers WHERE parent_order_id = '299b8ad4-740e-4f0c-bd20-f4003eb83045' LIMIT 1
            ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n    SELECT * FROM store_upsell_offers WHERE parent_order_id = $1 LIMIT 1\n  ",
      "params": [
        "299b8ad4-740e-4f0c-bd20-f4003eb83045"
      ]
    }
[15:23:35.053] [32mINFO[39m (6744): [36m[storefronts] checkout session created (order pending)[39m
    [35mshopId[39m: "75523ad8-187b-4309-bd55-dcb89ad98b26"
    [35mgroupId[39m: "c24e06b3-4b44-479d-b904-089ef97de9cd"
    [35msessionId[39m: "cs_shop_1"
    [35mgross[39m: 20000
[15:23:35.827] [32mINFO[39m (6744): [36m[storefronts] checkout verified — sale recorded[39m
    [35msessionId[39m: "cs_shop_1"
    [35mflipped[39m: 1
[15:23:37.144] [32mINFO[39m (6744): [36mpayment reversal: applied[39m
    [35mchargeId[39m: "ch_split_shop_1"
    [35mrail[39m: "marketplace_shop"
    [35mcreditsClawed[39m: 0
    [35mreferralClawed[39m: 0
    [35mshortfall[39m: 0
    [35mstatus[39m: "completed"
[15:23:37.549] [31mERROR[39m (6744): [36mpayment reversal: NEEDS MANUAL REVIEW — charge could not be auto-reversed; audit row written[39m
    [35mchargeId[39m: "ch_split_shop_1"
    [35mpaymentIntentId[39m: "pi_split_shop_1"
    [35mrail[39m: "unidentified"
    [35mreason[39m: "No grant record identifies this charge (no stripe_payments row for the payment intent, and no rail grant row for its checkout session)."
 [32m✓[39m src/routes/__tests__/sale-splits-rails.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 14263[2mms[22m[39m
   [32m✓[39m store rail — splits on the product [2m(3)[22m
     [33m[2m✓[22m[39m create stores the splits and presents them with seller names[33m 3444[2mms[22m[39m
     [33m[2m✓[22m[39m refuses bad lists: sum ≠ 100, owner missing, unknown co-seller[33m 449[2mms[22m[39m
     [33m[2m✓[22m[39m PATCH replaces and clears the splits[33m 698[2mms[22m[39m
   [32m✓[39m store rail — sale, earnings symmetry, refund unwinding [2m(2)[22m
     [33m[2m✓[22m[39m records both sellers off the net, moves both earnings, and a full refund unwinds both sides exactly once[33m 5171[2mms[22m[39m
     [33m[2m✓[22m[39m a product without splits sells exactly as before — no entries, full net to the owner[33m 849[2mms[22m[39m
   [32m✓[39m shop rail — splits on the product [2m(2)[22m
     [33m[2m✓[22m[39m create stores the splits; a bad list refuses[33m 547[2mms[22m[39m
     [33m[2m✓[22m[39m a paid sale records both sellers off amount − fee; a full refund reverses both, exactly once[33m 2922[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/branding-fulfillment.test.ts [2m([22m[2m24 tests[22m[2m)[22m[33m 382[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/distribution-legacy.test.ts [2m([22m[2m22 tests[22m[2m)[22m[33m 12763[2mms[22m[39m
   [32m✓[39m release landing content (smartlink) [2m(2)[22m
     [33m[2m✓[22m[39m saves video/store/socials and the public presave page carries them after release day[33m 2289[2mms[22m[39m
   [32m✓[39m spotify account pre-save [2m(3)[22m
     [33m[2m✓[22m[39m connects via OAuth and records a save ONLY after the library API confirms[33m 1092[2mms[22m[39m
     [33m[2m✓[22m[39m records nothing when the platform API fails[33m 462[2mms[22m[39m
     [33m[2m✓[22m[39m honestly refuses when there's no saveable link or no connection[33m 677[2mms[22m[39m
   [32m✓[39m split statements [2m(3)[22m
     [33m[2m✓[22m[39m allocates per payee using the agreement version effective in each period[33m 522[2mms[22m[39m
     [33m[2m✓[22m[39m period filter narrows statements[33m 679[2mms[22m[39m
     [33m[2m✓[22m[39m no recorded royalties → hasData false, no fake-zero statements[33m 310[2mms[22m[39m
   [32m✓[39m takedown/edit requests [2m(2)[22m
     [33m[2m✓[22m[39m files as requested, acknowledges, and refuses sent_to_partner without a pipe[33m 454[2mms[22m[39m
   [32m✓[39m permanence elections [2m(5)[22m
     [33m[2m✓[22m[39m records catalog + per-release elections beside succession settings[33m 558[2mms[22m[39m
     [33m[2m✓[22m[39m owner-scoping: a stranger cannot set an election on another's release, and views never leak[33m 802[2mms[22m[39m
     [33m[2m✓[22m[39m no status lock in code: an election stays changeable after the release is packaged[33m 506[2mms[22m[39m
   [32m✓[39m label roster [2m(3)[22m
     [33m[2m✓[22m[39m manager sees NO releases until the artist accepts AND grants access; then read-only[33m 849[2mms[22m[39m
   [32m✓[39m social-unlock gates [2m(3)[22m
     [33m[2m✓[22m[39m follow gate: content URL is never public and unlocks only on a real follows row[33m 693[2mms[22m[39m
     [33m[2m✓[22m[39m share gate: unlocks only after a recorded share by the signed-in fan[33m 887[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/profile-website.test.ts [2m([22m[2m25 tests[22m[2m)[22m[33m 1941[2mms[22m[39m
   [32m✓[39m #2 layout model [2m(8)[22m
     [33m[2m✓[22m[39m an untouched profile's default layout is the Grand Stage order[33m 470[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/tutorials.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 18588[2mms[22m[39m
   [32m✓[39m tutorials — designation [2m(9)[22m
     [33m[2m✓[22m[39m the catalog is public and free (no auth, no credits anywhere)[33m 2024[2mms[22m[39m
     [33m[2m✓[22m[39m an owner designates their own published video; it lists in the catalog[33m 1306[2mms[22m[39m
     [33m[2m✓[22m[39m a stranger cannot designate someone else's video[33m 554[2mms[22m[39m
     [33m[2m✓[22m[39m an unpublished video cannot be designated[33m 301[2mms[22m[39m
     [33m[2m✓[22m[39m one tutorial per video: a second designation is a 409[33m 1009[2mms[22m[39m
     [33m[2m✓[22m[39m OFFICIAL IS ADMIN-ONLY: a member marking their content official is refused[33m 428[2mms[22m[39m
     [33m[2m✓[22m[39m an admin CAN designate an official tutorial on a creator's video[33m 436[2mms[22m[39m
     [33m[2m✓[22m[39m the official flag cannot be flipped by the owner afterwards — admin only[33m 504[2mms[22m[39m
   [32m✓[39m tutorials — series, chapters, resources [2m(6)[22m
     [33m[2m✓[22m[39m series grouping keeps the server's order, not the insert order[33m 1241[2mms[22m[39m
     [33m[2m✓[22m[39m chapters: array order IS the chapter order; detail returns them in order with a next pointer[33m 757[2mms[22m[39m
     [33m[2m✓[22m[39m a stranger cannot rewrite someone else's chapters[33m 697[2mms[22m[39m
     [33m[2m✓[22m[39m resources pin to the tutorial's own chapters only[33m 872[2mms[22m[39m
     [33m[2m✓[22m[39m the profile shelf scopes the catalog to one creator[33m 1275[2mms[22m[39m
     [33m[2m✓[22m[39m unpublishing hides the tutorial from the catalog and the detail read[33m 742[2mms[22m[39m
   [32m✓[39m tutorials — fan progress + resume [2m(5)[22m
     [33m[2m✓[22m[39m a bare open is 'started'; progress requires auth[33m 853[2mms[22m[39m
     [33m[2m✓[22m[39m completing chapters moves to in_progress, then completed when all are done[33m 1030[2mms[22m[39m
     [33m[2m✓[22m[39m RESUME: a returning fan's progress read lands on their last chapter + furthest position[33m 558[2mms[22m[39m
     [33m[2m✓[22m[39m a chapter from another tutorial is refused[33m 916[2mms[22m[39m
     [33m[2m✓[22m[39m progress is per-fan: one fan's completion never leaks to another[33m 695[2mms[22m[39m
   [32m✓[39m tutorials — official seed (the production pack's pilot) [2m(3)[22m
     [33m[2m✓[22m[39m seeds the five flow-path series + the pilot with its scripted chapters, exactly once[33m 913[2mms[22m[39m
     [33m[2m✓[22m[39m plain-language search finds the pilot by a chapter title[33m 1130[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/wallpapers.test.ts [2m([22m[2m29 tests[22m[2m)[22m[33m 1162[2mms[22m[39m
[15:25:33.257] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:34.597] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:35.114] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "3c7fa1fc-c471-4c8a-968e-721fdb7af296"
    [35mamountCents[39m: 2000
[15:25:35.630] [32mINFO[39m (8192): [36m[store] verify: duplicate ignored, sale already recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "3c7fa1fc-c471-4c8a-968e-721fdb7af296"
[15:25:36.035] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "493da228-3f8f-4ace-a75d-68bc15931747"
    [35mamountCents[39m: 2000
[15:25:36.482] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:37.144] [32mINFO[39m (8192): [36m[store] sale paid in full by gift card[39m
    [35muserId[39m: "59d06eab-6041-4a77-8145-43664f60a509"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35msaleId[39m: "27071c05-8c52-417c-b6e0-83da6c73e5ea"
    [35mgiftCardAppliedCents[39m: 2000
[15:25:37.385] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:37.450] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "4dad204d-8ec1-48d3-b0f3-ca56571f34b4"
    [35mamountCents[39m: 2000
[15:25:37.752] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:38.098] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:38.190] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "e6017776-a2eb-4d8f-b9d0-db80f704ea6b"
    [35mamountCents[39m: 2000
[15:25:38.770] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "e6017776-a2eb-4d8f-b9d0-db80f704ea6b"
    [35musesLeft[39m: 4
[15:25:38.890] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "e6017776-a2eb-4d8f-b9d0-db80f704ea6b"
    [35musesLeft[39m: 3
[15:25:39.487] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:39.592] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "9371e796-c2bc-4a92-85b2-1854f3c5ec4f"
    [35mamountCents[39m: 2000
[15:25:39.821] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9371e796-c2bc-4a92-85b2-1854f3c5ec4f"
    [35musesLeft[39m: 4
[15:25:40.314] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9371e796-c2bc-4a92-85b2-1854f3c5ec4f"
    [35musesLeft[39m: 4
[15:25:40.454] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9371e796-c2bc-4a92-85b2-1854f3c5ec4f"
    [35musesLeft[39m: 3
[15:25:40.972] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:41.098] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35mamountCents[39m: 2000
[15:25:41.760] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: 4
[15:25:41.930] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: 3
[15:25:42.209] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: 2
[15:25:42.313] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: 1
[15:25:42.474] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: 0
[15:25:42.560] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "a0d33877-7c16-4800-a382-16b5742deec7"
    [35musesLeft[39m: -1
[15:25:42.940] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35mamountCents[39m: 2000
[15:25:43.178] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35musesLeft[39m: 4
[15:25:43.198] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35musesLeft[39m: 3
[15:25:43.211] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35musesLeft[39m: 2
[15:25:43.260] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35musesLeft[39m: 1
[15:25:43.327] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "9ce82cbe-b1a7-4849-b8e2-131de61ea931"
    [35musesLeft[39m: 0
[15:25:43.583] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:43.699] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "e43a6c4c-9972-4f8e-a101-eb218a41497d"
    [35mamountCents[39m: 2000
[15:25:44.284] [32mINFO[39m (8192): [36m[store] license key revoked[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkeyId[39m: "5e725753-6ee5-42cc-a0dd-aa61fabe7e67"
[15:25:45.379] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:45.470] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "47667223-0516-4200-8e70-c3593f5541e2"
    [35mamountCents[39m: 2000
[15:25:46.160] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "47667223-0516-4200-8e70-c3593f5541e2"
    [35musesLeft[39m: 4
[15:25:46.358] [32mINFO[39m (8192): [36m[store] license key re-issued[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkeyId[39m: "0b101fb8-5fde-4e9c-9edc-3e5aaa952437"
[15:25:46.726] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "47667223-0516-4200-8e70-c3593f5541e2"
    [35musesLeft[39m: 3
[15:25:46.964] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:47.175] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "eb0c7299-3dc4-4139-9e2c-253795487013"
    [35mamountCents[39m: 2000
[15:25:48.585] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:48.594] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "7ce16a8a-d8f6-469e-b6be-da1be4d15e54"
    [35mamountCents[39m: 2000
[15:25:49.653] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:49.761] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "d2abbf36-762a-4d4b-bea5-d6c71269a03e"
    [35mamountCents[39m: 2000
[15:25:50.147] [32mINFO[39m (8192): [36m[store] download served[39m
    [35msaleId[39m: "d2abbf36-762a-4d4b-bea5-d6c71269a03e"
    [35musesLeft[39m: 4
[15:25:50.480] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
[15:25:50.544] [32mINFO[39m (8192): [36m[store] digital sale recorded[39m
    [35msessionId[39m: "cs_test_1"
    [35msaleId[39m: "0e862a85-a16d-49bd-b610-02e2711498df"
    [35mamountCents[39m: 2000
[15:25:51.001] [32mINFO[39m (8192): [36m[store] license settings updated[39m
    [35muserId[39m: "f6dffec6-9998-4fd9-bfeb-adb77bf5d261"
    [35mkind[39m: "track"
    [35mid[39m: "71b3103c-100b-4100-971d-35d3fa0367a8"
    [35mlicenseKeysEnabled[39m: true
 [32m✓[39m src/routes/__tests__/store-license-keys.test.ts [2m([22m[2m24 tests[22m[2m)[22m[33m 19567[2mms[22m[39m
   [32m✓[39m license key primitives [2m(4)[22m
     [33m[2m✓[22m[39m generated keys match the BDV shape and are unique in practice[33m 710[2mms[22m[39m
   [32m✓[39m license settings [2m(5)[22m
     [33m[2m✓[22m[39m the owner sets them; they ride the products payload[33m 918[2mms[22m[39m
   [32m✓[39m issuance at fulfillment [2m(4)[22m
     [33m[2m✓[22m[39m verify issues exactly one key — replayed verify reuses it, receipt carries it once[33m 1455[2mms[22m[39m
     [33m[2m✓[22m[39m with keys off, a purchase issues nothing and behaves as before[33m 455[2mms[22m[39m
     [33m[2m✓[22m[39m a gift-card full-pay purchase issues its key too[33m 914[2mms[22m[39m
     [33m[2m✓[22m[39m the key snapshots the cap at purchase — a later settings edit doesn't rewrite it[33m 662[2mms[22m[39m
   [32m✓[39m download counting and the cap [2m(4)[22m
     [33m[2m✓[22m[39m counts per buyer on the key and stops honestly at the cap[33m 1450[2mms[22m[39m
     [33m[2m✓[22m[39m a fresh link never resets the count[33m 1310[2mms[22m[39m
     [33m[2m✓[22m[39m an unlimited key bypasses the per-link cap and says so[33m 1982[2mms[22m[39m
     [33m[2m✓[22m[39m a non-keyed purchase keeps the legacy per-link behavior[33m 791[2mms[22m[39m
   [32m✓[39m revoke and re-issue [2m(4)[22m
     [33m[2m✓[22m[39m the seller's list is masked; revoke stops downloads and mints at once[33m 1709[2mms[22m[39m
     [33m[2m✓[22m[39m re-issue rotates the key, resets the count, and downloads flow again[33m 1643[2mms[22m[39m
     [33m[2m✓[22m[39m a refunded sale's key can never be re-issued[33m 1311[2mms[22m[39m
     [33m[2m✓[22m[39m another creator can't revoke or re-issue keys that aren't theirs[33m 1440[2mms[22m[39m
   [32m✓[39m buyer vs stranger [2m(3)[22m
     [33m[2m✓[22m[39m the buyer's library shows the full key and the live remaining count[33m 856[2mms[22m[39m
     [33m[2m✓[22m[39m a stranger's library is empty and they cannot mint against the buyer's sale[33m 485[2mms[22m[39m
[15:26:10.596] [33mWARN[39m (8575): [36m[wishlists] price-drop detection failed[39m
    [35mitemKind[39m: "shop_product"
    [35mitemId[39m: "1a5b14fc-7b6d-4d96-b90c-280bece50077"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n      SELECT id, user_id, lowest_cents\n      FROM wishlists\n      WHERE item_kind = $1 AND item_id = $2::uuid\n        AND lowest_cents > $3\n    \nparams: shop_product,1a5b14fc-7b6d-4d96-b90c-280bece50077,3499: relation \"wishlists\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n      SELECT id, user_id, lowest_cents\n      FROM wishlists\n      WHERE item_kind = 'shop_product' AND item_id = '1a5b14fc-7b6d-4d96-b90c-280bece50077'::uuid\n        AND lowest_cents > '3499'\n    ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
                SELECT id, user_id, lowest_cents
                FROM wishlists
                WHERE item_kind = $1 AND item_id = $2::uuid
                  AND lowest_cents > $3
              
          params: shop_product,1a5b14fc-7b6d-4d96-b90c-280bece50077,3499
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at detectWishlistPriceDrop (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/lib/wishlists.ts:247:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/shops.ts:1094:5
          caused by: Error: relation "wishlists" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
                SELECT id, user_id, lowest_cents
                FROM wishlists
                WHERE item_kind = 'shop_product' AND item_id = '1a5b14fc-7b6d-4d96-b90c-280bece50077'::uuid
                  AND lowest_cents > '3499'
              ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n      SELECT id, user_id, lowest_cents\n      FROM wishlists\n      WHERE item_kind = $1 AND item_id = $2::uuid\n        AND lowest_cents > $3\n    ",
      "params": [
        "shop_product",
        "1a5b14fc-7b6d-4d96-b90c-280bece50077",
        3499
      ]
    }
[15:26:13.356] [33mWARN[39m (8575): [36m[storefronts] view record failed[39m
    [35mshopId[39m: "7f89636e-3f40-4d13-bd2d-e41ec9a439cc"
    err: {
      "type": "DrizzleQueryError",
      "message": "Failed query: \n        SELECT id FROM shop_events\n        WHERE shop_id = $1 AND event_type = 'view' AND ip_hash = $2\n          AND created_at > NOW() - INTERVAL '1 hour'\n        LIMIT 1\n      \nparams: 7f89636e-3f40-4d13-bd2d-e41ec9a439cc,e222e1d34ab05f0eb363b833ab5e4d87: relation \"shop_events\" does not exist\n\n🐜 This seems to be an execution error, which means that your request syntax seems okay,\n    but the resulting statement cannot be executed → Probably not a pg-mem error.\n\n*️⃣ Failed SQL statement: \n        SELECT id FROM shop_events\n        WHERE shop_id = '7f89636e-3f40-4d13-bd2d-e41ec9a439cc' AND event_type = 'view' AND ip_hash = 'e222e1d34ab05f0eb363b833ab5e4d87'\n          AND created_at > NOW() - INTERVAL '1 hour'\n        LIMIT 1\n      ;\n\n👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:\n\n",
      "stack":
          Error: Failed query: 
                  SELECT id FROM shop_events
                  WHERE shop_id = $1 AND event_type = 'view' AND ip_hash = $2
                    AND created_at > NOW() - INTERVAL '1 hour'
                  LIMIT 1
                
          params: 7f89636e-3f40-4d13-bd2d-e41ec9a439cc,e222e1d34ab05f0eb363b833ab5e4d87
              at NodePgPreparedQuery.queryWithCache (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm/pg-core/session.js:41:15)
              at runNextTicks (node:internal/process/task_queues:65:5)
              at processImmediate (node:internal/timers:541:9)
              at recordView (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/shops.ts:1708:22)
          caused by: Error: relation "shop_events" does not exist
          
          🐜 This seems to be an execution error, which means that your request syntax seems okay,
              but the resulting statement cannot be executed → Probably not a pg-mem error.
          
          *️⃣ Failed SQL statement: 
                  SELECT id FROM shop_events
                  WHERE shop_id = '7f89636e-3f40-4d13-bd2d-e41ec9a439cc' AND event_type = 'view' AND ip_hash = 'e222e1d34ab05f0eb363b833ab5e4d87'
                    AND created_at > NOW() - INTERVAL '1 hour'
                  LIMIT 1
                ;
          
          👉 You can file an issue at https://github.com/oguimbal/pg-mem along with a way to reproduce this error (if you can), and  the stacktrace:
          
          
              at chk (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7761:23)
              at DbSchema.getObject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:7783:16)
              at getSelectable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3156:69)
              at buildRawSelectSubject (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3050:24)
              at buildRawSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3110:15)
              at buildSelect (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3011:20)
              at buildWithable (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:2992:20)
              at new SelectExec (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:3195:67)
              at StatementExec._getExecutor (/home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5794:24)
              at /home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/pg-mem@3.0.14/node_modules/pg-mem/index.js:5886:195
      "query": "\n        SELECT id FROM shop_events\n        WHERE shop_id = $1 AND event_type = 'view' AND ip_hash = $2\n          AND created_at > NOW() - INTERVAL '1 hour'\n        LIMIT 1\n      ",
      "params": [
        "7f89636e-3f40-4d13-bd2d-e41ec9a439cc",
        "e222e1d34ab05f0eb363b833ab5e4d87"
      ]
    }
[15:26:16.759] [31mERROR[39m (8575): [36m[shops] shop-description generation failed[39m
    err: {
      "type": "Error",
      "message": "provider down",
      "stack":
          Error: provider down
              at Object.<anonymous> (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/__tests__/shops.test.ts:585:64)
              at Object.Mock [as create] (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/vitest@5.0.1_@types+node@25.9.8_vite@8.3.0_@types+node@25.9.8_esbuild@0.28.1_jiti@2.7.0_tsx@4.23.15_yaml@2.9.1_/node_modules/vitest/dist/chunks/spy.DQ0ZsPbi.js:320:40)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/shops.ts:1400:59
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:26:17.126] [31mERROR[39m (8575): [36m[shops] product-description generation failed[39m
    err: {
      "type": "Error",
      "message": "boom",
      "stack":
          Error: boom
              at Object.<anonymous> (/home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/__tests__/shops.test.ts:619:64)
              at Object.Mock [as create] (file:///home/hatch/workspace/bdv-wt-rem-clearance/node_modules/.pnpm/vitest@5.0.1_@types+node@25.9.8_vite@8.3.0_@types+node@25.9.8_esbuild@0.28.1_jiti@2.7.0_tsx@4.23.15_yaml@2.9.1_/node_modules/vitest/dist/chunks/spy.DQ0ZsPbi.js:320:40)
              at /home/hatch/workspace/bdv-wt-rem-clearance/artifacts/api-server/src/routes/generate/shops.ts:1479:59
              at processTicksAndRejections (node:internal/process/task_queues:104:5)
    }
[15:26:17.223] [31mERROR[39m (8575): [36m[shops] product-image generation failed — Visual Buc refunded[39m
    err: "image provider down"
[15:26:17.394] [31mERROR[39m (8575): [36m[shops] product-image generation failed — Visual Buc refunded[39m
    err: "bucket still missing"
 [32m✓[39m src/routes/generate/__tests__/shops.test.ts [2m([22m[2m45 tests[22m[2m)[22m[33m 13445[2mms[22m[39m
   [32m✓[39m pricing constants [2m(2)[22m
     [33m[2m✓[22m[39m AI descriptions cost 1 credit[33m 522[2mms[22m[39m
   [32m✓[39m POST /api/shops [2m(7)[22m
     [33m[2m✓[22m[39m creates a shop for free (no credit charge)[33m 1330[2mms[22m[39m
     [33m[2m✓[22m[39m rejects duplicate handles with 409[33m 368[2mms[22m[39m
     [33m[2m✓[22m[39m allows shop creation for VIP plans[33m 324[2mms[22m[39m
   [32m✓[39m GET /api/shops/mine [2m(1)[22m
     [33m[2m✓[22m[39m returns only the caller's shops with product counts[33m 417[2mms[22m[39m
   [32m✓[39m PATCH /api/shops/:id [2m(3)[22m
     [33m[2m✓[22m[39m updates the owner's shop for free[33m 312[2mms[22m[39m
   [32m✓[39m GET /api/shops/handle/:handle [2m(2)[22m
     [33m[2m✓[22m[39m returns shop + products without leaking user_id[33m 371[2mms[22m[39m
   [32m✓[39m product CRUD [2m(3)[22m
     [33m[2m✓[22m[39m adds, updates, and removes products for free[33m 742[2mms[22m[39m
   [32m✓[39m product pause/unlist [2m(7)[22m
     [33m[2m✓[22m[39m new products are born 'active' and the owner list carries status[33m 692[2mms[22m[39m
     [33m[2m✓[22m[39m legacy rows (inserted without a status) read as live everywhere[33m 465[2mms[22m[39m
     [33m[2m✓[22m[39m owner pause: product vanishes from buyer reads, stays in the owner list, buyer DTO leaks no status[33m 1550[2mms[22m[39m
     [33m[2m✓[22m[39m unpause restores the product to buyer reads[33m 654[2mms[22m[39m
     [33m[2m✓[22m[39m a non-owner cannot pause: 404 and the product is provably unchanged[33m 765[2mms[22m[39m
     [33m[2m✓[22m[39m rejects an out-of-vocabulary status and changes nothing[33m 446[2mms[22m[39m
     [33m[2m✓[22m[39m pausing is free — no credit charge on the status flip[33m 638[2mms[22m[39m
 [32m✓[39m src/lib/__tests__/operator-duties.test.ts [2m([22m[2m21 tests[22m[2m)[22m[33m 473[2mms[22m[39m
 [32m✓[39m src/routes/__tests__/reach-routes.test.ts [2m([22m[2m23 tests[22m[2m)[22m[33m 3257[2mms[22m[39m
   [32m✓[39m multistream destination keys — write-only secrets [2m(2)[22m
     [33m[2m✓[22m[39m PUT stores the key encrypted; GET returns platform/ingest/hasKey and NEVER the key[33m 859[2mms[22m[39m
   [32m✓[39m broadcast channels — one-to-many, no gates [2m(1)[22m
     [33m[2m✓[22m[39m create → join → only the creator posts → members read, non-members can't[33m 497[2mms[22m[39m

== HARVEST NOTE (lane worker) ==
The chain above (head=ecc63098) is the BASELINE run. The full green run on
head=63b96da2 recorded, in order: build-libs exit=0, api-typecheck exit=0,
fe-typecheck exit=0, scoped-api exit=0 (20 tests), scoped-fe exit=0 (9 tests),
full-api exit=0 (Test Files 526 passed / 526; Tests 6512 passed / 6512) —
all observed in this file before it was accidentally reverted by a git
checkout during harvest; the FE full suite from that run was lost with it
and is re-run into RESULTS-FE.md.
full-fe exit=1
ALLDONE 2026-10-26T17:01:31Z
