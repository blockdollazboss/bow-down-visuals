-- Fan Contests (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- contests: one row per creator contest (prize, rules, entry methods,
-- schedule, status, winner + provably-fair draw audit).
-- contest_entries: one row per entry (entrant handle, entry method,
-- verification flag for fraud prevention). The winner draw only considers
-- verified entries.

CREATE TABLE IF NOT EXISTS contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  entry_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  winner_entry_id UUID,
  draw_audit JSONB,
  announcement_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contests_user_id_idx
  ON contests (user_id);

CREATE TABLE IF NOT EXISTS contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL,
  handle TEXT NOT NULL,
  email TEXT,
  entry_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contest_entries_contest_id_idx
  ON contest_entries (contest_id);

CREATE INDEX IF NOT EXISTS contest_entries_handle_idx
  ON contest_entries (handle);
