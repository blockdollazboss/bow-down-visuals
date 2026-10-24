# MIGRATION NEEDED — post-purchase upsell (Stack-100 #3, Wave 3, Lane 1)

⛔ This lane does NOT write migrations (house rule). The feature is
built, tested against the post-migration DDL, and inert-but-honest
before this lands (verify records orders exactly as today with
`upsell: null`; the upsell endpoints answer 500 `UPSELL_UNAVAILABLE`).
Land this in the same stack as the branch, AFTER 0205 (order bumps).

## Exact migration — `lib/db/migrations/0206_storefront_post_purchase_upsell.sql`

```sql
-- 0206: Post-purchase one-click upsell for the storefront rail
-- (Stack-100 #3, Wave 3). After a purchase completes, the buyer is
-- offered the product's designated add-on (the SAME seller attachment
-- as the checkout bump: store_products.bump_product_id /
-- bump_percent_off) once, and can accept in one click — charged
-- off-session to the payment method saved by the completed checkout
-- through a PaymentIntent with a deterministic idempotency key.
--
-- The offer state lives in store_upsell_offers: ONE row per parent
-- order (UNIQUE parent_order_id), carrying the price/fee snapshot the
-- buyer saw, the saved Stripe customer + payment method, and the
-- decision. An accepted upsell records as its OWN store_orders row,
-- linked back by parent_order_id and pinned exactly-once by the
-- UNIQUE stripe_payment_intent_id.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text UNIQUE;

CREATE TABLE IF NOT EXISTS store_upsell_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL UNIQUE,
  buyer_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  product_id uuid NOT NULL,
  upsell_product_id uuid NOT NULL,
  upsell_title text NOT NULL,
  upsell_kind text NOT NULL,
  list_price_cents integer NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL,
  creator_amount_cents integer NOT NULL,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_method_brand text,
  payment_method_last4 text,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  stripe_payment_intent_id text,
  upsell_order_id uuid,
  shown_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_upsell_offers
  DROP CONSTRAINT IF EXISTS store_upsell_offers_status_range;
ALTER TABLE store_upsell_offers
  ADD CONSTRAINT store_upsell_offers_status_range
  CHECK (status IN ('pending', 'accepted', 'declined', 'failed'));
```

Notes: deliberately NO foreign keys — an offer/order is a historical
record and must survive product deactivation/deletion, mirroring
`store_orders.product_id` (plain uuid, no FK). `stripe_payment_intent_id`
UNIQUE allows any number of NULLs (every non-upsell order), so legacy
rows are untouched. No extra indexes: lookups are always by
parent_order_id (unique) or order id.

## Matching drizzle additions (same commit as the migration, NOT in this lane)

`lib/db/src/schema/storefront.ts` — deliberately NOT edited by this
lane (same reasoning as the bumps lane: full-row selects elsewhere
would break before the migration lands). The API rail speaks raw SQL
for all of this, so the additions are for schema completeness:

```ts
// storeOrdersTable:
parentOrderId:        uuid("parent_order_id"),
stripePaymentIntentId: text("stripe_payment_intent_id").unique(),

// new table:
export const storeUpsellOffersTable = pgTable("store_upsell_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentOrderId: uuid("parent_order_id").notNull().unique(),
  buyerUserId: uuid("buyer_user_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  productId: uuid("product_id").notNull(),
  upsellProductId: uuid("upsell_product_id").notNull(),
  upsellTitle: text("upsell_title").notNull(),
  upsellKind: text("upsell_kind").notNull(),
  listPriceCents: integer("list_price_cents").notNull(),
  percentOff: integer("percent_off").notNull().default(0),
  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  creatorAmountCents: integer("creator_amount_cents").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  paymentMethodBrand: text("payment_method_brand"),
  paymentMethodLast4: text("payment_method_last4"),
  status: text("status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  upsellOrderId: uuid("upsell_order_id"),
  shownAt: timestamp("shown_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("store_upsell_offers_status_range",
    sql`${t.status} IN ('pending', 'accepted', 'declined', 'failed')`),
]);
```

After editing the schema, rebuild the dist (`tsc -b .` from `lib/db`)
before typechecking the api-server, per house rule.
