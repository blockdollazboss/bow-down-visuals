-- Album/EP Builder (Suno library parity). Idempotent.
-- albums: creator-owned album drafts + published albums.
-- album_tracks: ordered tracklist; references songs owned by the album owner.
--
-- Deploy repair (2026-10-25): songs is created by
-- 0001_artist_voice_and_songs.sql, which sits at/below the migrate-boot
-- BASELINE (55) — the boot runner skips <= 0055 on existing databases,
-- assuming they were applied manually pre-runner. On a database where
-- 0001 never ran, the album_tracks FK to songs below FATALs ("relation
-- songs does not exist") and stalls the whole boot chain — the same gap
-- that killed the bc755447 deploy at 0207 (collab_requests). Where this
-- file has already applied, the runner skips it by filename, so this
-- edit never re-runs; IF NOT EXISTS makes the guard a no-op where the
-- table already exists. Definition copied exactly from 0001.
CREATE TABLE IF NOT EXISTS songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  audio_path TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  parent_song_id UUID,
  artist_vault_id UUID,
  duration_sec TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS songs_user_id_idx ON songs (user_id);

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
