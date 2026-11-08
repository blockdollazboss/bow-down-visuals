-- 0329: contract_generations — stored contract-generation results
-- (stack400 lane s400-contracts-replay, census C-02/C-33).
--
-- WHY THIS FILE EXISTS: the contract generator charged exactly-once
-- per intent (the credit ledger's idempotency key), but it kept NO
-- record of what a paid intent produced. A replayed submit — a
-- double-tap, or a client retry after a lost response — was charged
-- once yet ran the provider again and returned a BRAND-NEW draft:
-- the draft the member reviewed first was unrecoverable, and every
-- retry burned a full 8,000-token generation (C-33). For a legal
-- document that nondeterminism is the worst kind: the artifact they
-- negotiated from may not be the one they saved.
--
-- This table is the stored result: ONE ROW PER PAID INTENT, keyed by
-- the charge idempotency key (UNIQUE — the same key the credit
-- ledger dedups on), written by the generator rail the moment a
-- generation succeeds, holding the exact response body it served.
-- A replay under a landed key is answered from this row: same draft,
-- no second provider call, no second charge.
--
-- The row is written ONLY after a success — a failed generation is
-- refunded and its ledger key voided, so no row ever exists for an
-- unpaid intent, and the retry after a failure still charges and
-- generates fresh. The rail's reads/writes are fail-open against a
-- lagging database (missing table = generate as before), so this
-- migration is an upgrade, never a gate.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS contract_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  contract_type text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_generations_idempotency_key_ux ON contract_generations (idempotency_key);

CREATE INDEX IF NOT EXISTS contract_generations_user_idx ON contract_generations (user_id);
