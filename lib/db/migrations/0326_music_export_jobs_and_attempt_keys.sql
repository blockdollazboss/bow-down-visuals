-- 0326: durable music (mix) export jobs + export attempt keys
-- (stack300 lane export-reliability, items 62 + 64).
--
-- Item 62: mix-export jobs lived in a process Map
-- (routes/music-export.ts) — a restart killed every in-flight render,
-- the poll endpoint 404'd, and there was no boot recovery. The new
-- music_export_jobs table mirrors export_jobs (0218-era multi-ratio
-- table is the other sibling): the row is the source of truth, the
-- full render params are persisted so boot recovery can re-run a
-- queued/processing job from scratch, and attempts caps poison jobs
-- at 3 (the export_jobs standard).
--
-- Item 64: no export start rail had duplicate-submit protection — a
-- double POST (network retry, double-tab, re-tap after a lost 202)
-- created a second job and, on the charging rails, a second charge.
-- multi_ratio_jobs gains the attempt_key column the route derives
-- from (user + params hash) at creation; a duplicate POST inside the
-- dedup window returns the existing queued/active job instead. (The
-- video-export rail stores its key inside the params jsonb it already
-- persists, and the music table carries its own attempt_key column —
-- no export_jobs schema change needed.)
--
-- NOTE (wave rule): migration numbers are assigned at join; this
-- lane takes the next number after 0325 provisionally — if the
-- plans-boosts lane's migration lands first at join, renumber this
-- file there. The two lanes are the wave's only migration candidates.
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS music_export_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  params jsonb NOT NULL,
  result jsonb,
  error text,
  code text,
  attempt_key text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_export_jobs_user_idx
  ON music_export_jobs (user_id, created_at);

CREATE INDEX IF NOT EXISTS music_export_jobs_attempt_idx
  ON music_export_jobs (user_id, attempt_key);

ALTER TABLE multi_ratio_jobs
  ADD COLUMN IF NOT EXISTS attempt_key text;

CREATE INDEX IF NOT EXISTS multi_ratio_jobs_attempt_idx
  ON multi_ratio_jobs (user_id, attempt_key);
