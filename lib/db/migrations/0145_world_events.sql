-- 0145: World Events — the palace calendar (World Ring 2, items
-- 3.1 / 3.2 / 3.4 + THE-GAME §5). Until now nothing ever HAPPENED in
-- the palace that a visitor didn't start themselves: no schedule of
-- shows, no listening parties, no drops landing in a room. This table
-- is the events backbone all three ride:
--   world_events — one booked slot: kind ('stage_show' |
--     'listening_party' | 'drop'), the palace room it happens in
--     (room_id is a palace room id — rooms are socket state, not
--     rows, so this is plain text, validated against the palace
--     registry at the route), the booking member, the title, the
--     [starts_at, ends_at) window, a per-kind jsonb payload
--     (stage_show: { contentRef } — a screen-catalog video id or
--     'live'; listening_party: { trackIds[], playlistId? }; drop:
--     { amountVb, claimCap }), and the scheduler's status
--     (scheduled → live → done, or cancelled).
-- Booking rules are enforced at the route, server-side: Throne Hall
-- stage slots are Front Row (the King's royal_court) + admin only;
-- any member may book the Music Hall; drop spectacles are admin
-- bookings, paid from the existing weekly drop budget at claim time.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS world_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  room_id TEXT NOT NULL,
  host_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT world_events_kind_check CHECK (kind IN ('stage_show', 'listening_party', 'drop')),
  CONSTRAINT world_events_status_check CHECK (status IN ('scheduled', 'live', 'done', 'cancelled')),
  CONSTRAINT world_events_window_check CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS world_events_room_starts_idx ON world_events (room_id, starts_at);
CREATE INDEX IF NOT EXISTS world_events_status_starts_idx ON world_events (status, starts_at);
CREATE INDEX IF NOT EXISTS world_events_host_idx ON world_events (host_user_id);
