-- Homepage "Featured Songs" playlist (owner-curated).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- featured_songs: one row per playlist track, ordered by `position`.
-- The Bow Down Visuals theme song is served as the built-in default when
-- the table is empty, so the playlist always has content.

CREATE TABLE IF NOT EXISTS featured_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT 'Bow Down Visuals',
  audio_url TEXT NOT NULL,
  audio_path TEXT,
  duration_label TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS featured_songs_position_idx
  ON featured_songs (position ASC);
