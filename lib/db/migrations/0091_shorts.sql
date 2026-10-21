-- Creator Streaming Platform — Shorts / TikTok mechanics (0091).
--
-- Adds TikTok-style columns to profile_videos (is_short, duet/stitch links,
-- sound metadata) and new challenges + challenge_entries tables.
--
-- Idempotent: every statement is safe to re-run.

-- ── profile_videos: shorts + duet/stitch + sound columns ──────────────────
ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS is_short BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS duet_with UUID REFERENCES profile_videos(id) ON DELETE SET NULL;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS stitch_with UUID REFERENCES profile_videos(id) ON DELETE SET NULL;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS sound_id TEXT;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS sound_title TEXT;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS sound_url TEXT;

ALTER TABLE profile_videos
  ADD COLUMN IF NOT EXISTS sound_use_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS profile_videos_is_short_idx
  ON profile_videos (is_short);

CREATE INDEX IF NOT EXISTS profile_videos_sound_id_idx
  ON profile_videos (sound_id);

CREATE INDEX IF NOT EXISTS profile_videos_published_short_idx
  ON profile_videos (is_published, is_short, created_at DESC);

-- ── challenges ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hashtag TEXT NOT NULL,
  cover_url TEXT,
  creator_profile_id UUID REFERENCES creator_profiles(id) ON DELETE SET NULL,
  -- Money angle: the prize / earning hook shown on the challenge page.
  prize_text TEXT NOT NULL DEFAULT '',
  entry_count INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS challenges_slug_idx
  ON challenges (slug);

CREATE INDEX IF NOT EXISTS challenges_popularity_idx
  ON challenges (entry_count DESC, total_views DESC);

CREATE TABLE IF NOT EXISTS challenge_entries (
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES profile_videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, video_id)
);

CREATE INDEX IF NOT EXISTS challenge_entries_video_idx
  ON challenge_entries (video_id);
