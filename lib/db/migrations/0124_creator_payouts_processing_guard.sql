-- 0124: Atomic guard against concurrent double-payouts.
--
-- WHY: POST /api/connect/payout did SELECT-for-processing then INSERT.
-- Two concurrent requests could both see zero in-flight payouts and both
-- insert 'processing' rows → two Stripe transfers for the same balance.
--
-- This partial unique index makes the INSERT itself the arbiter: only one
-- 'processing' row per profile can exist. The second concurrent INSERT
-- fails with a unique violation (23505), which the route translates to 409.
-- Once a payout leaves 'processing' (pending/failed/completed), the index
-- no longer applies and the next payout proceeds normally.

CREATE UNIQUE INDEX IF NOT EXISTS creator_payouts_profile_processing_ux
  ON creator_payouts (profile_id)
  WHERE status = 'processing';
