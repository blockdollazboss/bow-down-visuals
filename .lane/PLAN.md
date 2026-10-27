# upg-deals lane plan (run: replacement worker, Oct 26 night)
Branch: stack200/upg-deals @ base ecc63098. NO pushes/merges. Migrations: provisional 9999-*.sql only.
Deltas (audit: ~/workspace/stack200-board.md DEDUPE AUDIT, Batch 3 + Batch 6):

## Covered-check (done, evidence in code at base)
- #164 Plain-Words Deals — NOT covered. /contracts = Contract ANALYZER only
  (routes/generate/contract-analyzer.ts POST /analyze; pages/contracts.tsx is
  paste-and-review). No drafting, no signing, no deal->splits wiring anywhere.
  Reuse (do NOT rebuild): co-releases consent pattern (lib/co-releases.ts pure
  machine + lib/co-releases-db.ts + routes/co-releases.ts) and the sale-splits
  rail (lib/sale-splits.ts + schema sale_split_entries, splits jsonb on products).
- N11 One-Tap Beat Leases — rail covered, delta NOT. Licensing exists
  (routes/generate/beats.ts: tiers basic/premium/exclusive, producer templates,
  terms snapshot at purchase, Stripe checkout + verify, migration 0188).
  Missing: plain-words terms rendered AS the checkout + one-tap sign+pay +
  durable record of the buyer's one-tap acceptance.
- N4 One Tip Jar — jar exists, unification NOT. Tip jar = /tips/:handle
  (routes/generate/tip-jar.ts: real Stripe checkout, tip_jar_tips durable rows,
  funding goals). Parallel separate rails: live-tips (routes/live-tips.ts, VB
  stream tips) and world stage tips (lib/world-stage-tips.ts, VB). No single
  jar identity/resolver; doors (video, profile, printed QR incl. mic wrap)
  do not all resolve to the one jar.

## Build order (commit after every rung)
1. #164 lib: lib/plain-deals.ts pure machine (draft -> both sign in-app ->
   terms freeze; amend pre-sign resets other side; decline/withdraw;
   split validation REUSES co-releases validateSplit) + unit tests.
2. #164 schema: lib/db/src/schema/plain-deals.ts + migrations/9999-plain-deals.sql.
3. #164 routes: routes/plain-deals.ts (create/list/get/sign/decline/amend +
   attach: on full signature write splits via existing rails — co-release for
   release/product items, product splits jsonb for store/shop products) + tests.
4. #164 FE: Plain-Words Deals section docked in pages/contracts.tsx (builder,
   my deals, sign action, signed view) — both themes (isLight pattern).
5. N11 lib: lib/beat-plain-terms.ts (BeatLicenseTerms -> plain-words lines:
   what you get / what you can do / limits / credit line) + tests.
6. N11 routes: GET /beats/:id/offers (plain terms per tier/template) +
   POST /beats/:id/license records terms_accepted_at on the one tap
   (schema col + 9999 migration) + tests.
7. N11 FE: one-tap lease panel on pages/beats.tsx — plain-words terms ARE
   the checkout; one "Agree & pay" tap.
8. N4 lib+routes: lib/one-tip-jar.ts resolver + GET /api/tips/jar/:handle —
   THE jar descriptor (canonical URL, QR target, funding progress, unified
   activity across tip_jar_tips + live tips + world stage tips). Rails stay
   physically separate (USD vs VB — no invented money merger); the
   DESTINATION (one jar per creator) is unified.
9. N4 FE: jar doors — profile + video tip doors resolve to the jar;
   printable QR card (incl. mic-wrap) on the tips dashboard.
10. Full lane suites + typechecks green; manifest update per delta.
