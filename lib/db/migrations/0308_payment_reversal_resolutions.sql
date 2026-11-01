-- 0308: Payment reversal resolutions — the human's decision on a
-- parked reversal row (stack1100 Lane Y2).
--
-- The reversal engine (migration 0183) parks charges it must not
-- reverse on its own at status 'needs_manual_review' — branding
-- orders that may already be printed, subscription charges, released
-- escrow, and charges no grant record identifies. The admin bench
-- (stack1100 X1) made the queue visible, but no write verb existed
-- anywhere: a parked row could never be resolved. This migration
-- adds the verb's audit trail.
--
-- payment_reversal_resolutions: ONE row per resolution (UNIQUE
-- reversal_id — the resolve verb inserts this row FIRST as its
-- exactly-once claim, before any leg runs, so a double-click, a
-- retry, or two admins at once can never double-act). It records
-- who decided (admin user id + email), when, which way, and the
-- admin's note:
--   decision  'complete' — the engine's own completion path ran for
--             the parked row (its entitlement/seller legs) and the
--             row landed at 'completed';
--             'dismiss' — reviewed, no reversal: the row landed at
--             'dismissed' and NO money moved.
-- The row's own details jsonb mirrors the same record, and
-- payment_reversals.status gains the 'dismissed' terminal state
-- (status is plain TEXT — no constraint to alter).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS payment_reversal_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id UUID NOT NULL REFERENCES payment_reversals(id) ON DELETE CASCADE,
  stripe_charge_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  admin_user_id UUID,
  admin_email TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_reversal_resolutions_reversal_ux
  ON payment_reversal_resolutions (reversal_id);

CREATE INDEX IF NOT EXISTS payment_reversal_resolutions_created_idx
  ON payment_reversal_resolutions (created_at);
