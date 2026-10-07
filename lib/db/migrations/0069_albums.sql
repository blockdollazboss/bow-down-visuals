-- Album/EP Builder (Suno library parity). Idempotent.
-- albums: creator-owned album drafts + published albums.
-- album_tracks: ordered tracklist; references songs owned by the album owner.
CREATE TABLE IF NOT EXISTS albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  album_type TEXT NOT NULL DEFAULT 'album',
  release_notes TEXT NOT NULL DEFAULT '',
  cover_art_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS album_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT album_tracks_unique UNIQUE (album_id, song_id)
);

CREATE INDEX IF NOT EXISTS albums_user_id_idx ON albums(user_id);
CREATE INDEX IF NOT EXISTS albums_slug_idx ON albums(slug);
CREATE INDEX IF NOT EXISTS albums_status_idx ON albums(status);
CREATE INDEX IF NOT EXISTS album_tracks_album_id_idx ON album_tracks(album_id);
CREATE INDEX IF NOT EXISTS album_tracks_position_idx ON album_tracks(album_id, position);
