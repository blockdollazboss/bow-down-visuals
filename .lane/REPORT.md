# Lane F13 — Order bumps & checkout upsells — REPORT

Branch `stack29/order-bumps` off `stack28/integration` @ f96d7b72.
Feature #13 from `~/workspace/stack29-next10-board.md` (Round 2).
Dock: MONEY — the Sell Everything storefront rail (`routes/storefront.ts`).

## ⛔ ONE BLOCKER — a migration is required (reported, NOT written, per brief)

Persistence has no honest home in the current schema (see DESIGN.md),
so the attachment + order line need new columns. **Everything below is
built, tested, and safe to land BEFORE the migration**: all reads are
defensive (absent columns → no offer, orders list exactly as today),
and order inserts only name the bump columns when a session actually
carries a bump — which cannot happen until the columns exist, because
checkout can only offer what it can read. The seller PUT endpoint is
the one surface that needs the columns outright (pre-migration it
answers an honest 500 "Could not update the add-on offer"). The moment
migration 0205 lands, the whole feature lights up with no code change.

### Exact migration — `lib/db/migrations/0205_storefront_order_bumps.sql`

```sql
-- 0205: Order bumps for the storefront rail (Stack-100 #3, feature
-- #13). A seller attaches ONE add-on product to a store product; the
-- buyer can tick it at checkout and it rides the same Stripe session
-- as a second line. The attachment lives on store_products; the
-- purchased add-on lives as its own line ON the order row
-- (store_orders.bump_*), while amount_cents / platform_fee_cents /
-- creator_amount_cents stay SESSION TOTALS so every existing reader
-- (sales, tracker, checklist) keeps reconciling untouched.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS bump_product_id uuid;
ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS bump_percent_off integer NOT NULL DEFAULT 0;
ALTER TABLE store_products
  DROP CONSTRAINT IF EXISTS store_products_bump_percent_off_range;
ALTER TABLE store_products
  ADD CONSTRAINT store_products_bump_percent_off_range
  CHECK (bump_percent_off >= 0 AND bump_percent_off <= 90);

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS bump_product_id uuid;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS bump_title text;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS bump_amount_cents integer;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS bump_platform_fee_cents integer;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS bump_creator_amount_cents integer;
```

Notes: deliberately NO foreign key on the bump columns — an order's
bump line is a historical record (title + amounts are snapshotted on
the row) and a product's attachment must survive the target being
deactivated or deleted, mirroring `store_orders.product_id` (plain
uuid, no FK). No index: lookups are always by product/order id.

### Matching drizzle additions (same commit as the migration, NOT in this lane)

`lib/db/src/schema/storefront.ts` — deliberately NOT edited by this
lane: `routes/profile-website.ts` does a full
`db.select().from(storeOrdersTable)`, so new drizzle columns would
break it before the migration lands.

```ts
// storeProductsTable:
bumpProductId:  uuid("bump_product_id"),
bumpPercentOff: integer("bump_percent_off").notNull().default(0),
// + check("store_products_bump_percent_off_range",
//         sql`${t.bumpPercentOff} >= 0 AND ${t.bumpPercentOff} <= 90`)

// storeOrdersTable:
bumpProductId:        uuid("bump_product_id"),
bumpTitle:            text("bump_title"),
bumpAmountCents:      integer("bump_amount_cents"),
bumpPlatformFeeCents: integer("bump_platform_fee_cents"),
bumpCreatorAmountCents: integer("bump_creator_amount_cents"),
```
After editing the schema, rebuild the dist (`tsc -b .` from `lib/db`)
before typechecking the api-server, per house rule.

## What works end-to-end (proven by the route suite, post-migration DDL)

- **Seller attach/detach** — `PUT /api/storefront/products/:id/bump`
  `{ bumpProductId | null, percentOff 0..90 }`. Own products only
  (other seller → `BUMP_NOT_YOURS`, non-owner → 404), never the product
  itself (`BUMP_SELF`), never a $0 lead magnet (`BUMP_FREE` — free
  products ride the claim rail). Inactive/sold-out add-ons may be
  attached; the response's `offerLive` says whether buyers can see it.
- **Buyer offer** — every product payload carries `bumpConfig` (the raw
  setting, for the dashboard) and `bump` (the resolved live offer:
  same seller, active, priced, in stock — otherwise null). The product
  page shows a single tick-to-add card with the add-on price (list
  price struck through when a % off applies) and the combined total.
- **Checkout** — `includeBump` is re-resolved and re-priced
  server-side; a tick with no live offer refuses the whole checkout
  (`BUMP_NOT_OFFERED` / `BUMP_SOLD_OUT`), no session, no charge. A live
  tick produces ONE Stripe session with two line items. Totals are
  server-computed and returned per line.
- **Money math** (`lib/order-bumps.ts`, pure) — bump price = the
  seller-set product price or the seller-set % off it; never invented;
  floored at 1¢. Fee = `feeSplit(session total)` at the flat 5%
  (`lib/platform-fees.ts`, the one source); line attribution: bump fee
  = `feeSplit(bump gross)`, main fee = remainder — lines always sum to
  the session fee to the cent. No-bump totals are byte-identical to the
  pre-feature rail. Discount codes discount the MAIN line only (the
  bump carries its own seller-set discount); the checkout response and
  the product-page copy say so.
- **Double-charge impossibility** — the checkout idempotency intent
  includes the bump (ticked vs unticked never collide; a double-submit
  of the same ticked checkout derives the SAME key, so Stripe reuses
  the one session). Historic no-bump keys are unchanged. Verify is
  idempotent on the unique `stripe_session_id`: a duplicate verify
  returns the recorded order with zero repeated side effects (no
  second inventory claim, no second discount use, no second order).
