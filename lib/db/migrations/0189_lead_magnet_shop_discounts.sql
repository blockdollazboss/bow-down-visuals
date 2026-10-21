-- 0189: $0 lead-magnet storefront products + marketplace shop discount codes
-- (competitor gap, ~/workspace/competitor-study/creator-business.md).
--
-- Two asymmetries closed:
--  1) store_products.price_cents was CHECK (price_cents > 0) — a creator
--     could not list a $0 lead-magnet product, the standard
--     freebie-for-email funnel. The check relaxes to >= 0. A $0 product
--     is NEVER checked out (no Stripe session exists for $0); it is
--     claimed through POST /api/storefront/claim, which subscribes the
--     buyer to the creator's email list and delivers on the existing
--     store delivery rail.
--  2) Marketplace shops (shops / shop_products / shop_events) had NO
--     discount codes while the profile storefront did. shop_discount_codes
--     copies the discount_codes model from 0099 field-for-field, keyed by
--     shop instead of creator profile: percent 1..90, max_uses (-1 =
--     unlimited), used_count, expires_at, is_active, one code name per
--     shop. shop_events.discount_code carries the code a checkout used
--     from the pending rows (0144/0146) through the paid flip, where the
--     use is counted — the storefront's redemption discipline (uses are
--     counted when the sale is recorded, never at validate).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

-- ── 1) store_products: allow $0 ──────────────────────────────────────
-- The 0099 DDL wrote the check inline (Postgres default name
-- store_products_price_cents_check); the drizzle schema names it
-- store_products_price_check. Drop both spellings, add the relaxed
-- check once under the schema's name.
ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_price_check;
ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_price_cents_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_products_price_check'
      AND conrelid = 'store_products'::regclass
  ) THEN
    ALTER TABLE store_products
      ADD CONSTRAINT store_products_price_check CHECK (price_cents >= 0);
  END IF;
END $$;

-- ── 2) shop_discount_codes ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_discount_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  percent_off INT NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  -- -1 = unlimited uses.
  max_uses    INT NOT NULL DEFAULT -1,
  used_count  INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, code)
);

CREATE INDEX IF NOT EXISTS shop_discount_codes_shop_idx
  ON shop_discount_codes (shop_id);

-- ── 3) shop_events: the discount code a checkout used ────────────────
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS discount_code TEXT;
