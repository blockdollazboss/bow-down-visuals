-- 9999-payfix-upgrade-path.sql (PROVISIONAL — renumber at join)
-- Payfix upgrade-path lane: one Stripe customer per user + visible
-- subscription receipt/history rows. Idempotent; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS user_stripe_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_stripe_customers_customer_uidx
  ON user_stripe_customers (stripe_customer_id);

CREATE TABLE IF NOT EXISTS creator_subscription_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  tier text,
  status text,
  amount_cents integer,
  currency text,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_object_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_subscription_receipts_profile_idx
  ON creator_subscription_receipts (profile_id, created_at);
