-- PR #17 — artist voice lock + songs library.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.

-- 1) Locked-voice columns on artist_vaults (from the voice-lock work)
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_id TEXT;
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_name TEXT;
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_preview_url TEXT;

-- 2) Songs library (uploads, generated saves, remixes)
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
