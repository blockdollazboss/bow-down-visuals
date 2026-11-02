-- 0313: World show invites (stack1300 Ring 3.8 — invite-to-a-show,
-- the remainder of "Invites + announcements").
--
-- The room invites (0300) proved the shape for Creator Rooms: a
-- named host invites a named member, the member answers. A SHOW
-- had no such thing: a booked happening (world_events) spread only
-- by the palace-wide announcement and the calendar walk — nobody
-- could invite a specific friend to a specific event.
--
-- This table is the invite itself: the show's host
-- (inviter_user_id — the event's host_user_id) invites a named
-- member (invitee_user_id — a user id picked from the member
-- directory, never an email string) to one event (event_id). The
-- show's identity is denormalized alongside (event_title,
-- event_kind, room_id, starts_at, ends_at) so invite reads and
-- bell copy name the show without re-deriving it, and the invite
-- still reads honestly if the event is later cancelled.
--
--   status: pending → accepted | declined. The invitee's answer
--   stamps responded_at. A declined row stays as history; inviting
--   again writes a fresh row.
--
-- Exactly-once is structural: the partial unique index allows ONE
-- pending row per (event, invitee), so a replayed or raced create
-- can never double the invite — and the create route fires the
-- invitee's bell only behind a landed insert.
CREATE TABLE IF NOT EXISTS world_show_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  event_title text NOT NULL,
  event_kind text NOT NULL,
  room_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  inviter_user_id uuid NOT NULL,
  invitee_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX IF NOT EXISTS world_show_invites_invitee_idx
  ON world_show_invites (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS world_show_invites_event_idx
  ON world_show_invites (event_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS world_show_invites_one_pending_ux
  ON world_show_invites (event_id, invitee_user_id)
  WHERE status = 'pending';
