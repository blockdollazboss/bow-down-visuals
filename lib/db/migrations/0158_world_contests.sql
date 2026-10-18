-- 0158: World Contests + the Winners' Circle (UPGRADE-PROGRAM
-- 2.24) — the palace gets things to WIN.
--
-- A contest rides the events backbone (0145): it is a world_events
-- row of kind 'contest' whose [starts_at, ends_at) window is the
-- entry window and whose payload carries { theme }. Two changes:
--
--   1. world_events_kind_check widens to admit 'contest'. (The
--      drizzle schema's mirror check widens in the same commit.)
--
--   2. Two contest tables:
--      world_contest_entries — one member's one entered work
--        (UNIQUE(event_id, user_id) is the one-entry rule). The
--        work stays in profile_tracks / profile_videos; work_kind
--        + work_id point at it and ownership/publication are
--        re-verified at entry time.
--      world_contest_winners — the honor, frozen at decision time:
--        winner name + work title are snapshot onto the row so a
--        later rename never rewrites the court record. This is
--        the Winners' Circle board's read and the record contest
--        honors stand on. No VB moves for a win in v1.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

ALTER TABLE world_events DROP CONSTRAINT IF EXISTS world_events_kind_check;
ALTER TABLE world_events ADD CONSTRAINT world_events_kind_check
  CHECK (kind IN ('stage_show', 'listening_party', 'drop', 'contest'));

CREATE TABLE IF NOT EXISTS world_contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  user_id UUID NOT NULL,
  work_kind TEXT NOT NULL,
  work_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT world_contest_entries_kind_check CHECK (work_kind IN ('track', 'video'))
);

CREATE UNIQUE INDEX IF NOT EXISTS world_contest_entries_one_per_member_uq
  ON world_contest_entries (event_id, user_id);
CREATE INDEX IF NOT EXISTS world_contest_entries_event_idx
  ON world_contest_entries (event_id);

CREATE TABLE IF NOT EXISTS world_contest_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  user_id UUID NOT NULL,
  place INTEGER NOT NULL,
  winner_name TEXT NOT NULL,
  work_kind TEXT NOT NULL,
  work_id UUID NOT NULL,
  work_title TEXT NOT NULL,
  decided_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT world_contest_winners_place_check CHECK (place >= 1 AND place <= 3),
  CONSTRAINT world_contest_winners_kind_check CHECK (work_kind IN ('track', 'video'))
);

CREATE UNIQUE INDEX IF NOT EXISTS world_contest_winners_entry_uq
  ON world_contest_winners (entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS world_contest_winners_place_uq
  ON world_contest_winners (event_id, place);
CREATE INDEX IF NOT EXISTS world_contest_winners_event_idx
  ON world_contest_winners (event_id);
CREATE INDEX IF NOT EXISTS world_contest_winners_created_idx
  ON world_contest_winners (created_at);
