-- Analytics dashboard v1 — follower/media-count snapshots for growth charts.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- The /api/analytics/overview route records one row per connected account
-- per refresh (best-effort); the /analytics page draws follower-growth
-- sparklines from these rows once a few exist.

CREATE TABLE IF NOT EXISTS social_stat_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  account_id UUID,
  followers INTEGER,
  media_count INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_stat_snapshots_user_platform_idx
  ON social_stat_snapshots (user_id, platform, recorded_at);
