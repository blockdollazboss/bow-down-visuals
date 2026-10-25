-- 0057: Re-apply 0034 (Music Distribution v2 columns).
--
-- 0034 predates the automatic migration runner (migrate-boot.mjs) and was
-- applied manually — but it never ran on the staging database (and possibly
-- not on production either). Staging's distribution_releases table is missing
-- the aggregator columns, which crashes resumeActiveDeliveries at boot with
-- `column "aggregator" does not exist`.
--
-- 0034's body is fully idempotent (IF NOT EXISTS throughout), so re-applying
-- it here is a safe no-op on databases where it already ran.
--
-- Deploy repair (2026-10-25): distribution_releases is created by
-- 0011_distribution_releases.sql, which sits at/below the migrate-boot
-- BASELINE (55) — the boot runner skips <= 0055 on existing databases,
-- assuming they were applied manually pre-runner. On a database where
-- 0011 never ran, the ALTER below FATALs ("relation distribution_releases
-- does not exist") and stalls the whole boot chain — the same gap that
-- killed the bc755447 deploy at 0207 (collab_requests). Where this file
-- has already applied, the runner skips it by filename, so this edit
-- never re-runs; IF NOT EXISTS makes the guard a no-op where the table
-- already exists. Definition copied exactly from 0011.
CREATE TABLE IF NOT EXISTS distribution_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  release_date TEXT,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  audio_url TEXT,
  artwork_url TEXT,
  metadata JSONB,
  strategy JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS distribution_releases_user_idx ON distribution_releases (user_id);

ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS release_type text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS isrc text,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS explicit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS explicit_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upc text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS copyright_line text,
  ADD COLUMN IF NOT EXISTS song_id uuid,
  ADD COLUMN IF NOT EXISTS tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aggregator text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS aggregator_release_id text,
  ADD COLUMN IF NOT EXISTS platform_statuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS presave_slug text UNIQUE;

CREATE TABLE IF NOT EXISTS distribution_royalty_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  payee_name text NOT NULL,
  role text,
  share_pct numeric(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_royalty_splits_release
  ON distribution_royalty_splits(release_id);
