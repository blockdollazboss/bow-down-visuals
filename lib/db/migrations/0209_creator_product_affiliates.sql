-- 0209_creator_product_affiliates.sql
-- Creator Product Affiliates (#16): a creator enables affiliates per product
-- and sets the commission % themselves; a fan shares a per-product code/link;
-- a sale through it records the commission owed in affiliate_sales. The
-- commission comes out of the SELLER's net — the platform fee stays the flat
-- 5% (PLATFORM_FEE_BPS) and the buyer's price never changes.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (migrate-boot rules).

-- Per-product affiliate settings (creator-set; NULL bps = not set).
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS affiliate_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS affiliate_commission_bps integer;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS affiliate_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS affiliate_commission_bps integer;

DO $$ BEGIN
  ALTER TABLE store_products ADD CONSTRAINT store_products_affiliate_bps_check
    CHECK (affiliate_commission_bps IS NULL OR affiliate_commission_bps BETWEEN 1 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shop_products ADD CONSTRAINT shop_products_affiliate_bps_check
    CHECK (affiliate_commission_bps IS NULL OR affiliate_commission_bps BETWEEN 1 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The shops rail carries the presented code from the pending order rows
-- through the guarded paid flip (lib/market-sale), same as discount_code (0190).
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS affiliate_code text;

-- One fan's share code for one product on one surface.
CREATE TABLE IF NOT EXISTS affiliate_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  affiliate_user_id uuid NOT NULL,
  seller_user_id uuid NOT NULL,
  surface text NOT NULL CHECK (surface IN ('store_product', 'shop_product')),
  product_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_codes_code_ux ON affiliate_codes (UPPER(code));
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_codes_affiliate_product_ux
  ON affiliate_codes (affiliate_user_id, surface, product_id);
CREATE INDEX IF NOT EXISTS affiliate_codes_seller_idx ON affiliate_codes (seller_user_id);
CREATE INDEX IF NOT EXISTS affiliate_codes_product_idx ON affiliate_codes (surface, product_id);

-- The commission ledger: one row per attributed product-sale line.
-- status 'owed' at record time; 'paid' is set only by the existing creator
-- payout settlement rails — this feature never moves money itself.
-- UNIQUE(surface, order_ref, product_id) is the exactly-once guard:
-- order_ref is the Stripe checkout session id (storefront rail) or the
-- checkout_group_id (shops rail, one row per product line).
CREATE TABLE IF NOT EXISTS affiliate_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code_id uuid NOT NULL REFERENCES affiliate_codes(id) ON DELETE CASCADE,
  affiliate_user_id uuid NOT NULL,
  seller_user_id uuid NOT NULL,
  surface text NOT NULL CHECK (surface IN ('store_product', 'shop_product')),
  product_id uuid,
  product_title text NOT NULL DEFAULT '',
  order_ref text NOT NULL,
  buyer_user_id uuid,
  buyer_email text,
  gross_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  seller_net_cents integer NOT NULL DEFAULT 0,
  commission_bps integer NOT NULL,
  commission_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_sales_once_ux
  ON affiliate_sales (surface, order_ref, product_id);
CREATE INDEX IF NOT EXISTS affiliate_sales_seller_idx ON affiliate_sales (seller_user_id, created_at);
CREATE INDEX IF NOT EXISTS affiliate_sales_affiliate_idx ON affiliate_sales (affiliate_user_id, created_at);
CREATE INDEX IF NOT EXISTS affiliate_sales_code_idx ON affiliate_sales (affiliate_code_id);
