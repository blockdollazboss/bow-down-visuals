-- Customer storefronts v2 — custom domains + analytics events.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Must stay in sync with lib/db/src/schema/customer-shops.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

-- ── Custom domain columns on shops ──────────────────────────────────────
ALTER TABLE shops ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;

-- One domain per shop, one shop per domain.
CREATE UNIQUE INDEX IF NOT EXISTS shops_custom_domain_unique_idx
  ON shops (custom_domain) WHERE custom_domain IS NOT NULL;

-- ── Shop events (analytics: views + sales) ──────────────────────────────
CREATE TABLE IF NOT EXISTS shop_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  product_id UUID,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  buyer_email TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_events_shop_id_idx
  ON shop_events (shop_id);
CREATE INDEX IF NOT EXISTS shop_events_shop_type_time_idx
  ON shop_events (shop_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_events_view_dedup_idx
  ON shop_events (shop_id, ip_hash, created_at DESC)
  WHERE event_type = 'view' AND ip_hash IS NOT NULL;
