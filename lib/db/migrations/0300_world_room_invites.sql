-- 0300: Creator Room invites (stack900 Lane B4 — owner ruling
-- Oct 29, 2026: "Build real room invites — pick a person, they
-- accept or decline").
--
-- Until now a Creator Room spread only by an anonymous copied
-- link/code: no invitee was ever recorded, so an invitation could
-- not exist, let alone be announced. This table is the invite
-- itself: the room's host (inviter_user_id — the creator profile's
-- user id) invites a named member (invitee_user_id — a user id
-- picked from the member directory, never an email string) to one
-- room (room_id `creator:<slug>`, room_slug carried alongside for
-- reads and bell copy).
--
--   status: pending → accepted | declined. The invitee's answer
--   stamps responded_at. A declined row stays as history; inviting
--   again writes a fresh row.
--
-- Exactly-once is structural: the partial unique index allows ONE
-- pending row per (room, invitee), so a replayed or raced create
-- can never double the invite — and the create route fires the
-- invitee's bell only behind a landed insert.
CREATE TABLE IF NOT EXISTS world_room_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  room_slug text NOT NULL,
  inviter_user_id uuid NOT NULL,
  invitee_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS world_room_invites_invitee_idx
  ON world_room_invites (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS world_room_invites_room_idx
  ON world_room_invites (room_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS world_room_invites_one_pending_ux
  ON world_room_invites (room_id, invitee_user_id)
  WHERE status = 'pending';
