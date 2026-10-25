-- 0239: Membership pause (Wave 4 #39) — let a member rest instead of cancelling.
-- A fan whose money is tight had exactly one button: cancel, and
-- cancelled fans mostly never return. Pause gives them 1–3 months of
-- rest: the stored status becomes 'paused', access sleeps at every
-- gate (all gates admit only effective trialing / active), and the
-- paid-period clock freezes — paused_at / paused_until record the
-- rest, and on resume current_period_end shifts forward by the time
-- spent paused so no paid time burns and no renewal falls due while
-- resting (the billing skip on the existing period-checkout rail).
-- Dunning (#21) is untouched: it works stored status 'past_due' only,
-- and a paused row is never past_due, so a resting fan is never chased.
--
-- fan_tiers.pause_enabled lets a creator disable the pause offer per
-- tier. Default true: pause is offered unless the creator turns it off.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS paused_until timestamptz;
ALTER TABLE fan_tiers ADD COLUMN IF NOT EXISTS pause_enabled boolean NOT NULL DEFAULT true;
