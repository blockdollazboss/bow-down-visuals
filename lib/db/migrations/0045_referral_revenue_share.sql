-- Referral revenue share (2026-09-27).
--
-- New model: the invitee gets 10 welcome credits on signup via a referral link.
-- The referrer earns 25% of everything the invitee spends (in credits) for
-- 90 days after the referral — paid out automatically on each credit purchase.
-- No upfront referrer payout, so fake signups earn nothing.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS revenue_share_pct INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_referrer_earned INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing referrals get a 90-day window from their creation date.
UPDATE referrals
SET share_expires_at = created_at + INTERVAL '90 days'
WHERE share_expires_at IS NULL;

-- Idempotency ledger: one payout row per Stripe session, so retried webhooks
-- can never double-award the referrer.
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  referee_credits_purchased INTEGER NOT NULL,
  referrer_credits_awarded INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_payouts_referral_idx ON referral_payouts (referral_id);

COMMENT ON TABLE referral_payouts IS
  'Referral revenue share: idempotent record of each referrer payout per Stripe purchase.';
