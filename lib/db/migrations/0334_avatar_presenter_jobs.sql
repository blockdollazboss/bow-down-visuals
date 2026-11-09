-- 0334: avatar_presenter_jobs — durable job storage for the
-- avatar-presenter rail (follow-on lane f-avatar-durable; the
-- CA-KEY lane's named follow-on).
--
-- WHY THIS FILE EXISTS: the avatar-presenter rail (Hedra
-- Character-3, owner-ruled 1,200 VB, RESERVE-AT-SUBMIT) derives
-- each job id from the request's INTENT (lane s400-ca-weak-keys),
-- so twin POSTs collapse to one job, one reserve, one provider
-- submit. But the job records themselves lived only in an
-- IN-PROCESS Map with a 2h TTL: a server restart between submit
-- and completion lost the job entirely — the ledger charge stood
-- (protected by its idempotency key) with no job record left to
-- complete the generation or to refund from, and the member was
-- left with a paid ask and nothing running. This table is the
-- durable half of that pair, in the shape of the stored-result
-- tables before it (0329 / 0330 / 0333).
--
-- ONE ROW PER JOB, keyed by the job id itself (PRIMARY KEY — the
-- intent-derived id the rail already computes, UNIQUE by
-- construction). The row carries everything the in-memory job
-- record carries: the member, the status lifecycle
-- (queued / processing / done / failed), the provider job id,
-- the request payload (avatar, script, and the submit inputs the
-- worker needs to finish the job after a restart), the result
-- refs (output URL / error), the reserved amount and its charge
-- key, the exactly-once refund claim, and timestamps.
--
-- The rail's in-memory Map stays as its working cache; every job
-- mutation is mirrored here, and a lookup that misses the Map
-- rehydrates from this table — a non-terminal job found this way
-- has its worker resumed, so an in-flight job survives a restart
-- and completes. TTL eviction is a query on created_at on the
-- SAME 2h clock the in-memory sweeper uses — rows expire by the
-- query, not by a process dying. ALL reads and writes are
-- FAIL-OPEN against a lagging database (missing table = the old
-- in-process behavior): a storage failure can never error the
-- rail or double-charge; the worst case is the pre-0334 behavior.
--
-- Fresh CREATE (no legacy table to reconcile): every statement
-- is IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT,
-- no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS avatar_presenter_jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL,
  avatar_id text NOT NULL,
  script text NOT NULL,
  provider_job_id text,
  output_url text,
  error text,
  credits_charged integer NOT NULL,
  charge_key text,
  credits_refunded boolean NOT NULL DEFAULT false,
  submit_input jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_presenter_jobs_user_idx ON avatar_presenter_jobs (user_id);

CREATE INDEX IF NOT EXISTS avatar_presenter_jobs_created_idx ON avatar_presenter_jobs (created_at);
