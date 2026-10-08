-- Creator Streaming Platform — tier subscriptions (0092).
--
-- One row per creator profile: the creator's paid tier, synced from Stripe
-- subscription webhooks. profile_id UNIQUE (one tier row per profile),
-- FK CASCADE to creator_profiles(id).
--
-- Idempotent: every statement is safe to re-run (boot migrations apply it).

CREATE TABLE IF NOT EXISTS creator_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id              UUID NOT NULL UNIQUE REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier                    TEXT NOT NULL DEFAULT 'free',
  status                  TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id  TEXT,
  stripe_customer_id      TEXT,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'creator_subscriptions_tier_check'
  ) THEN
    ALTER TABLE creator_subscriptions
      ADD CONSTRAINT creator_subscriptions_tier_check
      CHECK (tier IN ('free','pro','elite'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creator_subscriptions_stripe_sub_idx
  ON creator_subscriptions (stripe_subscription_id);
