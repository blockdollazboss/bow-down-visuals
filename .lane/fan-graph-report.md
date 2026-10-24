# Lane F11 — One Fan Graph (Stack-100 #3, feature #11)

Branch: `stack29/fan-graph` off `stack28/integration` @ f96d7b72.
No migration. No deletions. No push.

## What was built

- `artifacts/api-server/src/lib/fan-graph.ts` — the aggregation.
  `loadFanGraph(creatorUserId)` loads ONLY the caller's own rows from
  8 sources (follows, email_subscribers via the caller's lists,
  fan_members + fan_tiers, store_orders, digital_sales, shop_events,
  live_shop_sales, world_stage_tips) and `buildFanGraph` merges them
  into one record per fan: follows?, subscribed? (active, not
  unsubscribed), member tier + status, USD spent (cents), Visual Bucs
  spent (stage tips), purchase count, last activity. `queryFanGraph`
  adds search / sort (recent | spent | name) / pagination.
- `artifacts/api-server/src/routes/generate/fan-graph.ts` —
  `GET /api/email-list/fan-graph` (requireAuth + publicApiLimiter,
  zod-validated query). Registered in routes/index.ts beside the
  email-list router. FREE — no charge anywhere on the path.
- `artifacts/bow-down-visuals/src/components/FanGraphTab.tsx` + a
  "Fan Graph" tab in `pages/email-list.tsx` — the desk UI docked in
  the Email List page (PROMOTE), per the no-standalone-page rule:
  summary counts (total fans / followers / subscribers / members /
  buyers + total spent), debounced search, sort select, fan rows
  with badges and spend, prev/next pagination.
- Locales: 20 new `email-list.fan_graph*` keys in ALL 10 catalogs,
  pinned in `locale-newest-surfaces.test.ts` EMAIL_LIST_BLOCK
  (REQUIRED 4284 → 4304).
- Operator KB: `fan-graph` DOCKED_FEATURES entry in
  `scripts/generate-operator-knowledge.mjs` (name + description ride
  the desk's own en.json prose; endpoint concrete, pricedEndpoints
  []); `operator-knowledge.json` regenerated (238 features).
  Regeneration also surfaced pre-existing drift: the community
  moderate/sentiment/superfans 100 VB prices from CREDIT_COSTS now
  attach (pricedActions 217 → 227) — the committed JSON predated
  those rails (baseCommit 6cc14c93); price-integrity tests verify
  every attached price against the rails and pass.

## The merge rule (also documented in lib/fan-graph.ts)

- Identity key = account user id where a source carries one, else
  normalized email (trim + lowercase), else the free-form club label.
- The ONLY account↔email bridge is a fan_members row carrying both
  `fan_user_id` and an email-shaped `fan_label` for that creator.
- Two account ids never merge; two emails never merge; an email-only
  fan and an account-only fan with no bridge stay TWO records —
  a shared email string is never treated as proof of one person.
- Spend counts only real money states: store/digital orders
  'completed', shop_events 'sale' rows (buyer_email), live sales
  'paid' (never 'test'), memberships only with a Stripe checkout
  session and not refunded, stage tips only once credited to the
  creator. Identity-less sales (guest orders, email-less shop sales)
  are skipped, never invented into a fan. tip_jar_tips is not a
  source (fan name only — unattributable).

## Privacy

Every loader query is filtered by the caller (their profile ids,
their list ids, or their user id); there is no creator-id parameter.
Route tests seed two creators sharing one fan email and prove each
sees only their own facts (tier, spend, roster) plus 401 signed-out.

## Tests (numbers from finished logs in this directory)

- API targeted final (fan-graph lib + route, email-list, email-list
  fixes, opens-honesty, automations): 6 files / 109 tests, ALL PASS
  — test-api-targeted-final.log (includes the 12 lib merge tests and
  the 6 route tests: scoping, honesty filters, pagination, search,
  auth).
- KB tests (knowledge + door mapping + hands price integrity):
  3 files / 72 tests, ALL PASS — test-kb2.log.
- FE targeted final (email-list surface + ALL locale gates: newest
  surfaces pin 4304, per-language waves, numeric parity, split,
  source-auto, server-strings, findability-nav): 19 files / 405
  tests, ALL PASS — test-fe-targeted-final2.log. First run caught 6
  real defects (test-fe-targeted-final.log): the feature name left
  identical to English in es/fr/de/it/pt, fr "Followers", and digits
  in the ja intro — all fixed and re-verified.
- API typecheck: exit 0. FE typecheck: exit 0 — typecheck-fe.log.
- Full suites: the full API suite was started in-lane and reached
  61 test files / 478+ passing tests with ZERO failures
  (test-api-full-partial.log) before being stopped: the box was at
  load average ~10–20 with ~10 Stack-100 #3 lanes all running suites
  at once, crawling at ~4 files/min. Full-suite completion is
  deferred to the join stage (the Stack-100 #2 practice: full suites
  run on the joined tree), where this lane's targeted surface is
  already green.
