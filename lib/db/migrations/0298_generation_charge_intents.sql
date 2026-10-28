-- 0298: Durable submit-time charge intents for poll-charged generations
-- (Stack400 Lane 4, charge integrity — payments gate Pass 3 failure).
--
-- The defect: the Runway-family rails (generate-runway-clip,
-- artist-image, intro-outro, logo) charge credits when the provider
-- task SUCCEEDS, and remembered the obligation ONLY in an in-memory
-- Map keyed by task id. Any server restart between submit and the
-- success poll (deploys restart this service routinely) lost the map
-- entry: the poll then delivered the finished generation with NO
-- charge and NO ledger row — and runway-clip/artist-image even logged
-- the false claim "after charge already processed". Pass 3 proved it
-- live: a Scene-2 clip promised "Cost 5 — After 87,470", delivered,
-- and the −5 never settled anywhere.
--
-- generation_charge_intents: one row per submitted task, written at
-- SUBMIT time — before the provider work finishes — carrying everything
-- the charge needs, so the obligation survives the process:
--   task_id    provider task id (Runway taskId or veo-<uuid>); UNIQUE.
--   rail       which poll handler owns the charge.
--   user_id    the member to charge (a poll by anyone else never charges).
--   credits    the amount quoted at submit — charges read it from the
--              row, never from a current-price constant.
--   action     the credit_usage action label for the charge.
--   extra      rail recovery data (Veo operation name + format delivery,
--              artist-image prompt/vault for the history save).
--   status     'awaiting' → 'charged' | 'failed' (provider task failed;
--              no charge is ever owed) | 'expired' (bookkeeping: never
--              delivered through a poll within the retention window —
--              a late poll may still settle it, exactly once).
--   delivered_at set when a poll hands the member the finished work;
--              the retry sweeper only re-charges intents that were
--              DELIVERED but never charged.
--
-- Exactly-once is anchored in credit_usage: every settle charges with
-- idempotency key 'gen-charge:<task_id>' under the existing UNIQUE
-- partial index (0049/0056), so the poll path and the sweeper can
-- race without ever double-charging.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS generation_charge_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  user_id UUID NOT NULL,
  credits INTEGER NOT NULL,
  project_id UUID,
  action TEXT NOT NULL,
  extra JSONB,
  status TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting', 'charged', 'failed', 'expired')),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS generation_charge_intents_task_idx
  ON generation_charge_intents (task_id);
-- The retry sweeper scans open intents oldest-first.
CREATE INDEX IF NOT EXISTS generation_charge_intents_status_idx
  ON generation_charge_intents (status, created_at);
