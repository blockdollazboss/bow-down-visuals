-- 0218: Multi-ratio export jobs (Stack-100 #3, editor A-08). The job store
-- was a process Map while the full cost is charged UP FRONT: a hard kill
-- skipped the worker's refund finally, leaving the charge standing with
-- no job to poll and finished ratios' durable URLs unreachable. This
-- table is the job record; boot recovery settles any queued/active row —
-- refunding every ratio that never completed — and marks it failed
-- 'interrupted_by_restart', keeping completed ratios' URLs on the row.
-- Per-ratio charging does not fit export_jobs' single credits_charged
-- flag, hence the dedicated table (spec: .lane a08-migration-spec).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS multi_ratio_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  video_url text NOT NULL,
  cost_total integer NOT NULL,
  cost_per_ratio integer NOT NULL,
  ratios jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'queued',
  error text,
  refunded integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS multi_ratio_jobs_user_idx
  ON multi_ratio_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS multi_ratio_jobs_state_idx
  ON multi_ratio_jobs (state) WHERE state IN ('queued', 'active');
