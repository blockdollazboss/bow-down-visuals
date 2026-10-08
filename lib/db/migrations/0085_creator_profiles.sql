-- Creator Streaming Platform — Foundation (0085): creator_profiles.
--
-- One public creator profile per user: slug, theme, sections layout,
-- featured media, social links, pinned "top creators", and aggregated
-- counters. Workers 2+ build pages, uploads, and commerce on this table.
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS creator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  banner_url TEXT,
  theme_id TEXT NOT NULL DEFAULT 'gold-lux',
  theme_config JSONB NOT NULL DEFAULT '{}',
  sections JSONB NOT NULL DEFAULT '[]',
  featured_media JSONB,
  social_links JSONB NOT NULL DEFAULT '{}',
  top_creators JSONB NOT NULL DEFAULT '[]',
  tip_jar_enabled BOOLEAN NOT NULL DEFAULT true,
  ai_design JSONB,
  is_public BOOLEAN NOT NULL DEFAULT true,
  follower_count INTEGER NOT NULL DEFAULT 0,
  total_plays INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_profiles_slug_idx
  ON creator_profiles (slug);
CREATE INDEX IF NOT EXISTS creator_profiles_user_id_idx
  ON creator_profiles (user_id);
