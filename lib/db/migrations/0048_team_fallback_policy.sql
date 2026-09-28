-- 0048: Team pool fallback policy.
-- Lets team owners choose whether member spending falls back to personal
-- credits when the shared pool is insufficient. Default true (current behavior)
-- so existing teams are unaffected.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS allow_personal_fallback BOOLEAN NOT NULL DEFAULT true;
