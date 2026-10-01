-- 0054: Visual Bucs ×100 "hundreds" redenomination — SUPABASE side.
--
-- RUN ONCE in the Supabase SQL Editor
-- (Supabase Dashboard → SQL → New query → paste → Run).
--
-- What this covers (Supabase tables only):
--   profiles.credits, profiles.bonus_credits      (user balances)
--   referrals.referrer_credits_awarded,
--   referrals.referee_credits_awarded              (referral history)
--   referral_payouts.referrer_credits_awarded,
--   referral_payouts.referee_credits_purchased     (payout history)
--
-- The Render Postgres tables are migrated separately by
-- lib/db/migrations/0054_visual_bucs_hundreds.sql — run BOTH scripts.
--
-- IDEMPOTENT / EXACTLY-ONCE: a data_migrations marker row is written in the
-- same transaction as the updates. Re-running this script after a successful
-- run prints a NOTICE and changes nothing. A failed run rolls back fully, so
-- it is safe to retry.
--
-- PRE-FLIGHT (run first, save the output):
--   SELECT count(*), max(credits) FROM profiles;
--   SELECT count(*) FROM referrals;
--   SELECT count(*) FROM referral_payouts;
-- POST-FLIGHT (balances should be exactly 100x the pre-flight max):
--   SELECT max(credits) FROM profiles;

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
    -- User balances. bonus_credits is added lazily by the app, so guard it.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'profiles') THEN
      UPDATE profiles SET credits = credits * 100;
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles'
                   AND column_name = 'bonus_credits') THEN
        UPDATE profiles
           SET bonus_credits = bonus_credits * 100
         WHERE bonus_credits IS NOT NULL;
      END IF;
    END IF;

    -- Referral history.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'referrals') THEN
      UPDATE referrals SET referrer_credits_awarded = referrer_credits_awarded * 100;
      UPDATE referrals SET referee_credits_awarded = referee_credits_awarded * 100;
    END IF;

    -- Referral payout history.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'referral_payouts') THEN
      UPDATE referral_payouts SET referrer_credits_awarded = referrer_credits_awarded * 100;
      UPDATE referral_payouts SET referee_credits_purchased = referee_credits_purchased * 100;
    END IF;

    INSERT INTO data_migrations (name) VALUES ('0054_visual_bucs_hundreds');
    RAISE NOTICE '0054_visual_bucs_hundreds applied on Supabase.';
  END IF;
END $$;

COMMIT;
