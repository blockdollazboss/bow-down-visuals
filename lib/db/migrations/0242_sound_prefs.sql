-- 0242: Signature-sound preferences (Stack-200 UPGRADES 183).
--
-- The owner's signature sounds (six v2 stereo masters, one royal motif)
-- play on the site's notification / message / success / error / sting /
-- ringtone moments. The owner's required control is a SOUNDS section in
-- Settings: a MASTER on/off plus per-kind switches, DEFAULT ON, stored
-- PER ACCOUNT and respected by every sound the site plays — no sound may
-- play anywhere its switch is off.
--
-- One row per account, following the retention_prefs shape (0119-era
-- house pattern for per-account on/off prefs): user_id is the primary
-- key, every switch is boolean NOT NULL DEFAULT true, so an account
-- with no row yet reads as the all-on default and the first PATCH
-- creates the row.
--
-- The success_stings switch governs BOTH the success sound and the
-- royal sting (the Settings UI presents them as one "Success & stings"
-- switch, per the owner's control spec). errors_enabled is its own
-- switch so every one of the six kinds has a gate.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS sound_prefs (
  user_id UUID PRIMARY KEY,
  master_enabled boolean NOT NULL DEFAULT true,
  notifications_enabled boolean NOT NULL DEFAULT true,
  messages_enabled boolean NOT NULL DEFAULT true,
  success_stings_enabled boolean NOT NULL DEFAULT true,
  errors_enabled boolean NOT NULL DEFAULT true,
  ringtone_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
