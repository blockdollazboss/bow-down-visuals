-- 0206: Order bumps for the storefront rail (Stack-100 #3, feature
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
