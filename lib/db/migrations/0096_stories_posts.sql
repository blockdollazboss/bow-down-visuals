-- Creator Streaming Platform — Stories / Posts / Reactions (0091).
--
-- Worker 8 (STORIES / POSTS / REACTIONS).
-- stories (24h expiring), story_highlights, posts (post/thread_reply/quote/
-- repost with reply/quote/repost chains), reactions (expanded emoji set
-- across post/track/video/profile), saves (bookmarks), plus the is_verified
-- badge flag on creator_profiles.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'image',
  caption TEXT NOT NULL DEFAULT '',
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stories_profile_id_idx
  ON stories (profile_id);
CREATE INDEX IF NOT EXISTS stories_expires_at_idx
  ON stories (expires_at);

CREATE TABLE IF NOT EXISTS story_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cover_url TEXT,
  story_ids JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_highlights_profile_id_idx
  ON story_highlights (profile_id);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'post',
  reply_to UUID REFERENCES posts(id),
  quote_of UUID REFERENCES posts(id),
  repost_of UUID REFERENCES posts(id),
  group_id UUID,
  like_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive CHECK for deploys that somehow have the table without it
-- (CREATE TABLE IF NOT EXISTS won't re-run, so the check must be separate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_kind_check'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_kind_check
      CHECK (kind IN ('post', 'thread_reply', 'quote', 'repost'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_profile_id_idx
  ON posts (profile_id);
CREATE INDEX IF NOT EXISTS posts_created_at_idx
  ON posts (created_at);
CREATE INDEX IF NOT EXISTS posts_reply_to_idx
  ON posts (reply_to);
CREATE INDEX IF NOT EXISTS posts_repost_of_idx
  ON posts (repost_of);

CREATE TABLE IF NOT EXISTS reactions (
  user_id UUID NOT NULL,
  target_kind TEXT NOT NULL,
  target_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS reactions_target_idx
  ON reactions (target_kind, target_id);

CREATE TABLE IF NOT EXISTS saves (
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, target_id)
);

CREATE INDEX IF NOT EXISTS saves_user_idx
  ON saves (user_id);

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;

-- Housekeeping: stories expire by filter (expires_at > now()).
-- This one-line purge is safe to run on any schedule; expiry needs no cron
-- because every read filters on expires_at.
DELETE FROM stories WHERE expires_at < now() - INTERVAL '7 days';
