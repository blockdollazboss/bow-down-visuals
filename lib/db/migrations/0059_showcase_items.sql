-- 0059: Public showcase galleries.
--
-- Opt-in public showcase where creators publish their thumbnails, videos,
-- and songs. Each item gets an indexable slug URL; creators share their own
-- showcase links (viral loop). Likes are deduped by a voter fingerprint
-- (hash of IP + user agent) so the counts are honest without requiring login.
--
-- Safe to run anywhere: all statements are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS showcase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'image',
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  creator_name TEXT NOT NULL DEFAULT 'Anonymous Creator',
  likes INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS showcase_items_created_idx
  ON showcase_items (created_at DESC);

CREATE INDEX IF NOT EXISTS showcase_items_type_idx
  ON showcase_items (media_type);

CREATE TABLE IF NOT EXISTS showcase_likes (
  item_id UUID NOT NULL REFERENCES showcase_items(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, voter_key)
);
