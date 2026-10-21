-- 0108 — Wave 9D directing layer tables (Character Director).
-- Pure PLANNING layer over the existing Scene Studio generation pipeline
-- (Runway/Seedance) — no new generation models.
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).

-- Saved director plans: cast_members (JSON array of
--   { vaultId, name, description } objects) + shots (JSON array of
--   { index, characters: [names], action, cameraNote, generatedPrompt }).
CREATE TABLE IF NOT EXISTS wave9d_director_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  cast_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  shots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave9d_director_plans_user_idx
  ON wave9d_director_plans (user_id);
