-- 0055: Trial-credit claim flag on the Supabase `profiles` table.
--
-- WHY THIS EXISTS: the API's runtime `ensureTrialColumn()` (in
-- artifacts/api-server/src/routes/credits.ts) runs its ALTER against
-- DATABASE_URL (Render Postgres in production), which is a DIFFERENT
-- database from the Supabase project that serves `profiles`. The runtime
-- ALTER can therefore never create this column in production, and the
-- trial claim then fails with:
--   column profiles.trial_credits_claimed does not exist
-- Run this file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: the statement uses IF NOT EXISTS.
-- Mirrors the pattern documented in 0054_bonus_columns.sql.

alter table profiles
  add column if not exists trial_credits_claimed boolean not null default false;

-- Referral revenue-share columns: the referrals tables are read/written
-- through the Supabase service-role client (see referrals.ts), but
-- ensureReferralTables() runs its DDL against DATABASE_URL (Render
-- Postgres), so it can never heal the Supabase copy. These are the same
-- three columns it would add on the Render side.
alter table referrals
  add column if not exists revenue_share_pct integer not null default 25,
  add column if not exists share_expires_at timestamptz,
  add column if not exists total_referrer_earned integer not null default 0;
