-- 0058: Re-apply 0019 (content scheduler table).
--
-- 0019 predates the automatic migration runner (migrate-boot.mjs) and was
-- applied manually — but it never ran on the production database. The
-- scheduler's due-claim poller crashes every tick with
-- `relation "scheduled_posts" does not exist`.
--
-- 0019's DDL is fully idempotent (IF NOT EXISTS throughout; the UPDATE
-- mentioned in its header is a runtime query pattern, not part of the
-- migration), so re-applying it here is a safe no-op on databases where it
-- already ran.

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
