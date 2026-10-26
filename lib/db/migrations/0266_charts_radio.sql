-- 9999 (PROVISIONAL — coordinator renumbers at join): Charts Radio
-- listener preference (Stack-200 #156).
--
-- Charts Radio is the house's 24/7 station: its rotation is built
-- per-request from REAL chart data (the week chart + the newest
-- published drops, routes/discovery GET /radio) and needs no stored
-- schedule. The one thing worth persisting is the listener's own
-- choice: tuned_in remembers that a member chose the station, so
-- surfaces can offer "press play to resume". It is a memory, never
-- an autoplay license — playback always starts on an explicit press.
--
-- One row per account, following the sound_prefs shape (0242):
-- user_id is the primary key, tuned_in is boolean NOT NULL DEFAULT
-- false, so an account with no row yet reads as not tuned in and
-- the first PATCH creates the row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS charts_radio_prefs (
  user_id UUID PRIMARY KEY,
  tuned_in boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
