-- 9999 (PROVISIONAL — payfix gift-membership lane; renumber at join):
-- Membership gifts: one signed-in member gifts a Pro/Elite period to
-- another member. One row per PAID gift, born at webhook fulfillment
-- and claimed exactly once on UNIQUE(stripe_session_id) — the row is
-- the sender's receipt AND the recipient's entitlement record.
--
-- A gift is a one-time payment, never a Stripe subscription: nothing
-- auto-renews, no card is charged again. The recipient holds the tier
-- for [period_start, period_end); the tier resolver reads the window
-- directly, so at period end the tier glides back to the recipient's
-- own subscription state (Free if none) with no cron and no writes.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS membership_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  recipient_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier text NOT NULL,
  months integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text NOT NULL,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_gifts_tier_check CHECK (tier IN ('pro','elite')),
  CONSTRAINT membership_gifts_status_check CHECK (status IN ('active','refunded')),
  CONSTRAINT membership_gifts_months_check CHECK (months >= 1 AND months <= 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_gifts_stripe_session_uidx
  ON membership_gifts (stripe_session_id);
CREATE INDEX IF NOT EXISTS membership_gifts_recipient_profile_idx
  ON membership_gifts (recipient_profile_id);
CREATE INDEX IF NOT EXISTS membership_gifts_sender_idx
  ON membership_gifts (sender_user_id);
CREATE INDEX IF NOT EXISTS membership_gifts_recipient_idx
  ON membership_gifts (recipient_user_id);
