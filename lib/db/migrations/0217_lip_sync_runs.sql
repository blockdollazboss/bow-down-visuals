-- 0217: Lip-sync run-all orchestration records (Stack-100 #3, editor A-08).
-- The per-scene sub-jobs were already durable (lip_sync_jobs) and the final
-- export durable (export_jobs), but the RUN record lived in a process Map:
-- a restart mid-run stranded finished scenes with no run to poll. This
-- table is the run record; boot recovery re-drives rows left 'running'
-- from params (scene ids, clip URLs, timings, resolved audio ref, settings
-- snapshot — never the request JWT; resume re-verifies ownership from
-- user_id/project_id under the service-role client).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS lip_sync_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'running',
  scenes jsonb NOT NULL DEFAULT '[]'::jsonb,
  export_state text NOT NULL DEFAULT 'pending',
  export_job_id uuid,
  video_url text,
  error text,
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lip_sync_runs_user_idx
  ON lip_sync_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lip_sync_runs_state_idx
  ON lip_sync_runs (state) WHERE state = 'running';
