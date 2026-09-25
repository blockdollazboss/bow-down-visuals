-- Collab Finder (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- collab_profiles: one public profile per user (niche, platforms/audience,
-- collab interests). Browsing is free.
-- collab_requests: pending/accepted/declined requests between creators.
-- Sending/answering is free (pure interface, no compute).

CREATE TABLE IF NOT EXISTS collab_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  niche TEXT NOT NULL,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  collab_interests TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collab_profiles_user_id_idx
  ON collab_profiles (user_id);

CREATE INDEX IF NOT EXISTS collab_profiles_niche_idx
  ON collab_profiles (niche);

CREATE TABLE IF NOT EXISTS collab_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collab_requests_to_user_id_idx
  ON collab_requests (to_user_id);

CREATE INDEX IF NOT EXISTS collab_requests_from_user_id_idx
  ON collab_requests (from_user_id);
