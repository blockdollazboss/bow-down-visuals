-- 9999 (PROVISIONAL — integrator renumbers at join): Song credits that
-- travel with the song (Stack-200 N1). The canonical credits layer's own
-- storage: ONLY the credits no other rail records (producers, featured
-- artists, declared samples, engineers, other named roles) plus an
-- append-only audit revision per owner save.
--
-- NOT a second splits machine: writer shares stay in
-- publishing_split_registrations/writers (0225, validated by
-- validateWriterSplits), master shares stay in
-- distribution_royalty_splits (versioned), co-release shares stay
-- frozen in co_release_sides. Entries here carry NO share column on
-- purpose. The canonical read layer (api-server lib/song-credits.ts)
-- merges all four sources by the publishing registry's anchor:
-- song_kind 'song' -> songs.id, 'release' -> distribution_releases.id
-- (no FK on song_id for the same reason as 0225 — it points at one of
-- two tables; the route validates ownership at write time).
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).

CREATE TABLE IF NOT EXISTS song_credit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL,
  role text NOT NULL,
  display_name text NOT NULL,
  credit_user_id uuid,
  credit_profile_id uuid,
  detail text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_credit_entries_song_kind_check
    CHECK (song_kind IN ('song','release')),
  CONSTRAINT song_credit_entries_role_check
    CHECK (role IN ('featured_artist','producer','sample','engineer','mixer','mastering','arranger','other'))
);

CREATE TABLE IF NOT EXISTS song_credit_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'song',
  song_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_credit_revisions_song_kind_check
    CHECK (song_kind IN ('song','release'))
);

CREATE INDEX IF NOT EXISTS song_credit_entries_song_idx
  ON song_credit_entries (song_kind, song_id);
CREATE INDEX IF NOT EXISTS song_credit_entries_profile_idx
  ON song_credit_entries (credit_profile_id);
CREATE INDEX IF NOT EXISTS song_credit_revisions_song_idx
  ON song_credit_revisions (song_kind, song_id, version);
