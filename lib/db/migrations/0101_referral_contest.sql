-- Referral virality wave — monthly contest ledger (0101).
--
-- referral_contests: one row per contest month (period = YYYY-MM). Winners
--   are computed server-side from the referrals ledger when the month ends.
-- referral_contest_prizes: per-rank prize rows. UNIQUE(contest_id,
--   referrer_user_id) + "insert only if not already settled" keeps payouts
--   exactly-once: a retried settlement can never double-pay.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS referral_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  prizes JSONB NOT NULL DEFAULT '[]',
  min_signups_to_qualify INTEGER NOT NULL DEFAULT 5,
  /* open | settled | skipped (no qualifiers) */
  status TEXT NOT NULL DEFAULT 'open',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_contests_period_idx ON referral_contests (period);

CREATE TABLE IF NOT EXISTS referral_contest_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL REFERENCES referral_contests(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  referrer_user_id UUID NOT NULL,
  signups INTEGER NOT NULL DEFAULT 0,
  revenue_earned INTEGER NOT NULL DEFAULT 0,
  prize_credits INTEGER NOT NULL DEFAULT 0,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contest_id, referrer_user_id)
);

CREATE INDEX IF NOT EXISTS referral_contest_prizes_contest_idx
  ON referral_contest_prizes (contest_id);
CREATE INDEX IF NOT EXISTS referral_contest_prizes_referrer_idx
  ON referral_contest_prizes (referrer_user_id);
