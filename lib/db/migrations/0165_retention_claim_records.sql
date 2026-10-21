-- 0165: Retention claim records (STACK-20 R2 follow-up — closing the
-- honest exclusion documented in the Treasury ledger, R2 item #13).
-- Two retention awards paid real amounts but kept NO per-claim row:
--   * Daily Drop claims (lib/bonus claimDailyBonus): the only trace
--     was profiles.last_daily_claim — a single DATE on the bonus
--     profile. The amount paid (200 base / 1,000 on every 7th streak
--     day) and the moment of the claim were recorded nowhere.
--   * Creation-streak milestone claims (lib/retention
--     claimStreakMilestone): creation_streaks.milestones_claimed
--     records WHICH milestone days were claimed, never WHEN — the
--     reward (100 / 250 / 500 / 1,000 VB for 3 / 7 / 14 / 30 days)
--     was stamped nowhere per claim.
-- So the Treasury claim ledger (getTreasuryHistory) listed every
-- other source and deliberately invented nothing for these two.
--   retention_claim_records — one row per claim of either kind,
--     written by the claim path itself in the same request, right
--     after the award pays (a failed award writes nothing). ref_key
--     is the claim's own identity: the UTC day (YYYY-MM-DD) for a
--     daily drop, the milestone day count (as text) for a streak
--     milestone — the same identity each claim's own guard enforces
--     (last_daily_claim = today; the milestone's NOT-@> append), so
--     the unique (user_id, kind, ref_key) index makes a replayed
--     write a no-op instead of a second row. amount_vb is the
--     amount the award actually paid, stamped at claim time.
-- History is NOT backfilled: claims from before this migration
-- left no per-claim record anywhere, and none is invented here.
-- Only claims from 0165 forward appear in the ledger.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS retention_claim_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily_drop', 'streak_milestone')),
  ref_key TEXT NOT NULL,
  amount_vb INTEGER NOT NULL CHECK (amount_vb > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS retention_claim_records_user_kind_ref_uidx ON retention_claim_records (user_id, kind, ref_key);
CREATE INDEX IF NOT EXISTS retention_claim_records_user_created_idx ON retention_claim_records (user_id, created_at);
