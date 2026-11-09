-- 0333: generation_stored_results — durable stored results for the
-- generation rails (stack400 lane s400-stored-results, the CA-KEY
-- lane's named follow-on).
--
-- WHY THIS FILE EXISTS: bg-generate, thumbnail-generator and
-- bio-generator carry real server-derived charge idempotency keys
-- (lane s400-ca-weak-keys), so an identical re-ask can never
-- double-charge — the credit ledger dedups on the key (migration
-- 0049). But their stored results lived only IN-PROCESS: after a
-- server restart (or the in-process store's cap/TTL eviction) an
-- identical re-ask found no stored result, the ledger suppressed
-- the second charge, and the rail regenerated ONCE FOR FREE. This
-- table is the durable half of that pair — the same shape as the
-- contract rail's contract_generations (0329) and post-assist's
-- post_assist_results (0330), generalized for any rail.
--
-- ONE ROW PER PAID INTENT, keyed by the charge idempotency key
-- (UNIQUE — the same key the credit ledger dedups on, and the key
-- itself is rail-scoped by construction, so one unique key column
-- serves every rail). The `rail` column records which rail wrote
-- the row and is checked on read. The row holds the exact response
-- payload the rail served; a replay under a landed key is answered
-- from this row verbatim (plus the rail's replay marker) — no
-- second charge, no second provider call, after any restart.
--
-- The row is written ONLY after a success — a failed generation is
-- refunded and its ledger key voided, so no row ever exists for an
-- unpaid intent, and the retry after a failure still charges and
-- generates fresh. The rails' reads/writes are fail-open against a
-- lagging database (missing table = the old in-process behavior),
-- so this migration is an upgrade, never a gate.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS generation_stored_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rail text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS generation_stored_results_idempotency_key_ux ON generation_stored_results (idempotency_key);

CREATE INDEX IF NOT EXISTS generation_stored_results_user_idx ON generation_stored_results (user_id);
