-- 0059: Referral system tables + creator_profiles + increment_referrer_earned RPC on Supabase.
--
-- WHY THIS EXISTS: these tables were defined in lib/db/migrations/
-- (0042_referrals.sql, 0045_referral_revenue_share.sql, 0101_referral_contest.sql,
-- 0085_creator_profiles.sql), which the boot-time runner applies against
-- DATABASE_URL (Render Postgres in production). That is a DIFFERENT
-- database from the Supabase project that the API actually queries via
-- getSupabaseAdmin() (SUPABASE_URL) — see artifacts/api-server/src/routes/referrals.ts.
-- The Render-side migrations can therefore never create these tables where
-- the routes look for them, and every referral endpoint 500s with
-- "relation does not exist".
-- Run this file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.
-- Run order: 0059 before 0060, 0061 (order between files does not matter,
-- there are no cross-file dependencies).
-- Mirrors the pattern documented in 0054_bonus_columns.sql.

-- referral_codes: one code per user (0042).
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_codes_user_id_idx ON referral_codes (user_id);
CREATE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code);

-- referrals: who referred whom (0042 + 0045 revenue-share columns).
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  referee_user_id UUID NOT NULL UNIQUE,
  referrer_credits_awarded INTEGER NOT NULL DEFAULT 0,
  referee_credits_awarded INTEGER NOT NULL DEFAULT 10,
  revenue_share_pct INTEGER NOT NULL DEFAULT 25,
  share_expires_at TIMESTAMPTZ,
  total_referrer_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- In case this table already exists in an older shape, add the 0045 columns.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS referrer_credits_awarded INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referee_credits_awarded INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS revenue_share_pct INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_referrer_earned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS referrals_referee_idx ON referrals (referee_user_id);

-- referral_payouts: idempotency ledger — one payout row per Stripe session,
-- so retried webhooks can never double-award the referrer (0045).
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  referee_credits_purchased INTEGER NOT NULL,
  referrer_credits_awarded INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_payouts_referral_idx ON referral_payouts (referral_id);

-- referral_milestones: star-tier bonuses per referrer (route bootstrap in
-- artifacts/api-server/src/routes/referrals.ts ensureReferralTables).
CREATE TABLE IF NOT EXISTS referral_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  stars INTEGER NOT NULL,
  bonus_credits INTEGER NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_user_id, stars)
);
CREATE INDEX IF NOT EXISTS referral_milestones_referrer_idx ON referral_milestones (referrer_user_id);

-- referral_contests: one row per contest month, period = YYYY-MM (0101).
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

-- referral_contest_prizes: per-rank prize rows. UNIQUE(contest_id,
-- referrer_user_id) keeps payouts exactly-once (0101).
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
CREATE INDEX IF NOT EXISTS referral_contest_prizes_contest_idx ON referral_contest_prizes (contest_id);
CREATE INDEX IF NOT EXISTS referral_contest_prizes_referrer_idx ON referral_contest_prizes (referrer_user_id);

-- creator_profiles: one public creator profile per user (0085).
CREATE TABLE IF NOT EXISTS creator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  banner_url TEXT,
  theme_id TEXT NOT NULL DEFAULT 'gold-lux',
  theme_config JSONB NOT NULL DEFAULT '{}',
  sections JSONB NOT NULL DEFAULT '[]',
  featured_media JSONB,
  social_links JSONB NOT NULL DEFAULT '{}',
  top_creators JSONB NOT NULL DEFAULT '[]',
  tip_jar_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_design JSONB,
  is_public BOOLEAN NOT NULL DEFAULT true,
  follower_count INTEGER NOT NULL DEFAULT 0,
  total_plays INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_profiles_slug_idx ON creator_profiles (slug);
CREATE INDEX IF NOT EXISTS creator_profiles_user_id_idx ON creator_profiles (user_id);

-- increment_referrer_earned: atomic bump of a referral's running total.
-- Called via supabase.rpc("increment_referrer_earned", { p_referral_id, p_amount })
-- in artifacts/api-server/src/routes/referrals.ts (revenue-share payout).
-- The route has a read-modify-write fallback if the RPC is missing, but the
-- atomic version is the correct one under concurrent webhooks.
CREATE OR REPLACE FUNCTION increment_referrer_earned(p_referral_id UUID, p_amount INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE referrals
     SET total_referrer_earned = total_referrer_earned + p_amount
   WHERE id = p_referral_id;
END;
$$;
