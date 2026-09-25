-- Music distribution releases (v1: prepare + track).
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS distribution_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  release_date TEXT,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  audio_url TEXT,
  artwork_url TEXT,
  metadata JSONB,
  strategy JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS distribution_releases_user_idx ON distribution_releases (user_id);
