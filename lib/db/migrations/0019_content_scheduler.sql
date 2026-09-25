-- Content Scheduler — DB-backed scheduled social posts.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- The scheduler is server-owned and restart-safe: posts move
-- draft → scheduled → publishing → posted|failed through this table, and the
-- job-poller tick claims due rows with a single atomic
-- UPDATE … WHERE status='scheduled'. No in-memory state, so a deploy or
-- restart can never lose or double-fire a scheduled post.
--
-- Money model: scheduling charges 1 credit per scheduled post up front
-- (regardless of platform count), recorded in credits_charged and
-- refunded on cancel or total provider failure. Drafts are free.
--
-- Must stay in sync with lib/db/src/schema/scheduled-posts.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'video',
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  account_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  credits_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  ai_best_time JSONB,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_posts_user_id_idx
  ON scheduled_posts (user_id);
CREATE INDEX IF NOT EXISTS scheduled_posts_status_idx
  ON scheduled_posts (status);
CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx
  ON scheduled_posts (status, scheduled_at);
