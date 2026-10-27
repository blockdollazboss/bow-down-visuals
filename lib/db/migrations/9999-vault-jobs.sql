-- 9999 (PROVISIONAL — renumbered at join): The Vault jobs (Stack-200
-- UPGRADE #162).
--
-- Durable background-job records for the full-ownership archive export:
-- one downloadable ZIP of a creator's original media at full quality
-- plus their data. Mirrors export_jobs (0244-era house pattern): the
-- route returns 202 + jobId, the client polls, stage/progress persist,
-- and jobs orphaned by a dead process are re-queued on boot.
CREATE TABLE IF NOT EXISTS vault_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  result jsonb,
  error jsonb,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_jobs_user_created_idx
  ON vault_jobs (user_id, created_at DESC);