- **Verify / fulfillment** — one order row; the bump line columns are
  written from splits re-derived from the session total (never trusted
  from the client). Per-kind fulfillment runs for the bump too
  (delivery token for digital/download, RSVP for tickets, note +
  creator ping for services, merch handoff note). If the bump sells
  out between payment and verify, the paid order still records and the
  fulfillment note states the exact add-on refund owed (the rail's
  existing honesty pattern) instead of failing the order. Discount
  `used_count` increments exactly once.
- **Receipts** — verify response, sales and purchases all carry
  `lines[]`: main line + bump line (title, gross, fee, net per line).
  The seller Orders tab shows the add-on line under the order; order
  totals stay whole-session, so sales/tracker/checklist reconciliation
  is untouched.
- **Seller UI** — store dashboard Products tab gains an Add-on column
  (4★ commerce tier, same gate as Inventory): attach editor with the
  seller's own priced products, % off, save/remove, and live/not-live
  status. Buyer UI copy states the flat story and that a discount code
  applies to the main item.
- **Operator KB** — `order-bumps` registered as a docked feature
  (stage: money, host /store/dashboard) in
  `generate-operator-knowledge.mjs`; KB regenerated: 237 → 238
  features. (Regeneration also refreshed `baseCommit` to f96d7b72 and
  picked up 10 priced actions that landed in the Stack-100 #2 join
  after the base KB was generated — no unrelated feature entries
  changed.)

### Incidental fix inside this lane's checkout edit
The purchase-sequence count query's `IS NOT DISTINCT FROM` was
rewritten in the exactly-equivalent portable form
(`discount_code = x OR (discount_code IS NULL AND x IS NULL)`) —
identical semantics on Postgres for a nullable text column, and the
only form the pg-mem route-test harness can parse. That is what makes
the checkout route testable end-to-end at all (previously the query
500'd under pg-mem before any assertion could run).

## Suite numbers (from finished logs in `.lane/logs/`)

| Suite | Log | Result |
|---|---|---|
| lib unit — order-bumps (new) | bumps-suites-final.log | 19/19 pass |
| route — storefront-order-bumps (new) | bumps-suites-final.log | 19/19 pass |
| regression — storefront-lead-magnet | affected-storefront-lead-magnet.log | 11/11 pass |
| regression — storefronts-profile-slug + stripe-checkout-idempotency + -rest | affected-batch2.log | 19/19 pass (3 files) |
| regression — operator-knowledge + operator-door-mapping + chat-doors | affected-batch3b.log | 88/88 pass (3 files) |
| FE — storefront-product + sibling-dashboards + earned-rank | fe-affected.log | 43/43 pass (3 files) |
| API typecheck (`tsc --noEmit`) | api-typecheck-1.log | exit 0 |
| FE typecheck (`tsc --noEmit`) | fe-typecheck-1.log | exit 0 |

Route-suite pins include: attach/detach + all refusals; unticked
totals byte-identical; ticked totals (main 2000¢×2 + bump 3000¢ @10%
off = 6700¢; fee 335 = bump 135 + main 200; creators 2565 + 3800);
idempotency-key equality on double-submit and inequality ticked vs
unticked; refused ticks create ZERO Stripe sessions; discount-main-only
math; verify order columns + receipt lines reconciling to the cent;
duplicate verify as a pure no-op; sold-out-after-payment refund note
("$27.00 refund for the add-on"); sales + purchases lines.

Harness notes for the join: the route suite stubs `lib/rate-limit`
(volume 429s are orthogonal) and registers `gen_random_uuid` with
`impure: true` (without it pg-mem memoizes the default and every
generated id collides — the lead-magnet suite's registration has the
same latent gap; it never inserts two products in one test).

## NOT built (stated follow-ups, not silent gaps)

- **Post-purchase one-click upsell** — the board's finding mentions a
  post-purchase upsell alongside the bump. It needs its own
  payment-intent flow (charge the saved payment method after the main
  order completes, with its own consent + refund story). The
  at-checkout bump shipped here is the Stan/Beacons/Gumroad staple in
  scope for this lane; the post-purchase step is the named follow-up.
- **Shops cart rail** (`routes/generate/shops.ts`) and **digital store**
  (`routes/store.ts`) bumps — separate checkout rails. `lib/order-bumps.ts`
  is rail-agnostic and ready; each rail needs its own session/verify
  wiring + tests.
- **Stacking order** for the join: land migration 0205 + the drizzle
  additions (above) in the same stack as this branch, migration first
  in apply order. Without 0205 the branch is inert-but-safe (no offers
  anywhere, legacy totals everywhere).

## Files

- `artifacts/api-server/src/lib/order-bumps.ts` (new) + `src/lib/__tests__/order-bumps.test.ts` (new, 19)
- `artifacts/api-server/src/routes/storefront.ts` (PUT bump, checkout, verify, orderShape lines, list/detail payloads)
- `artifacts/api-server/src/routes/__tests__/storefront-order-bumps.test.ts` (new, 19)
- `artifacts/api-server/scripts/generate-operator-knowledge.mjs` + `src/lib/operator-knowledge.json` (KB: order-bumps, 238 features)
- `artifacts/bow-down-visuals/src/lib/storefront-api.ts` (DTOs + `setProductBump` + checkout totals)
- `artifacts/bow-down-visuals/src/pages/storefront-product.tsx` (tick-to-add card)
- `artifacts/bow-down-visuals/src/pages/store-dashboard.tsx` (Add-on column + editor, orders lines)
