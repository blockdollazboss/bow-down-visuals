-- 0159: Office Hours — a fifth palace-calendar kind (UPGRADE-PROGRAM
-- 3.7, stack-20 #17). A creator holds court in their OWN creator room
-- at a set hour: the booking rides the existing world_events backbone
-- (migration 0145) with kind 'office_hours', room_id = the host's
-- creator room id ('creator:<slug>'), and payload { note? } — an
-- optional agenda line. No new table, no new money: the only schema
-- change is widening the kind CHECK to admit the new kind. Booking
-- rules (own room only, public profile, member) are enforced at the
-- route, server-side, exactly like the other kinds' rules.
-- NOTE (stack-20 integration): this runs AFTER 0158, so the widened
-- CHECK keeps 'contest' (0158) alongside 'office_hours' — all five
-- kinds the backbone carries.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE world_events DROP CONSTRAINT IF EXISTS world_events_kind_check;
ALTER TABLE world_events ADD CONSTRAINT world_events_kind_check
  CHECK (kind IN ('stage_show', 'listening_party', 'drop', 'contest', 'office_hours'));
