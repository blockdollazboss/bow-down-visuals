-- Customer shops — every customer gets their OWN storefront.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Shops are user-scoped; the public storefront lives at /shop/:handle.
-- Custom domains are a marked coming-soon — v1 never fakes them.
-- Must stay in sync with lib/db/src/schema/customer-shops.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).
--
-- NOTE: sibling feature branches also used the 0008_ prefix
-- (sponsor deals, distribution, discord). Renumber at merge time so only
-- one 0008 exists on main.

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  tagline TEXT,
  description TEXT,
  banner_color TEXT NOT NULL DEFAULT '#0a0a0a',
  accent_color TEXT NOT NULL DEFAULT '#d4af37',
  banner_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shops_user_id_idx
  ON shops (user_id);

CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  image_url TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_products_shop_id_idx
  ON shop_products (shop_id);

CREATE INDEX IF NOT EXISTS shop_products_user_id_idx
  ON shop_products (user_id);
