-- 0056: Remainder of 0049 (credit_usage idempotency key).
--
-- 0049 added the idempotency_key column, but it was never applied to
-- production (no automatic migration runner existed; drizzle-kit push died
-- on its TTY prompt every deploy). The column itself was backfilled on
-- production via the admin schema-repair endpoint during the 2026-10-06
-- credit-ledger incident (commit f3fa332e). This migration completes 0049 by
-- adding its partial unique index, and self-heals the column on any database
-- that still lacks it (e.g. staging).
--
-- Safe to run anywhere: both statements are IF NOT EXISTS, and the partial
-- index ignores the NULL idempotency_key values on all pre-existing rows.

ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS credit_usage_idempotency_key_uidx
  ON credit_usage (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
