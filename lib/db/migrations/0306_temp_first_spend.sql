-- 0306: Temporary-first spend order (stack1100 Lane Z1 — Gate #5
-- live finding, Nov 1 2026).
--
-- Gate #5 caught the clean-export rail debiting the PERMANENT balance
-- (87,195 → 86,795) while the member's 300 temporary Bucs sat untouched
-- and about to expire — the opposite of the house rule the credit
-- history page states ("Temporary Bucs are spent first"). The core
-- deductCredits already spent temp-first; the export rail kept its own
-- permanent-only deduction, chargeCredits' ledger-failure rollback
-- restored everything to the permanent column, and refundCredits could
-- only restore to the permanent column — because no record anywhere
-- kept the pool split of a charge.
--
-- This migration adds the split record:
-- - credit_usage.bonus_credits_used: how much of a charge row's
--   credits_used came out of the temporary (bonus) pool; a refund row
--   carries the negative of the amount it restored INTO the pool.
--   NULL = the split was never recorded (legacy rows, team-pool
--   charges); pairing a refund to its charge only reads rows where
--   the split is known.
-- - credit_usage.bonus_expires_at: the temporary pool's expiry at the
--   moment of the charge — a later refund restores into the pool
--   under that expiry, or diverts to permanent credits if it has
--   already passed (a refund never evaporates with an expired pool).
-- - export_jobs.credits_from_bonus / credits_bonus_expires_at: the
--   same split for the export rail's reserve/settle charge, recorded
--   on the durable job row so a release after a server restart
--   restores the same pools the reservation drew from.
ALTER TABLE credit_usage
  ADD COLUMN IF NOT EXISTS bonus_credits_used integer;
ALTER TABLE credit_usage
  ADD COLUMN IF NOT EXISTS bonus_expires_at timestamptz;
ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS credits_from_bonus integer;
ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS credits_bonus_expires_at timestamptz;
