-- Pre-save page upgrades (HyperFollow parity): artist-customizable platform
-- URLs, headline, share-unlock bonus content, plus fan follow / share
-- tracking tables. Everything idempotent — safe to retry after a partial
-- failure.
ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS presave_headline text;
ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS presave_platform_links jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS presave_bonus_url text;

-- Fans who pre-saved / joined the notify list on a pre-save page.
-- One row per (release, email); email doubles as the email-list
-- subscriber source on the artist's list.
CREATE TABLE IF NOT EXISTS presave_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  platform TEXT,
  source TEXT NOT NULL DEFAULT 'presave',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, email)
);
CREATE INDEX IF NOT EXISTS presave_follows_release_idx
  ON presave_follows (release_id);

-- Share-unlock tracking: one row per share action on a pre-save page.
CREATE TABLE IF NOT EXISTS presave_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  channel TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presave_shares_release_idx
  ON presave_shares (release_id);
