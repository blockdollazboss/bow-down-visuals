-- 0330: post_assist_results — stored Post Assist results
-- (stack400 lane s400-post-assist, census C-03/C-36).
--
-- WHY THIS FILE EXISTS: Post Assist (POST /posts/assist) charged
-- exactly-once per intent — the credit ledger's idempotency key and
-- the AI-boost ledger both dedup on the (prompt, tone) hash — but it
-- kept NO record of what a paid intent produced. A duplicate that
-- arrived while the first request was still mid-provider-call was
-- told "replay" by both ledgers, yet the route treated that as
-- funded and ran the provider AGAIN: two generations for one boost
-- or one 100 VB charge, and the two drafts differed (C-03). And a
-- member who re-asked the same prompt+tone later got a fresh draft
-- or a suppressed charge with no word about why the words came back
-- the same (C-36).
--
-- This table is the stored result, in the exact shape of the
-- contract rail's 0329: ONE ROW PER PAID INTENT, keyed by the charge
-- idempotency key (UNIQUE — the same key both ledgers dedup on),
-- written by the assist rail the moment a generation succeeds,
-- holding the exact response body it served. A duplicate — mid-call
-- or long after — is answered from this row: same draft, no second
-- provider call, no second boost, no second charge. (0329's table
-- itself is contract-shaped and contract-owned, so the assist rail
-- gets its parallel table rather than riding it.)
--
-- The row is written ONLY after a success — a failed generation is
-- refunded (Bucs back + key voided, or the boost restored), so no
-- row ever exists for an unpaid intent, and the retry after a
-- failure still funds and generates fresh. The rail's reads/writes
-- are fail-open against a lagging database (missing table = generate
-- as before), so this migration is an upgrade, never a gate.
--
-- Fresh CREATE (no legacy table to reconcile): every statement is
-- IF NOT EXISTS, safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY.

CREATE TABLE IF NOT EXISTS post_assist_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS post_assist_results_idempotency_key_ux ON post_assist_results (idempotency_key);

CREATE INDEX IF NOT EXISTS post_assist_results_user_idx ON post_assist_results (user_id);
