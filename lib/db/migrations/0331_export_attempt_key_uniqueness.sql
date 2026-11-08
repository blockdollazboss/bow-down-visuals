-- 0331: export-rail attempt-key uniqueness (stack400 lane
-- s400-exports-idempotency, items C-04 + C-05).
--
-- The item-64 duplicate-submit guards were reads, not constraints:
-- each rail looked up the in-flight job for (user, attempt_key) and
-- only then inserted, so two simultaneous start POSTs both passed
-- the lookup and both created jobs — multi-ratio charged twice
-- (C-04), video reserved the clean-export price twice and music
-- rendered twice (C-05). These partial UNIQUE indexes make the
-- database itself the guard: while a job for (user, attempt_key) is
-- in flight, a second insert conflicts, and the stores return the
-- existing job instead of creating a second one.
--
-- export_jobs also gains the real attempt_key column its key has
-- been hiding in (params jsonb since item 64): a jsonb expression
-- cannot back the unique index the guard needs. New rows write the
-- column (the key still rides inside params too, where the render
-- pipeline already reads it); the backfill below lifts the key out
-- of params for rows already in flight so the index covers them.
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.
-- (A plain CREATE UNIQUE INDEX takes a brief write lock on three
-- small job tables — the same trade every migration here makes.)

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS attempt_key text;

UPDATE export_jobs
SET attempt_key = params->>'attemptKey'
WHERE attempt_key IS NULL AND params->>'attemptKey' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_active_attempt_uniq
  ON export_jobs (user_id, attempt_key)
  WHERE state IN ('queued', 'active') AND attempt_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS music_export_jobs_active_attempt_uniq
  ON music_export_jobs (user_id, attempt_key)
  WHERE state IN ('queued', 'processing') AND attempt_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS multi_ratio_jobs_active_attempt_uniq
  ON multi_ratio_jobs (user_id, attempt_key)
  WHERE state IN ('queued', 'active') AND attempt_key IS NOT NULL;
