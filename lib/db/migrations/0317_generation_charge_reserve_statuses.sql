-- 0317: generation_charge_intents — reserve-at-submit statuses
-- (stack1400 ruling #43 Part A, reserve-at-submit for the intent-rail
-- family: runway-clip, artist-image, intro-outro, logo).
--
-- The poll-charge design (0298) reverses to RESERVE-AT-SUBMIT, the
-- stack1000 music-rail precedent: the charge lands at submit through
-- chargeCredits (fresh balance read, so the balance itself paces
-- concurrent submits); the intent row becomes the RESERVE RECORD.
-- Two new statuses join the lifecycle:
--   reserved  → the charge is HELD: money moved at submit, the
--               provider work is in flight. A success poll CONFIRMS
--               the reserve (→ 'charged', no second charge); a
--               provider failure / no-output / save failure REFUNDS
--               it in full, exactly once (→ 'refunded').
--   refunded  → the reserve was returned. The status flip itself is
--               the exactly-once claim: only the caller that moves
--               'reserved' → 'refunded' performs the refund.
-- 'awaiting'/'charged'/'failed'/'expired' keep their 0298 meanings
-- for intents recorded before this reversal (a late poll on a legacy
-- 'awaiting' row still settles it exactly once via the settle path).
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE generation_charge_intents
  DROP CONSTRAINT IF EXISTS generation_charge_intents_status_check;

ALTER TABLE generation_charge_intents
  ADD CONSTRAINT generation_charge_intents_status_check
  CHECK (status IN ('awaiting', 'charged', 'failed', 'expired', 'reserved', 'refunded'));
