-- Royalty Tracker (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- royalty_entries: one row per song × platform × reporting period.
--   Amounts are NUMERIC(12,2) — exact cents, never float.
-- royalty_platform_connections: platforms the user linked (OAuth or manual).
-- royalty_payouts: expected vs received distributor payouts.

CREATE TABLE IF NOT EXISTS royalty_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_title TEXT NOT NULL,
  artist_name TEXT,
  platform TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  streams TEXT,
  gross_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS royalty_entries_user_id_idx
  ON royalty_entries (user_id);
CREATE INDEX IF NOT EXISTS royalty_entries_user_song_idx
  ON royalty_entries (user_id, song_title);
CREATE INDEX IF NOT EXISTS royalty_entries_user_platform_idx
  ON royalty_entries (user_id, platform);

CREATE TABLE IF NOT EXISTS royalty_platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  connection_type TEXT NOT NULL DEFAULT 'manual',
  account_label TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS royalty_platform_connections_user_id_idx
  ON royalty_platform_connections (user_id);

CREATE TABLE IF NOT EXISTS royalty_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  distributor TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  expected_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'expected',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS royalty_payouts_user_id_idx
  ON royalty_payouts (user_id);
