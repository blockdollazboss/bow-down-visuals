-- Sync Pitch Kit (DistroKid-style sync licensing pitching).
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).
--
-- sync_one_sheets: one row per AI-generated sync one-sheet for a song.
--   content (JSONB) carries the full generated one-sheet text blocks.
--   share_token is a public, unguessable token for the shareable one-sheet link.
-- sync_briefs: user-created sync briefs (TV/film/ad/game) they want to match
--   their catalog songs against.
-- sync_pitches: pitch tracker rows — sent -> pending -> placed (or dead).
--   one_sheet_id/brief_id are nullable conveniences; nothing else references
--   these tables, so deletes cascade by application logic only.

-- pgcrypto provides gen_random_uuid() and gen_random_bytes() used below.
-- Required on fresh databases (e.g. staging) where the extension isn't enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sync_one_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  song_title TEXT NOT NULL,
  artist_name TEXT,
  song_library_id UUID,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  mood_tags TEXT[] NOT NULL DEFAULT '{}',
  bpm TEXT,
  musical_key TEXT,
  comparable_artists TEXT[] NOT NULL DEFAULT '{}',
  sounds_like TEXT,
  instrumental_available BOOLEAN NOT NULL DEFAULT false,
  stems_available BOOLEAN NOT NULL DEFAULT false,
  contact_name TEXT,
  contact_email TEXT,
  share_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_one_sheets_share_token_idx
  ON sync_one_sheets (share_token);
CREATE INDEX IF NOT EXISTS sync_one_sheets_user_id_idx
  ON sync_one_sheets (user_id);

CREATE TABLE IF NOT EXISTS sync_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'tv',
  mood TEXT NOT NULL DEFAULT '',
  budget_range TEXT NOT NULL DEFAULT '',
  deadline DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_briefs_user_id_idx
  ON sync_briefs (user_id);

CREATE TABLE IF NOT EXISTS sync_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  one_sheet_id UUID,
  brief_id UUID,
  song_title TEXT NOT NULL,
  target_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_pitches_user_id_idx
  ON sync_pitches (user_id);
CREATE INDEX IF NOT EXISTS sync_pitches_user_status_idx
  ON sync_pitches (user_id, status);

-- Backfill share_token for any rows created before the column default existed.
UPDATE sync_one_sheets
SET share_token = encode(gen_random_bytes(16), 'hex')
WHERE share_token IS NULL OR share_token = '';
