-- 0120: billing tables — credit_usage + stripe_payments.
-- These existed only via the retired drizzle-kit push, so any fresh DB
-- (including the launch DB) 500s on every paid generation and every
-- Stripe webhook. Definitions mirror lib/db/src/schema/credit-usage.ts
-- and lib/db/src/schema/stripe-payments.ts exactly.
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  credits_used INTEGER NOT NULL,
  project_id UUID,
  team_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_usage_user_id_idx ON credit_usage (user_id);
CREATE INDEX IF NOT EXISTS credit_usage_created_at_idx ON credit_usage (created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id TEXT,
  user_id UUID NOT NULL,
  credit_pack TEXT,
  credits_amount INTEGER NOT NULL,
  amount_total INTEGER,
  currency TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_payments_user_id_idx ON stripe_payments (user_id);
CREATE INDEX IF NOT EXISTS stripe_payments_created_at_idx ON stripe_payments (created_at DESC);
