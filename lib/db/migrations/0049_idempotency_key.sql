-- 0049: Idempotency key for credit operations.
-- Prevents duplicate funding/charging on client retries.

ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS credit_usage_idempotency_key_uidx ON credit_usage (idempotency_key) WHERE idempotency_key IS NOT NULL;
