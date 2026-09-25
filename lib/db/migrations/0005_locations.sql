-- User locations library — scene locations for music video creation.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Locations are video-making assets: user-scoped, NOT artist-scoped.
-- They have nothing to do with artist vaults (see 0004_artist_locations.sql
-- for the separate, vault-tied gallery).
-- Must stay in sync with lib/db/src/schema/locations.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS locations_user_id_idx
  ON locations (user_id);
