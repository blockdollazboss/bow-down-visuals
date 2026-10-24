# #16 Creator Product Affiliates — gap verification (2026-10-23)
Base: stack28/integration f96d7b72. Worktree bdv-wt-affiliates, branch stack29/affiliates.
Farm: node_modules symlink farm built from MAIN checkout ~/workspace/bow-down-visuals
(NOT bdv-wt-integration — its frontend tree is ELOOP-corrupt per hazard correction).
@workspace mapped BY NAME into this worktree. Verified readlink -f:
  artifacts/api-server/node_modules/@workspace/db      -> /home/hatch/workspace/bdv-wt-affiliates/lib/db
  artifacts/api-server/node_modules/@workspace/api-zod -> /home/hatch/workspace/bdv-wt-affiliates/lib/api-zod
Frontend react/vite realpath into main checkout .pnpm store — healthy, no ELOOP.

GAP CONFIRMED (searched lib/db/src/schema + artifacts at base):
- "affiliate" in commerce schemas = ONLY an income-category label:
  lib/db/src/schema/money-entries.ts MONEY_INCOME_CATEGORIES includes "affiliate"
  (manual money-tracker category on /coach). No product setting, no code, no ledger.
- Other "affiliate" hits are content (academy courses, brand-deals guide, niche
  analyzer) — advice about affiliate marketing, not a product-affiliate system.
- No creator-set commission on store_products (lib/db/src/schema/storefront.ts)
  or shop_products (lib/db/src/schema/customer-shops.ts); no affiliate code on any
  product; no attribution column in store_orders / shop_events checkout paths.
- Platform referral program is SEPARATE: lib/db/src/schema/referrals.ts
  (referral_codes/referrals/referral_payouts) pays Visual Bucs revenue share on a
  referee's CREDIT purchases only. Product-sale sessions (storefront_purchase /
  marketplace_shop_purchase) never touch it — the two programs cannot pay twice
  for one sale as long as affiliate attribution hooks ONLY the product-sale funnels.

FEE TRUTH (do not touch): artifacts/api-server/src/lib/platform-fees.ts
PLATFORM_FEE_BPS = 500 (flat 5%, owner ruling 2026-10-23); shops rail uses
STOREFRONT_PLATFORM_FEE_BPS = env || 500 in routes/generate/shops.ts.
Affiliate commission comes out of the SELLER's net (gross - platform fee),
never out of the platform fee, never added to the buyer's price.

CHECKOUT FUNNELS (attribution hooks):
- Storefront rail (store_products): POST /api/storefront/checkout creates the
  Stripe session (metadata carries the sale); POST /api/storefront/verify records
  the store_orders row exactly once (stripe_session_id UNIQUE, !duplicate guard).
- Shops rail (shop_products): POST /api/storefronts/checkout writes pending_sale
  shop_events rows; the ONE paid flip is lib/market-sale.ts markMarketSalePaid
  (verify + central webhook both run it; guarded on pending_sale, exactly once).
  Free carts record the sale inline in the checkout route.

MONEY DESK: /earnings page (pages/earnings.tsx) served by GET /api/earnings
(routes/earnings.ts) — affiliate section docks there. Product settings dock in
the existing product management surfaces (store-dashboard.tsx / my-shop.tsx).
Migrations at base: last = 0204_abandoned_checkouts.sql → next free = 0205.
