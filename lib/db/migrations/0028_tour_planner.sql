-- Tour Planner (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- tour_dates: one row per show per user. City, venue, show date, freeform
-- notes (load-in, promoter contact, ticket link), and a lifecycle status.
-- Date management is free (pure data); only the AI routing + budget plan
-- costs credits and that result is returned in the response, not persisted.

CREATE TABLE IF NOT EXISTS tour_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  city TEXT NOT NULL,
  venue TEXT NOT NULL,
  show_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tour_dates_user_id_idx
  ON tour_dates (user_id);
