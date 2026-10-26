-- 9999 (PROVISIONAL — number assigned at join): "Your Month, Wrapped"
-- opt-out prefs (Stack-200, idea #170).
--
-- The monthly recap is computed on read from the real source tables
-- (play_events, follows, digital_sales, store_orders, profile_tracks,
-- profile_videos); nothing about the recap itself is stored, so the
-- ONLY new table is the per-account opt-out, following the
-- sound_prefs (0242) / retention_prefs house pattern: user_id is the
-- primary key, enabled is boolean NOT NULL DEFAULT true, so an account
-- with no row yet reads as enabled and the first PATCH creates the row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS month_wrapped_prefs (
  user_id UUID PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
