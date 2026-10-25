-- 0243: Theme packs → whole-device kits (Stack-200 UPGRADES item 39).
-- Buyer customization storage (the capstone: every one of the 12 kit
-- components is buyer-customizable per component, per device) and
-- creator-made packs (creators design packs from a house base + the
-- customization layer and sell/give them; sales ride the flat-5% fee
-- law through lib/platform-fees and the exactly-once anchor below).
-- Creator-pack ownership reuses theme_pack_purchases with
-- pack_id = 'creator:<uuid>' — no second ownership table.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS theme_pack_customizations (
  user_id text NOT NULL,
  pack_id text NOT NULL,
  component text NOT NULL,
  device text NOT NULL DEFAULT 'all',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id, component, device)
);

CREATE TABLE IF NOT EXISTS creator_theme_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL,
  name text NOT NULL,
  base_pack_id text NOT NULL,
  price_vb integer NOT NULL DEFAULT 0,
  mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_theme_packs_creator_idx
  ON creator_theme_packs (creator_user_id);
CREATE INDEX IF NOT EXISTS creator_theme_packs_published_idx
  ON creator_theme_packs (published) WHERE published = true;
