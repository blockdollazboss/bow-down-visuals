-- Creator Streaming Platform — Social v2 (0097).
--
-- Worker 8. Polls (2-3 star composer), scheduled posts + audience targeting
-- (4-6 star composer). Scheduled posts need no cron: the feed filters
-- `scheduled_for IS NULL OR scheduled_for <= now()`, so a scheduled post
-- simply appears when its time comes.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  vote_count INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poll_options_post_id_idx
  ON poll_options (post_id);

CREATE TABLE IF NOT EXISTS poll_votes (
  user_id UUID NOT NULL,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS poll_votes_option_idx
  ON poll_votes (option_id);

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_audience_check'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_audience_check
      CHECK (audience IN ('public', 'followers'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_scheduled_for_idx
  ON posts (scheduled_for);
