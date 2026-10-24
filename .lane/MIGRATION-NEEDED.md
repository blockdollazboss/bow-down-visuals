# MIGRATION NEEDED — held for the join (do NOT apply from this lane)

**Count: 1 migration** covering both rails, in the 0206 family (the
base storefront rail's bump persistence is 0205, written separately by
the join — land 0205 first or merge the two; they touch disjoint
tables). Until this lands, both rails' bump code is inert-but-safe:
no offers anywhere, legacy totals byte-identical, seller PUT endpoints
answer an honest 500.

## What each part unlocks

1. `shop_products.bump_product_id` + `bump_percent_off` — the shops
   seller's attachment setting. Unlocks: shops attach endpoint, buyer
   `bump` offers on the public shop page, `includeBumps` at cart
   checkout.
2. `shop_events.bump_for_product_id` — marks a shop_events order row
   as a bump line and names the cart product it was attached through.
   Unlocks: the `isBump` flag on shops receipts/order records. (Rows
   still record + reconcile without it — the write is best-effort —
   they just can't be labelled as add-on lines.)
3. `digital_bump_offers` table — the digital-store attachment (items
   span profile_tracks / profile_videos / playlists, so one keyed
   table instead of columns on three catalog tables). Unlocks: the
   digital attach endpoint, item-page `bump` offers, `includeBump` at
   digital checkout.
4. `digital_sales.bump_*` columns — the purchased bump as its own line
   on the sale row. Unlocks: `lines[]` on digital verify / purchases /
   sales receipts.

## Exact SQL — `lib/db/migrations/0206_more_rails_order_bumps.sql`

```sql
-- 0206: Order bumps for the shops-cart and digital-store rails
-- (Stack-100 #3, feature #13 follow-on). The storefront rail's bump
-- persistence is 0205. A seller attaches ONE add-on product/item to a
-- product; the buyer can tick it at checkout and it rides the same
-- Stripe session as a second line.
--
-- Shops: the attachment lives on shop_products (same shape as
-- store_products in 0205); the purchased add-on is its own shop_events
-- row (one row per cart line, as always on this rail) marked with
-- bump_for_product_id = the cart product it was attached through.
-- amount_cents / platform_fee_cents on every row stay that LINE's
-- amounts, exactly as the rail has always recorded them.
--
-- Digital store: items live in three catalog tables, so the
-- attachment lives in one keyed table, digital_bump_offers. The
-- purchased add-on lives as its own line ON the sale row
-- (digital_sales.bump_*), while amount_cents / platform_fee_cents /
-- creator_amount_cents stay SESSION TOTALS so every existing reader
-- (purchases, sales, tracker, payouts) keeps reconciling untouched.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS bump_product_id uuid;
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS bump_percent_off integer NOT NULL DEFAULT 0;
ALTER TABLE shop_products
  DROP CONSTRAINT IF EXISTS shop_products_bump_percent_off_range;
ALTER TABLE shop_products
  ADD CONSTRAINT shop_products_bump_percent_off_range
  CHECK (bump_percent_off >= 0 AND bump_percent_off <= 90);

ALTER TABLE shop_events
  ADD COLUMN IF NOT EXISTS bump_for_product_id uuid;

CREATE TABLE IF NOT EXISTS digital_bump_offers (
  item_kind text NOT NULL,
  item_id uuid NOT NULL,
  bump_kind text NOT NULL,
  bump_item_id uuid NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id),
  CONSTRAINT digital_bump_offers_percent_off_range
    CHECK (percent_off >= 0 AND percent_off <= 90)
);

ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_item_kind text;
ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_item_id uuid;
ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_title text;
ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_amount_cents integer;
ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_platform_fee_cents integer;
ALTER TABLE digital_sales
  ADD COLUMN IF NOT EXISTS bump_creator_amount_cents integer;
```

Notes: deliberately NO foreign keys on the bump columns — an order's
bump line is a historical record (title + amounts snapshotted on the
row) and an attachment must survive its target being paused, deleted,
or unpublished, mirroring `store_orders.product_id` (plain uuid, no
FK). No new indexes: lookups are always by product/item/order id (the
digital_bump_offers PK covers its only lookup).

## Matching drizzle additions (same commit as the migration, NOT in this lane)

`lib/db/src/schema/customer-shops.ts`:

```ts
// shopProductsTable:
bump_product_id: uuid("bump_product_id"),
bump_percent_off: integer("bump_percent_off").notNull().default(0),
// + check("shop_products_bump_percent_off_range",
//         sql`${t.bump_percent_off} >= 0 AND ${t.bump_percent_off} <= 90`)

// shopEventsTable:
/** Order bump (feature #13): set on the add-on's own order row — the
    cart product the buyer ticked it through. Null on normal lines. */
bump_for_product_id: uuid("bump_for_product_id"),
```

`lib/db/src/schema/digital-sales.ts`:

```ts
export const digitalBumpOffersTable = pgTable("digital_bump_offers", {
  itemKind:   text("item_kind").notNull().$type<DigitalItemKind>(),
  itemId:     uuid("item_id").notNull(),
  bumpKind:   text("bump_kind").notNull().$type<DigitalItemKind>(),
  bumpItemId: uuid("bump_item_id").notNull(),
  percentOff: integer("percent_off").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.itemKind, t.itemId] }),
  check("digital_bump_offers_percent_off_range", sql`${t.percentOff} >= 0 AND ${t.percentOff} <= 90`),
]);

// digitalSalesTable:
bumpItemKind:           text("bump_item_kind"),
bumpItemId:             uuid("bump_item_id"),
bumpTitle:              text("bump_title"),
bumpAmountCents:        integer("bump_amount_cents"),
bumpPlatformFeeCents:   integer("bump_platform_fee_cents"),
bumpCreatorAmountCents: integer("bump_creator_amount_cents"),
```

After editing the schema, rebuild the dist (`tsc -b .` from `lib/db`)
before typechecking the api-server, per house rule. No route in this
lane reads these tables through drizzle's query builder (all raw SQL,
defensive), so the dist rebuild is for schema consumers only.
