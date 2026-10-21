-- Inspo Mode "My Vibes" presets — reusable style DNA cards extracted from
-- playlist links / vibe descriptions in Song Maker's Inspo tab.
-- Idempotent: every statement guarded.
CREATE TABLE IF NOT EXISTS inspo_vibe_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  style_dna JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inspo_vibe_presets_user_idx
  ON inspo_vibe_presets (user_id, created_at DESC);
