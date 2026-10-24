# Lane #16 — Creator Product Affiliates: EVIDENCE

Branch: `stack29/affiliates` (base `stack28/integration` @ f96d7b72). No push.

## Gap (verified in source — .lane/GAP.md)
Before this lane, "affiliate" in commerce was only an income-category label
(`money-entries.ts`). No per-product commission setting, no affiliate code,
no checkout attribution, no ledger. The platform referral program
(`referrals.ts` → `referral_payouts`, Visual Bucs on CREDIT purchases) is a
different program; product-sale checkouts never touch it and this feature
never writes to it (pinned by test).

## What works end-to-end
1. **Per-product setting (creator-set, never invented)**: `affiliate_enabled`
   + `affiliate_commission_bps` on `store_products` and `shop_products`.
   Enabling without a rate is refused (`COMMISSION_REQUIRED`) on create AND
   on PATCH; bps validated 1..10000. Commission comes out of the SELLER's
   cut: `round((gross − platformFee) × bps / 10000)`. Platform fee math
   untouched (`platform-fees.ts` / `PLATFORM_FEE_BPS` = 500 flat 5%; shops
   keep `STOREFRONT_PLATFORM_FEE_BPS` env override).
2. **Codes/links**: `POST /api/affiliates/codes` claims a shareable code
   (`AFF-…`, idempotent per fan+product, seller can't claim own product,
   disabled product refuses). Links: `/storefront/product/:id?ref=CODE`,
   `/shop/:handle?ref=CODE`. Public `GET /api/affiliates/resolve/:code`
   powers the transparency banner. Buy pages pass `?ref=` into checkout.
3. **Attribution in checkout** (both covered rails):
   - Storefront rail: `affiliateCode` validated at checkout (400
     `BAD_AFFILIATE_CODE` for bogus/wrong-product/inactive), rides Stripe
     metadata, recorded INSIDE the exactly-once block of
     `/storefront/verify` after the order row.
   - Shops rail: code validated against the cart, stored per-line on the
     pending `shop_events` row, recorded at the single paid flip
     (`market-sale.ts` — verify + webhook funnel through it, guarded), and
     inline for $0 carts. `recordAffiliateSaleSafely` wraps every call site:
     a ledger failure can never break a paid checkout.
4. **Money desk**: `/earnings` gains an "Affiliate program" section backed
   by `GET /api/affiliates/desk` — per-product totals (owed/paid), who is
   selling for you (per affiliate), your earnings as an affiliate, and your
   codes with one-tap copy/deactivate. Rows stay `owed` until the existing
   creator-payout settlement rails settle them — NO new payout mechanism,
   nobody is paid by this feature.
5. **Fraud discipline**: buyer == affiliate earns nothing (by user id AND
   by email on guest rails); seller self-dealing refused; the rate is
   snapshotted per sale (later rate changes never rewrite history); ledger
   uniqueness `(surface, order_ref, product_id)` + pre-check = exactly-once
   across verify/webhook replays.

## Migration HELD (house rule — do not apply from this lane)
`.lane/MIGRATION-NEEDED.md` — migration **0205** (idempotent SQL, no
BEGIN/COMMIT; next free number verified against `lib/db/migrations/`,
last = 0204). Drizzle schema mirrors are already in `lib/db/src/schema/`
(`affiliates.ts` new; columns on `storefront.ts` / `customer-shops.ts`).
Code fails closed/safely on a DB without 0205.

## Suite numbers (finished logs in .lane/logs/ only)
- `src/lib/__tests__/affiliates.test.ts` — **12/12** (lib-affiliates-3.log)
- `src/routes/__tests__/affiliates-storefront.test.ts` — **13/13**
  (storefront-suite-4.log)
- `src/routes/generate/__tests__/affiliates-shops.test.ts` — **5/5**
  (multiple logs; final-combined.log)
- Final combined regression (11 files, sequential, --maxWorkers=1):
  **157 passed / 1 failed** (final-combined.log) — the one failure is a
  10s `beforeEach` hook timeout in `shop-discounts` under multi-lane box
  contention; isolated rerun of that file: **10/10** (iso2-shop-discounts.log).
- Isolated reruns after 0205 DDL-mirror patches (iso2-*.log):
  storefront-lead-magnet **11/11**, market-checkout **12/12**,
  shop-discounts **10/10**, shops **45/45**,
  shop-merge-characterization **5/5**, payment-reversals **28/28**.
- FE suites (earnings-data, storefront-product, broken-doors,
  findability-nav): **42/42** (fe-suites.log).
- Typechecks: API `tsc --noEmit` exit 0 (api-typecheck-final3.log);
  FE `tsc --noEmit` exit 0, empty error log (fe-typecheck.log);
  lib/db + lib/api-zod dist builds exit 0.

Note — pre-existing pg-mem blind spot (documented in the base suites
themselves): the storefront checkout's idempotency count query uses
`IS NOT DISTINCT FROM`, which pg-mem cannot parse; the paid-checkout path
is pinned by staging E2E, not pg-mem. My suite therefore pins checkout-side
code validation and drives verify with sessions fabricated exactly as
checkout mints them (same metadata keys, incl. `affiliate_code`).

## Parked (with reasons)
- `store.ts` digital-sales rail (catalog tracks/albums/packs): not wired —
  brief targets store/storefront products; both product catalogs covered.
- Live shopping: no per-product catalog row of either covered type.
- World native surfaces call the shops checkout without `affiliateCode`;
  `?ref=` plumbing there not built (attribution works if a code is passed).
- $0 lead-magnet `/claim` rail: no ledger row (a $0 sale owes $0; the
  zero-commission guard skips honestly).
- `paid` transitions: deliberately not built (existing payout rails settle).
