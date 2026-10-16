-- Referral tables consolidation (Stack 8 #6).
--
-- routes/referrals.ts used to self-create its tables at request time
-- with inline CREATE TABLE IF NOT EXISTS statements. The single
-- definition now lives in lib/db/src/schema/referrals.ts (+
-- referral-contest.ts for the contest pair). Coverage before this
-- migration: referral_codes/referrals in 0042, referral_payouts and
-- the referrals revenue-share columns in 0045, referral_contests /
-- referral_contest_prizes in 0101. The ONLY table with no migration
-- was referral_milestones — created here, idempotently, in the exact
-- shape the inline DDL used (including the exactly-once UNIQUE).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS referral_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  stars INTEGER NOT NULL,
  bonus_credits INTEGER NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(referrer_user_id, stars)
);

CREATE INDEX IF NOT EXISTS referral_milestones_referrer_idx ON referral_milestones (referrer_user_id);

COMMENT ON TABLE referral_milestones IS
  'Referral promoter milestones: one bonus row per (referrer, star tier), exactly-once via UNIQUE(referrer_user_id, stars). Schema: lib/db/src/schema/referrals.ts.';
