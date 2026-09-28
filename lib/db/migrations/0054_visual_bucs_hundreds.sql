-- 0054: Visual Bucs ×100 "hundreds" redenomination (data migration).
--
-- Cosmetic denomination change: every stored Visual Buc amount is multiplied
-- by 100 so the site reads in hundreds (8 → 800, balance 842 → 84,200).
-- Underlying economic value is unchanged — prices, packs, and grants were
-- all scaled ×100 in code alongside this migration.
--
-- IMPORTANT: this migration must run exactly once. The migration runner
-- tracks applied migrations; do NOT re-run it manually (a second run would
-- multiply everything by 100 again).

-- Current balances (Supabase profiles). The bonus_credits column is added
-- lazily by the application (not by a migration), so guard the update.
UPDATE profiles SET credits = credits * 100;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'bonus_credits'
  ) THEN
    UPDATE profiles SET bonus_credits = bonus_credits * 100 WHERE bonus_credits IS NOT NULL;
  END IF;
END $$;

-- Ledger history: charges are positive, grants/refunds are negative.
-- Scaling keeps every historical row consistent with the new balances.
UPDATE credit_usage SET credits_used = credits_used * 100;

-- Historical Stripe purchase records (shown on the Visual Buc history page).
UPDATE stripe_payments SET credits_amount = credits_amount * 100;

-- Historical generation/spend records.
UPDATE distribution_releases SET credits_charged = credits_charged * 100;
UPDATE generation_history SET credits_used = credits_used * 100 WHERE credits_used IS NOT NULL;
UPDATE generations SET credits_spent = credits_spent * 100;
UPDATE scheduled_posts SET credits_charged = credits_charged * 100;

-- Historical jackpot wheel prizes. The wheel_spins table is created lazily
-- by the application (not by a migration), so guard the update.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wheel_spins') THEN
    UPDATE wheel_spins SET prize_credits = prize_credits * 100;
  END IF;
END $$;

-- Team shared credit pools.
UPDATE teams SET credits = credits * 100;

-- Referral history.
UPDATE referrals SET referrer_credits_awarded = referrer_credits_awarded * 100;
UPDATE referrals SET referee_credits_awarded = referee_credits_awarded * 100;
UPDATE referral_payouts SET referrer_credits_awarded = referrer_credits_awarded * 100;
UPDATE referral_payouts SET referee_credits_purchased = referee_credits_purchased * 100;

-- Jackpot events (historical + any active event rows).
UPDATE cheat_code_events SET prize_credits = prize_credits * 100;

-- Bow Race config: scale the stored reward and align the column default
-- with the new hundreds system (code default is 5000).
UPDATE bow_challenge_config SET reward_credits = reward_credits * 100;
ALTER TABLE bow_challenge_config ALTER COLUMN reward_credits SET DEFAULT 5000;
ALTER TABLE cheat_code_events ALTER COLUMN prize_credits SET DEFAULT 10000;
