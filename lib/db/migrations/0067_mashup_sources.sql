-- Song Mashup (Suno parity). Idempotent.
-- songs gains mashup provenance columns: which two songs a mashup was
-- blended from, and which blend style was used. Albums already exist
-- (0066_albums.sql); no new album tables needed here.
--
-- Deploy repair (2026-10-25): songs is created by
-- 0001_artist_voice_and_songs.sql, which sits at/below the migrate-boot
-- BASELINE (55) — the boot runner skips <= 0055 on existing databases,
-- assuming they were applied manually pre-runner. On a database where
-- 0001 never ran, the ALTERs below FATAL ("relation songs does not
-- exist") and stall the whole boot chain — the same gap that killed the
-- bc755447 deploy at 0207 (collab_requests). Where this file has already
-- applied, the runner skips it by filename, so this edit never re-runs;
-- IF NOT EXISTS makes the guard a no-op where the table already exists.
-- Definition copied exactly from 0001.
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

ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_sources JSONB;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_style TEXT;
