-- Fan Memberships: fan clubs with paid tiers + member tracking.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- v1 honesty contract: tier setup + member tracking are real. Actual payment
-- processing is "coming soon" — members are tracked manually until Stripe
-- billing lands. external_ref holds the future Stripe subscription id.
-- Must stay in sync with lib/db/src/schema/fan-memberships.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).
--
-- COLLISION NOTE: sibling feature branches also used the 0008_* prefix.
-- Renumber sequentially at integration time (0008, 0009, 0010, ...).

CREATE TABLE IF NOT EXISTS fan_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  perks JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active TEXT NOT NULL DEFAULT 'true',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fan_tiers_user_id_idx
  ON fan_tiers (user_id);

CREATE TABLE IF NOT EXISTS fan_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tier_id UUID NOT NULL,
  fan_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  price_cents INTEGER NOT NULL DEFAULT 0,
  external_ref TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fan_members_user_id_idx
  ON fan_members (user_id);

CREATE INDEX IF NOT EXISTS fan_members_tier_id_idx
  ON fan_members (tier_id);

CREATE UNIQUE INDEX IF NOT EXISTS fan_members_tier_fan_ux
  ON fan_members (tier_id, fan_label);
