-- 0313: Court gatherings — a sixth palace-calendar kind
-- (UPGRADE-PROGRAM 3.6, stack1300). A court gathering is a scheduled
-- occasion in the Royal Court Chamber: at the hour the court is
-- called, the Front Row honors are presented, and the moment is
-- heralded palace-wide. The booking rides the existing world_events
-- backbone (migration 0145) with kind 'royal_court',
-- room_id = 'world:royal-court', and payload { note? } — an
-- optional occasion line. No new table, no new money (court honors
-- are honor only, like the season marks): the only schema change is
-- widening the kind CHECK to admit the new kind. Booking rules
-- (the Royal Court Chamber only, house/admin — the drop precedent)
-- are enforced at the route, server-side, exactly like the other
-- kinds' rules.
-- NOTE: this runs AFTER 0159, so the widened CHECK keeps all five
-- existing kinds alongside 'royal_court'.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE world_events DROP CONSTRAINT IF EXISTS world_events_kind_check;
ALTER TABLE world_events ADD CONSTRAINT world_events_kind_check
  CHECK (kind IN ('stage_show', 'listening_party', 'drop', 'contest', 'office_hours', 'royal_court'));
