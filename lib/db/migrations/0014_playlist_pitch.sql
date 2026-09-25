-- Playlist Pitcher pitch tracker (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- playlist_pitches: one row per pitch a creator sends to a playlist
-- curator. Tracks the outreach pipeline: sent -> pending -> accepted
-- (or rejected). User-scoped; deleting a user should cascade via
-- application logic (rows carry no other foreign keys).

CREATE TABLE IF NOT EXISTS playlist_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_title TEXT NOT NULL,
  artist_name TEXT,
  curator_name TEXT,
  playlist_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playlist_pitches_user_id_idx
  ON playlist_pitches (user_id);

CREATE INDEX IF NOT EXISTS playlist_pitches_user_status_idx
  ON playlist_pitches (user_id, status);
