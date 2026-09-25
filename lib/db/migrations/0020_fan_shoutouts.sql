-- Fan Shoutouts: creators sell personalized video shoutouts to fans.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- v1 honesty contract: setup + request tracking are real. Actual payment
-- processing is "coming soon" — requests are recorded with status
-- "pending_payment" and no money moves until payment integration ships.
-- The API/UI never report a request as paid or completed in v1.
-- Must stay in sync with lib/db/src/schema/fan-shoutouts.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

CREATE TABLE IF NOT EXISTS shoutout_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Creator',
  price_cents INTEGER NOT NULL DEFAULT 0,
  turnaround_days INTEGER NOT NULL DEFAULT 7,
  guidelines TEXT,
  accepting TEXT NOT NULL DEFAULT 'false',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shoutout_settings_user_id_ux
  ON shoutout_settings (user_id);

CREATE INDEX IF NOT EXISTS shoutout_settings_accepting_idx
  ON shoutout_settings (accepting);

CREATE TABLE IF NOT EXISTS shoutout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id UUID NOT NULL,
  fan_name TEXT NOT NULL,
  fan_email TEXT,
  occasion TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  price_cents INTEGER NOT NULL DEFAULT 0,
  delivery_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shoutout_requests_creator_idx
  ON shoutout_requests (creator_user_id);

CREATE INDEX IF NOT EXISTS shoutout_requests_status_idx
  ON shoutout_requests (status);
