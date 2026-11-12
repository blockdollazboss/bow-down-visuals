-- 0339: content_reports — creator stories join the report rail as
-- the 'story' target type (join22, landing the stories report
-- lane's named trailing step).
--
-- WHY THIS FILE EXISTS: migration 0174 created the target-type
-- check with the original vocabulary, and 0267 widened it for
-- 'fan_art'. Creator stories live in their own stories table and
-- no existing target type resolves them, so the stories report
-- lane (stack1600/stories-report-target) added a 'story' target
-- type: the report route resolves story targets against the
-- stories table (the story's profile_id -> creator_profiles
-- .user_id owns the story), and the drizzle schema already
-- carries the widened check (lib/db/src/schema/content-reports
-- .ts) — this migration makes existing databases agree. Until
-- it lands, filing a story report fails at this constraint and
-- the route answers an honest 500; every other target type is
-- unaffected.
--
-- Idempotent: the DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- pair (exactly the shape 0267 used for 'fan_art') re-runs as a
-- no-op once the widened check is in place. No BEGIN/COMMIT,
-- no CONCURRENTLY.

ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_target_type_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'profile', 'fan_art', 'story'));
