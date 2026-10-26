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
