-- 0035: Character themes — every artist gets their own visual identity.
-- theme_id references a preset in src/lib/character-themes.ts
-- (gold-royalty preserves the classic look for existing artists).
-- Idempotent: safe to re-run.

ALTER TABLE artist_vaults
  ADD COLUMN IF NOT EXISTS theme_id TEXT NOT NULL DEFAULT 'gold-royalty';

CREATE INDEX IF NOT EXISTS idx_artist_vaults_theme
  ON artist_vaults (theme_id);
