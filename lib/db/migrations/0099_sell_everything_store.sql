-- Creator Streaming Platform - Sell Everything storefront (0099).
--
-- One unified store per creator profile: sell downloads, merch, digital goods,
-- services/bookings, and event tickets from the creator's public page.
-- Worker 5 owns digital_sales (music downloads); this is the SEPARATE
-- "sell everything" catalog. Worker 9 owns events - store_products.event_id
-- references the existing events table; ticket purchases create event_rsvps.
--
-- Money rules (standing): SALES = real money via Stripe; Visual Bucs = AI
-- credits. The two economies are NEVER mixed in UI copy or accounting.
-- Platform fee (default 10%, STOREFRONT_PLATFORM_FEE_BPS) comes out of the
-- SELLER's cut - the buyer pays the listed price, nothing extra.
-- Creator payouts need Stripe Connect - NOT built here; creator_amount_cents
-- is tracked as a pending-payout balance.
--
-- Idempotent: safe to re-run.

-- -- store_products --
CREATE TABLE IF NOT EXISTS store_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('download','merch','digital','service','ticket')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_cents     INT NOT NULL CHECK (price_cents > 0),
  compare_at_cents INT CHECK (compare_at_cents IS NULL OR compare_at_cents > 0),
  -- -1 = unlimited / digital. 0 = sold out (blocks checkout).
  inventory       INT NOT NULL DEFAULT -1,
  media_urls      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- services: {duration_min, location, booking_calendar_link, notes}
  service_details JSONB,
  -- tickets -> Worker 9's events. Nullable FK so a missing events table
  -- (or a dropped event) never blocks the migration.
  event_id        UUID,
  -- Link graph: [{label, url}] - the track, the video, the drop page, etc.
  -- the product relates to. Kept alongside media_urls (which are assets).
  related_links   JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_products_profile_idx
  ON store_products (profile_id);
CREATE INDEX IF NOT EXISTS store_products_profile_active_idx
  ON store_products (profile_id, is_active);
CREATE INDEX IF NOT EXISTS store_products_event_idx
  ON store_products (event_id)
  WHERE event_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_products_event_fk'
      AND conrelid = 'store_products'::regclass
  ) THEN
    ALTER TABLE store_products
      ADD CONSTRAINT store_products_event_fk
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -- store_orders --
CREATE TABLE IF NOT EXISTS store_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id       UUID,
  profile_id          UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  product_id          UUID REFERENCES store_products(id) ON DELETE SET NULL,
  product_title       TEXT NOT NULL DEFAULT '',
  product_kind        TEXT NOT NULL DEFAULT 'digital',
  quantity            INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_cents        INT NOT NULL CHECK (amount_cents >= 0),
  discount_code       TEXT,
  platform_fee_cents  INT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  creator_amount_cents INT NOT NULL DEFAULT 0 CHECK (creator_amount_cents >= 0),
  stripe_session_id   TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'completed',
  -- services: booking state (pending_confirmation -> confirmed); tickets:
  -- rsvp_created flag; merch: handed to the merch/print pipeline.
  fulfillment_note    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_orders_profile_idx
  ON store_orders (profile_id);
CREATE INDEX IF NOT EXISTS store_orders_buyer_idx
  ON store_orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS store_orders_product_idx
  ON store_orders (product_id);
CREATE INDEX IF NOT EXISTS store_orders_created_idx
  ON store_orders (created_at DESC);

-- -- discount_codes --
CREATE TABLE IF NOT EXISTS discount_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  percent_off INT NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
  -- -1 = unlimited uses.
  max_uses    INT NOT NULL DEFAULT -1,
  used_count  INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, code)
);

CREATE INDEX IF NOT EXISTS discount_codes_profile_idx
  ON discount_codes (profile_id);

-- -- store_delivery_tokens --
-- Instant delivery for kind='digital' - reuses Worker 5's signed-link
-- concept (HMAC-signed token, expiry, max uses), separate table so the
-- storefront never touches digital_sales rows.
CREATE TABLE IF NOT EXISTS store_delivery_tokens (
  token      TEXT PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  file_url   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_delivery_tokens_order_idx
  ON store_delivery_tokens (order_id);
