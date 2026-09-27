-- Referral system (2026-09-27).
--
-- Each user gets one referral code. When a new user signs up with a code:
--   - referrer gets 5 credits
--   - new user (referee) gets 3 credits
-- One referral per referee (can't be referred twice). No self-referrals.

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_codes_user_id_idx ON referral_codes (user_id);
CREATE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  referee_user_id UUID NOT NULL UNIQUE,
  referrer_credits_awarded INTEGER NOT NULL DEFAULT 5,
  referee_credits_awarded INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS referrals_referee_idx ON referrals (referee_user_id);

COMMENT ON TABLE referral_codes IS
  'Referral system: one code per user. 5 credits to referrer, 3 to new user on signup via code.';
COMMENT ON TABLE referrals IS
  'Referral system: tracks who referred whom. One row per referee (no double-referrals).';
