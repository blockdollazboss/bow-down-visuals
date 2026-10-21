-- 0000: bootstrap foundation tables for a from-scratch database.
--
-- Three tables the migration chain assumes already exist — leftovers of
-- the retired drizzle-kit push era — are not written down until much
-- later (or never):
--   * artist_vaults — first written down at 0122, but ALTERed from 0001
--     and used as a foreign-key target from 0006.
--   * credit_usage  — first written down at 0120, but ALTERed from 0047.
--     (It is also the runner's fresh-database canary table.)
--   * profiles      — never written down in this chain; the only file
--     that touches it is 0039 (plan_tier). Its system of record is the
--     Supabase project; this stub carries the columns the server code
--     reads from the Render-side table (id / email / plan). plan_tier
--     is deliberately NOT here — 0039 adds it, with its CHECK
--     constraint, exactly as written.
-- On a literally empty database the runner applies every file from
-- 0001 up, and 0001 / 0039 / 0047 abort boot on the missing relations —
-- a fresh database could never bootstrap (found 2026-10-21 during the
-- gated-production relaunch). This file creates the three tables first
-- so the whole chain applies cleanly end to end.
--
-- WHY THIS CANNOT AFFECT EXISTING DATABASES: migrate-boot skips every
-- file numbered <= BASELINE (55) on any database that already has the
-- credit_usage canary — i.e. every set-up database, including
-- production and staging. 0000 <= 55, so on those databases this file
-- never executes and is never entered in the ledger. Only a
-- canary-less fresh database runs it, and there it sorts ahead of
-- 0001 by filename.
--
-- Shapes are verbatim from the files that eventually write the tables
-- down (0120 for credit_usage, 0122 for artist_vaults), so every later
-- ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS naming these
-- tables lands as a no-op, and a bootstrapped database ends with
-- exactly the schema a push-era database has.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS throughout. No BEGIN/COMMIT
-- (the runner wraps), no CONCURRENTLY.

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

CREATE TABLE IF NOT EXISTS credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  credits_used INTEGER NOT NULL,
  project_id UUID,
  team_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  plan TEXT
);
