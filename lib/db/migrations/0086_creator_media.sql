-- Creator Streaming Platform — Foundation (0086): profile_tracks, profile_videos, playlists.
--
-- Media owned by a creator_profile (NOT the legacy artist_vaults tables).
-- download_price_cents: 0 = stream-only, >0 = paid download (digital_sales 0088).
-- playlist items: JSONB array of {kind:'track'|'video', id: <uuid>} entries.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS profile_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  artwork_url TEXT,
  genre TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  isrc TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  download_price_cents INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_tracks_profile_id_idx
  ON profile_tracks (profile_id);
CREATE INDEX IF NOT EXISTS profile_tracks_profile_published_idx
  ON profile_tracks (profile_id, is_published);

CREATE TABLE IF NOT EXISTS profile_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  genre TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  download_price_cents INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  repost_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_videos_profile_id_idx
  ON profile_videos (profile_id);
CREATE INDEX IF NOT EXISTS profile_videos_profile_published_idx
  ON profile_videos (profile_id, is_published);

CREATE TABLE IF NOT EXISTS playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  items JSONB NOT NULL DEFAULT '[]',
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlists_owner_profile_id_idx
  ON playlists (owner_profile_id);
