-- 0219: Order bumps for the shops-cart and digital-store rails
-- (Stack-100 #3, feature #13 follow-on). The storefront rail's bump
-- persistence is 0206. A seller attaches ONE add-on product/item to a
-- product; the buyer can tick it at checkout and it rides the same
-- Stripe session as a second line.
--
-- Shops: the attachment lives on shop_products (same shape as
-- store_products in 0206); the purchased add-on is its own shop_events
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
