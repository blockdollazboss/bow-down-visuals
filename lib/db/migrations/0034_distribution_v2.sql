-- 0029: Music Distribution v2 — release tiers, full metadata, per-platform
-- delivery statuses, royalty splits, pre-save slugs.
-- Idempotent: safe to re-run.

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
