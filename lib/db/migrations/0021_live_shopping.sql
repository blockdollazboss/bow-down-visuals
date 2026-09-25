-- Live Shopping (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- live_shop_products: per-user product catalog. external_url is the creator's
-- own checkout link (Stripe/Shopify/etc.) — platform checkout is "coming
-- soon", so v1 overlays link out rather than processing payments.
-- live_shop_streams: selling sessions with an optional pinned product shown
-- in the overlay.
-- live_shop_sales: recorded sales with a 5% platform fee snapshot
-- (platform_fee_cents). Checkout is simulated in v1 — sales recorded via
-- the API are test/demo sales until platform checkout ships.
-- live_shop_alerts: the purchase-alert feed an overlay polls for popups.

CREATE TABLE IF NOT EXISTS live_shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  external_url TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_shop_products_user_id_idx
  ON live_shop_products (user_id);

CREATE TABLE IF NOT EXISTS live_shop_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  pinned_product_id UUID REFERENCES live_shop_products(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_shop_streams_user_id_idx
  ON live_shop_streams (user_id);

CREATE TABLE IF NOT EXISTS live_shop_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stream_id UUID REFERENCES live_shop_streams(id) ON DELETE SET NULL,
  product_id UUID REFERENCES live_shop_products(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_shop_sales_user_id_idx
  ON live_shop_sales (user_id);
CREATE INDEX IF NOT EXISTS live_shop_sales_stream_id_idx
  ON live_shop_sales (stream_id);

CREATE TABLE IF NOT EXISTS live_shop_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stream_id UUID NOT NULL REFERENCES live_shop_streams(id) ON DELETE CASCADE,
  product_id UUID REFERENCES live_shop_products(id) ON DELETE SET NULL,
  buyer_name TEXT NOT NULL DEFAULT 'A viewer',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS live_shop_alerts_stream_id_idx
  ON live_shop_alerts (stream_id);
