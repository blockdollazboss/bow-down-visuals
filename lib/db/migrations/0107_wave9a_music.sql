-- 0107 — Wave 9A tables (Song Structure Builder + Remix Chain).
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).

-- Saved song structures (Wave 9A, feature 1). `sections` is a JSON array of
-- { type, bars, label } objects in playback order. song_id is nullable: a
-- structure can live on its own and later be attached to a song.
CREATE TABLE IF NOT EXISTS wave9a_song_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  song_id uuid,
  name text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave9a_song_structures_user_idx
  ON wave9a_song_structures (user_id);

-- Song version bookkeeping (Wave 9A, feature 2 — Remix Chain). Versions are
-- metadata rows, not generations: a version points at an existing audio_url
-- (from any remix/rework/generation flow) and is linked into a tree via
-- parent_version_id. `promoted` marks the current master of a song.
-- This does NOT duplicate SongReworkPanel (paid regeneration) — it is the
-- free organizational layer on top of the outputs those flows produce.
CREATE TABLE IF NOT EXISTS wave9a_song_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  song_id uuid,
  parent_version_id uuid REFERENCES wave9a_song_versions (id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  audio_url text NOT NULL DEFAULT '',
  promoted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave9a_song_versions_user_song_idx
  ON wave9a_song_versions (user_id, song_id);
CREATE INDEX IF NOT EXISTS wave9a_song_versions_parent_idx
  ON wave9a_song_versions (parent_version_id);
