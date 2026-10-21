-- 0119: login-streaks-with-teeth retention pref keys on retention_prefs.
-- Idempotent: safe to re-run as a no-op.
-- Owned by the prefs plumbing; consumed by sibling systems
-- (login streaks, share-to-earn, contests, FOMO feed).
ALTER TABLE retention_prefs ADD COLUMN IF NOT EXISTS "login_streaks_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE retention_prefs ADD COLUMN IF NOT EXISTS "share_to_earn_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE retention_prefs ADD COLUMN IF NOT EXISTS "contests_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE retention_prefs ADD COLUMN IF NOT EXISTS "fomo_feed_enabled" boolean NOT NULL DEFAULT true;
