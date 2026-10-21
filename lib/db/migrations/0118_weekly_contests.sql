-- 0118: weekly creator contest ritual — flags on challenges.
-- Idempotent: safe to re-run as a no-op.
-- is_weekly marks contests created by the weekly rotation (POST
-- /api/admin/challenges/weekly-launch); week_key is the ISO week ("2026-W41")
-- the contest belongs to. Consumed by GET /api/challenges/weekly, which
-- powers the Contest Hub widget (dashboard + homepage).
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS "is_weekly" boolean NOT NULL DEFAULT false;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS "week_key" text;
CREATE INDEX IF NOT EXISTS challenges_week_key_idx
  ON challenges (week_key) WHERE week_key IS NOT NULL;
