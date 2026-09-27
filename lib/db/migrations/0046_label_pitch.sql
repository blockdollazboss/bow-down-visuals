-- Label Pitch submission tracker (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- label_pitches: one row per demo submission a creator sends to a record
-- label. Tracks the outreach pipeline: sent -> pending -> signed
-- (or passed). User-scoped; deleting a user should cascade via
-- application logic (rows carry no other foreign keys).

CREATE TABLE IF NOT EXISTS label_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_title TEXT NOT NULL,
  artist_name TEXT,
  label_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS label_pitches_user_id_idx
  ON label_pitches (user_id);

CREATE INDEX IF NOT EXISTS label_pitches_user_status_idx
  ON label_pitches (user_id, status);
