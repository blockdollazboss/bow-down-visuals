# PLAN — #16 Creator Product Affiliates (stack29/affiliates)
Dock: MONEY. Settings live in product management; desk lives on /earnings.

## Schema (migration 0205 HELD — see MIGRATION-NEEDED.md; drizzle mirrors it)
- store_products += affiliate_enabled bool default false, affiliate_commission_bps int NULL
- shop_products  += same two columns
- shop_events    += affiliate_code text NULL (carried pending->sale through the flip)
- NEW affiliate_codes: id, code UNIQUE (upper), affiliate_user_id, seller_user_id,
  surface ('store_product'|'shop_product'), product_id, is_active, created_at;
  UNIQUE(affiliate_user_id, surface, product_id)
- NEW affiliate_sales (ledger): id, affiliate_code_id FK, affiliate_user_id, seller_user_id,
  surface, product_id, product_title, order_ref (stripe session id / checkout group),
  buyer_user_id NULL, buyer_email NULL, gross_cents, platform_fee_cents,
  seller_net_cents (before commission), commission_bps snapshot, commission_cents,
  status 'owed'|'paid'|'void', created_at, paid_at;
  UNIQUE(surface, order_ref, product_id) = exactly-once guard.

## Money math (lib/affiliates.ts)
commission = round(sellerNetCents * commissionBps / 10000) — out of the SELLER's net.
Platform fee untouched (feeSplit / STOREFRONT_PLATFORM_FEE_BPS as-is). Buyer price unchanged.

## Fraud discipline (recordAffiliateSale, single funnel)
- buyer == affiliate (user id, or email match on guest rail) -> no row (reason self_referral)
- affiliate == seller -> no row (self_dealing)
- product not affiliate-enabled at sale time / code inactive / code-product mismatch -> no row
- ON CONFLICT (surface, order_ref, product_id) DO NOTHING -> replays never double-count
- Platform referral program pays ONLY on credit purchases (referral_payouts);
  affiliate ledger writes ONLY from product-sale funnels -> never twice for one sale.

## API (routes/affiliates.ts, mounted /api)
- POST /affiliates/codes {surface, productId} auth -> fan's code + share link
  (/storefront/product/:id?ref=CODE or /shop/:handle?ref=CODE — resolved server-side)
- GET  /affiliates/codes/mine auth
- POST /affiliates/codes/:id/deactivate auth (owner of code)
- GET  /affiliates/offers auth -> products with affiliates enabled (both surfaces)
- GET  /affiliates/desk auth -> { asSeller: {affiliates:[{userId,code,sales,owed,paid}], totals},
                                  asAffiliate: {sales, owedCents, paidCents, byProduct} }
- GET  /affiliates/resolve/:code public -> product + seller + commission pct (for buy pages)

## Settings wiring
- storefront.ts: BaseProductSchema += affiliateEnabled/affiliateCommissionBps (+refine:
  enabled => bps 1..10000); INSERT + PATCH sets; withLinks presents the fields.
- shops.ts: create/updateProductSchema += affiliate_enabled/affiliate_commission_bps (snake,
  that file's convention); product SELECT lists += the columns.

## Checkout wiring
- storefront rail: CheckoutSchema += affiliateCode optional; validated at checkout
  (active code, product match, enabled) -> Stripe metadata affiliate_code;
  verify: inside !duplicate block after order insert -> recordAffiliateSale.
  Claim rail ($0): no money moves, commission on 0 = 0 -> NOT recorded (honest: no sale).
- shops rail: checkoutSchema += affiliateCode optional; validated against cart lines;
  stored on pending shop_events rows (matching line only); free-cart path records
  inline ONLY if gross>0 (free lines gross 0 -> commission 0, skipped);
  markMarketSalePaid: for flipped rows with affiliate_code -> recordAffiliateSale.
  Webhook door runs the same flip -> covered.

## Frontend
- pages/earnings.tsx: "Affiliate program" section (own fetch /api/affiliates/desk,
  per-section error state): as-seller table + as-affiliate totals + my codes with links.
- store-dashboard.tsx product form: affiliates toggle + commission % input.
- my-shop.tsx product form: same.
- Buy pages: storefront-product.tsx + shop.tsx read ?ref= and pass affiliateCode to checkout.
