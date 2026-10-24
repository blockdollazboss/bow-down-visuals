-- 0225: Publishing (songwriter) splits registry (Stack-100 #3 Wave 3,
-- lane 9 — numbered at the join). Per-song writer splits — who wrote
-- what share of a song — with on-platform writers able to confirm or
-- dispute their own share. This is a RECORDS layer only: royalty
-- collection stays partner-gated (a publishing administrator must be
-- connected before anything is collected), and nothing in these
-- tables moves money.
--
-- song_id carries no FK on purpose: song_kind says which table it
-- points at ('release' -> distribution_releases, 'song' -> songs);
-- the route validates ownership against the correct table at
-- registration time, and song_title is snapshotted so the registry
-- survives the item being renamed or deleted.
-- Shares are creator-entered percentages; the per-row CHECK guards
-- range only — the sum-to-100 rule spans rows, so it is enforced in
-- the API machine, exactly like distribution_royalty_splits.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).

CREATE TABLE IF NOT EXISTS publishing_split_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'release',
  song_id uuid NOT NULL,
  song_title text NOT NULL DEFAULT '',
  has_dispute boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publishing_split_registrations_song_kind_check
    CHECK (song_kind IN ('release','song'))
);

CREATE TABLE IF NOT EXISTS publishing_split_writers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES publishing_split_registrations(id) ON DELETE CASCADE,
  writer_name text NOT NULL,
  writer_user_id uuid,
  writer_profile_id uuid,
  share_pct numeric(5,2) NOT NULL,
  confirmation_status text NOT NULL DEFAULT 'pending',
  dispute_note text,
  confirmed_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publishing_split_writers_status_check
    CHECK (confirmation_status IN ('pending','confirmed','disputed','unlinked')),
  CONSTRAINT publishing_split_writers_share_range_check
    CHECK (share_pct > 0 AND share_pct <= 100)
);

CREATE INDEX IF NOT EXISTS publishing_split_registrations_owner_idx
  ON publishing_split_registrations (owner_user_id);
CREATE INDEX IF NOT EXISTS publishing_split_registrations_song_idx
  ON publishing_split_registrations (song_kind, song_id);
CREATE INDEX IF NOT EXISTS publishing_split_writers_registration_idx
  ON publishing_split_writers (registration_id);
CREATE INDEX IF NOT EXISTS publishing_split_writers_user_idx
  ON publishing_split_writers (writer_user_id);
