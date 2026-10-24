# Lane F13 — Order bumps & checkout upsells (stack29/order-bumps)

## Schema verdict: migration NEEDED for persistence — reported, NOT written
No existing column can honestly hold the attachment:
- `store_products`: media_urls (string[]), service_details (service-only
  shape), related_links (buyer-facing link graph). No config jsonb.
- `shop_products` / `digital_sales`: no product config jsonb either.
Per the lane brief, the exact migration is in REPORT.md; everything else
is built now. All reads are defensive (`readBumpConfig` reads keys off the
`SELECT sp.*` row — absent keys → no offer), order inserts only name the
bump columns when a bump is actually in the session (impossible before
the columns exist, since checkout can only offer what it can read), so
the code is safe to land before the migration and lights up with it.
Drizzle schema (lib/db/src/schema/storefront.ts) is deliberately NOT
edited: `routes/profile-website.ts` does a full `db.select().from(
storeOrdersTable)` — new drizzle columns would break it pre-migration.
The migration report includes the matching drizzle additions.

## Persisted shape (post-migration)
- store_products.bump_product_id uuid → the add-on product (same seller)
- store_products.bump_percent_off int 0..90 (0 = listed price; mirrors
  discount_codes' percent convention)
- store_orders.bump_product_id / bump_title / bump_amount_cents /
  bump_platform_fee_cents / bump_creator_amount_cents — the bump as its
  own line ON the order row. amount_cents / platform_fee_cents /
  creator_amount_cents stay SESSION TOTALS so every existing reader
  (sales, tracker, checklist) keeps reconciling untouched.

## Money math (lib/order-bumps.ts, pure)
- Bump price = seller-set product price, optionally seller-set percent
  off. Never invented. Floored at 1¢ when list price > 0 (a paid line
  never rounds to $0).
- Fees: TOTAL fee = feeSplit(total) (flat 5%, platform-fees.ts — the one
  source). Line attribution: bumpFee = feeSplit(bumpGross); mainFee =
  totalFee − bumpFee; each line's creator = gross − its fee. Sums
  reconcile to the cent; no-bump path is byte-identical to today's math.
- Discount codes discount the MAIN line only (they're the seller's codes
  for the purchase; the bump carries its own seller-set discount). The
  checkout response and product page copy say so.

## Flow
- Seller: PUT /storefront/products/:id/bump {bumpProductId|null,
  percentOff} — own products only, target ≠ self, target price > 0
  ($0 lead magnets ride the claim rail, never a paid bump).
- Buyer: product payloads carry `bump` (the live offer, resolved:
  target active, in stock, same seller) + `bumpConfig` (raw setting).
  Checkout accepts includeBump — server recomputes everything; ONE
  Stripe session with two line items; idempotency intent includes the
  bump so a ticked/unticked submit never collide and a double-submit
  reuses the same session.
- Verify: session total is truth; splits recomputed via
  splitOrderAmounts; ONE order row with the bump line columns; per-kind
  fulfillment runs for the bump too (delivery token / RSVP / booking
  note + creator ping). Bump inventory race after payment: order still
  records, bump line kept, fulfillment note states the exact refund the
  creator owes for the add-on (mirrors the rail's honesty pattern)
  instead of failing the whole paid order.
- Receipts: orderShape gains `lines[]` (main + bump) on sales/purchases.

## Out of this lane (stated, not silent)
- Shops cart rail (routes/generate/shops.ts) and digital store
  (routes/store.ts) are separate checkouts; the pure module is
  rail-agnostic and ready for them. Follow-up in REPORT.md.
- Post-purchase (one-click post-payment) upsell: NOT built — the brief's
  scope is the at-checkout bump; a post-purchase offer needs its own
  payment-intent flow and is named as the follow-up in REPORT.md.
