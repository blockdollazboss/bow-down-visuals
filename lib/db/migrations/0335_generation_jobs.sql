-- 0335: generation_jobs — generalized durable job storage for the
-- long-running generation rails (lane stack1600/durable-jobs),
-- generalizing the avatar-presenter layer (0334) to every
-- remaining job-Map rail that charges credits.
--
-- WHY THIS FILE EXISTS: the avatar-presenter rail got durable job
-- storage in 0334 (avatar_presenter_jobs) after its in-process Map
-- proved the failure mode — a server restart between submit and
-- completion lost the job record entirely, orphaning the
-- reserve-at-submit charge: no job left to complete the
-- generation, none to refund from, and a poll answered 404 for a
-- job the member had paid for. The same shape repeated across the
-- generation routes (~20 rails keeping charged job records only
-- in module-level Maps with a 2h TTL). This table is the shared
-- durable half for all of them, in the shape of the stored-result
-- tables before it (0329 / 0330 / 0333) and 0334 itself.
--
-- ONE ROW PER JOB, keyed by (rail, id) — the rail's own job id,
-- namespaced by the rail name. The extracted columns carry the
-- queries (the member, the status lifecycle, the reserved amount
-- and its charge key, the exactly-once refund claim, timestamps);
-- the rail's full in-memory job record rides in `payload` (jsonb),
-- including the worker inputs a resumed worker needs to finish
-- the job after a restart (uploaded file path / media URL /
-- provider params, per rail).
--
-- Each converted rail's in-memory Map stays as its working cache;
-- every job is inserted at creation, mirrored on mutation, and a
-- lookup that misses the Map rehydrates from this table — a
-- non-terminal job found this way has its worker resumed (when
-- its inputs survived) or is settled failed with its refund
-- claimed in this row BEFORE the refund moves, exactly once.
-- TTL eviction is a query on created_at on the SAME 2h clock the
-- in-memory sweeper uses. ALL reads and writes are FAIL-OPEN
-- against a lagging database (missing table = the old in-process
-- behavior): a storage failure can never error a rail or
-- double-charge; the worst case is the pre-0335 behavior.
--
-- Fresh CREATE (no legacy table to reconcile): every statement
-- is IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT,
-- no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS generation_jobs (
  rail text NOT NULL,
  id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL,
  credits_charged integer NOT NULL,
  charge_key text,
  credits_refunded boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rail, id)
);

CREATE INDEX IF NOT EXISTS generation_jobs_user_idx ON generation_jobs (user_id);

CREATE INDEX IF NOT EXISTS generation_jobs_created_idx ON generation_jobs (created_at);
