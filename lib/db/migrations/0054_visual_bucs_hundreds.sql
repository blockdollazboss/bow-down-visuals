-- 0054: Visual Bucs ×100 "hundreds" redenomination — RENDER POSTGRES side.
--
-- RUN ONCE against the Render Postgres database (DATABASE_URL).
-- Run it from the web service's Shell tab:
--   psql "$DATABASE_URL" -f lib/db/migrations/0054_visual_bucs_hundreds.sql
-- (The repo is present in the container, so the file path works as-is.)
--
-- What this covers (Render Postgres / Drizzle tables only):
--   credit_usage.credits_used, stripe_payments.credits_amount,
--   distribution_releases.credits_charged, generation_history.credits_used,
--   generations.credits_spent, scheduled_posts.credits_charged,
--   wheel_spins.prize_credits, teams.credits,
--   cheat_code_events.prize_credits, bow_challenge_config.reward_credits
--
-- The Supabase tables (profiles, referrals, referral_payouts) are migrated
-- separately by supabase/migrations/0054_visual_bucs_hundreds.sql — run BOTH.
--
-- IDEMPOTENT / EXACTLY-ONCE: a data_migrations marker row is written in the
-- same transaction as the updates. Re-running this script after a successful
-- run prints a NOTICE and changes nothing. A failed run rolls back fully, so
-- it is safe to retry. Every table update is additionally guarded with
-- IF EXISTS so missing/lazy tables (wheel_spins, teams) can never fail it.
--
-- PRE-FLIGHT (run first, save the output):
--   SELECT count(*), max(credits_used) FROM credit_usage;
--   SELECT count(*), max(credits) FROM teams;
-- POST-FLIGHT: values should be exactly 100x the pre-flight numbers.

BEGIN;

CREATE TABLE IF NOT EXISTS data_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM data_migrations WHERE name = '0054_visual_bucs_hundreds') THEN
    RAISE NOTICE '0054_visual_bucs_hundreds already applied on this database — skipping.';
  ELSE
    -- Ledger history: charges are positive, grants/refunds are negative.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'credit_usage') THEN
      UPDATE credit_usage SET credits_used = credits_used * 100;
    END IF;

    -- Historical Stripe purchase records.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'stripe_payments') THEN
      UPDATE stripe_payments SET credits_amount = credits_amount * 100;
    END IF;

    -- Historical generation / spend records.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'distribution_releases') THEN
      UPDATE distribution_releases SET credits_charged = credits_charged * 100;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'generation_history') THEN
      UPDATE generation_history SET credits_used = credits_used * 100
       WHERE credits_used IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'generations') THEN
      UPDATE generations SET credits_spent = credits_spent * 100;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'scheduled_posts') THEN
      UPDATE scheduled_posts SET credits_charged = credits_charged * 100;
    END IF;

    -- Jackpot wheel prizes. Created lazily by the app — guard the update.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'wheel_spins') THEN
      UPDATE wheel_spins SET prize_credits = prize_credits * 100;
    END IF;

    -- Team shared credit pools.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'teams') THEN
      UPDATE teams SET credits = credits * 100;
    END IF;

    -- Jackpot events (historical + any active event rows).
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'cheat_code_events') THEN
      UPDATE cheat_code_events SET prize_credits = prize_credits * 100;
    END IF;

    -- Bow Race config: scale the stored reward and align column defaults
    -- with the hundreds system (code defaults are already ×100).
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'bow_challenge_config') THEN
      UPDATE bow_challenge_config SET reward_credits = reward_credits * 100;
      ALTER TABLE bow_challenge_config ALTER COLUMN reward_credits SET DEFAULT 5000;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'cheat_code_events') THEN
      ALTER TABLE cheat_code_events ALTER COLUMN prize_credits SET DEFAULT 10000;
    END IF;

    INSERT INTO data_migrations (name) VALUES ('0054_visual_bucs_hundreds');
    RAISE NOTICE '0054_visual_bucs_hundreds applied on Render Postgres.';
  END IF;
END $$;

COMMIT;
