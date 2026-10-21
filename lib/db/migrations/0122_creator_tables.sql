-- 0122: creator tables — artist_vaults, project_drafts, preproduction_packs.
-- These existed only via the retired drizzle-kit push, so any fresh DB
-- 500s across the Artist Vault, project drafts, and pre-production packs.
-- Definitions mirror lib/db/src/schema/artist-vaults.ts,
-- lib/db/src/schema/project-drafts.ts and
-- lib/db/src/schema/preproduction-packs.ts exactly.
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS artist_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  artist_name TEXT NOT NULL,
  artist_type TEXT,
  genre TEXT,
  voice_style TEXT,
  visual_style TEXT,
  hair TEXT,
  tattoos TEXT,
  jewelry TEXT,
  clothing_style TEXT,
  brand_colors TEXT,
  theme_id TEXT NOT NULL DEFAULT 'gold-royalty',
  personality TEXT,
  do_not_change_rules TEXT,
  description TEXT,
  special_style_rules TEXT,
  reference_image_url TEXT,
  reference_image_path TEXT,
  reference_video_url TEXT,
  reference_video_path TEXT,
  consistency_prompt TEXT,
  voice_id TEXT,
  voice_name TEXT,
  voice_preview_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  spotlight_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  team_id UUID
);
CREATE INDEX IF NOT EXISTS artist_vaults_user_id_idx ON artist_vaults (user_id);
CREATE INDEX IF NOT EXISTS artist_vaults_team_id_idx ON artist_vaults (team_id);

CREATE TABLE IF NOT EXISTS project_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workflow_type TEXT NOT NULL,
  title TEXT,
  draft_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_drafts_user_workflow_uniq UNIQUE (user_id, workflow_type)
);
CREATE INDEX IF NOT EXISTS project_drafts_user_id_idx ON project_drafts (user_id);

CREATE TABLE IF NOT EXISTS preproduction_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id TEXT,
  artist_vault_id UUID,
  song_title TEXT,
  genre TEXT,
  mood TEXT,
  bible JSONB,
  storyboard JSONB,
  props JSONB,
  ingredients JSONB,
  assets JSONB,
  status TEXT NOT NULL DEFAULT 'generating',
  credits_charged TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preproduction_packs_user_id_idx ON preproduction_packs (user_id);
CREATE INDEX IF NOT EXISTS preproduction_packs_project_id_idx ON preproduction_packs (project_id);
