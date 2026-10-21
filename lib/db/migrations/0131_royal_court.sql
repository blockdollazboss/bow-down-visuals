-- 0131: The Royal Court — a creator crowns up to 8 other creators into
-- their Court, in rank order (positions 1–8). One row per crowned member.
--
-- owner_profile_id: the creator doing the crowning (their profile page
-- shows the Court). member_profile_id: the crowned creator's profile.
-- Both FK to creator_profiles with CASCADE: if either profile is deleted
-- the Court row goes with it, so a Court can never point at a profile
-- that no longer exists. (A member who merely goes PRIVATE is filtered
-- at read time instead — the row survives so the Court restores itself
-- if they come back.)
--
-- Uniqueness: one member per seat (owner, position) and one seat per
-- member (owner, member) — nobody holds two chairs at the same court.
--
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS royal_court (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  member_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS royal_court_owner_position_ux
  ON royal_court (owner_profile_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS royal_court_owner_member_ux
  ON royal_court (owner_profile_id, member_profile_id);
CREATE INDEX IF NOT EXISTS royal_court_owner_idx
  ON royal_court (owner_profile_id);
