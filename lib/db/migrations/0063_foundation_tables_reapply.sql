-- 0063 — foundation tables reapply (hub_projects + artist_vaults).
--
-- WHY THIS FILE EXISTS (2026-10-21 production boot failure):
-- Production's first boot of the promoted build died at
-- 0065_hub_project_attribution.sql: relation "hub_projects" does not exist.
--
-- hub_projects is created by 0045_hub_projects.sql (+ columns in
-- 0046_hub_project_concept.sql), but both files are <= BASELINE (55), so
-- migrate-boot SKIPS them on any database that already has the schema —
-- and they evidently never reached production during the manual era.
-- (The pair is also one of the two duplicate-number pairs the README
-- flags: 0045/0046 each name two different files.) Staging has the table
-- via the retired drizzle-kit push era; production does not.
--
-- artist_vaults has the same disease one step later: it existed only via
-- drizzle-kit push until 0122_creator_tables.sql finally wrote it down,
-- but 0105_spotlight_order.sql ALTERs it UNGUARDED — so any database the
-- push never reached would die at 0105 right after surviving 0065. Its
-- DDL below is copied verbatim from 0122 (which mirrors
-- lib/db/src/schema/artist-vaults.ts exactly).
--
-- WHY 0063: the number has been free since the 2026-10-07 renumber moved
-- its old occupants to 0070/0071. A 0063 file (a) is > BASELINE, so the
-- runner applies it on production; (b) sorts before both first consumers
-- (0065 and 0105); (c) is in no database's data_migrations ledger, so it
-- runs exactly once everywhere. Every statement is IF NOT EXISTS, so on
-- staging — where both tables already exist in their final shapes — this
-- file is a harmless no-op.
--
-- hub_projects DDL is 0045 verbatim plus 0046's two columns replayed as
-- ADD COLUMN IF NOT EXISTS, so the table lands in exactly the shape 0065
-- and 0142 were written against (0142 performs the surrogate-id PK swap
-- itself; nothing here pre-empts it).

CREATE TABLE IF NOT EXISTS hub_projects (
  user_id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  type TEXT NOT NULL DEFAULT 'song',
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS concept text NOT NULL DEFAULT '';
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS template_key text;

COMMENT ON TABLE hub_projects IS
  'Creation Hub: one synced active project per user (name, type, asset tray).';

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
