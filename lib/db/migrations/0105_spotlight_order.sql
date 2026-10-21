-- 0105 — Spotlight slot order for artist vaults.
-- Lets the user drag-and-drop which artist/character occupies each
-- spotlight slot (#1/#2/#3) on the choose-artist page. Lower = earlier slot.
-- Idempotent: safe to run multiple times (IF NOT EXISTS).
ALTER TABLE artist_vaults
  ADD COLUMN IF NOT EXISTS spotlight_order integer NOT NULL DEFAULT 0;
