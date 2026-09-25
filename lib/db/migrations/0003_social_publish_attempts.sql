-- Instagram auto-post — publish idempotency ledger.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- The client sends one idempotency key per publish intent; the server claims
-- a row for (user_id, idempotency_key) BEFORE charging credits or calling
-- Meta. Replays return the stored result instead of posting/charging again,
-- which closes the double-post / double-charge hole on double-clicks,
-- two tabs, and retries after a timeout.
-- Must stay in sync with lib/db/src/schema/social-publish-attempts.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

CREATE TABLE IF NOT EXISTS social_publish_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram',
  idempotency_key TEXT NOT NULL,
  account_id UUID,
  status TEXT NOT NULL DEFAULT 'processing',
  credits_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_publish_attempts_user_key_ux
  ON social_publish_attempts (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS social_publish_attempts_user_id_idx
  ON social_publish_attempts (user_id);
