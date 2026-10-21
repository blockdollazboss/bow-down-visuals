-- 0186: Release smartlink analytics + retargeting pixels
-- (competitor gap G2, ~/workspace/competitor-study/live-social-distribution.md).
--
-- The gap: the release smartlink / presave landing (the persistent
-- release page) had email capture and account pre-save but NO click
-- analytics and NO retargeting pixel support — the core paid value of
-- Linkfire / Feature.fm — while bio pages already proved the pattern
-- in-house (bio_link_clicks, migration 0076 line).
--
-- release_link_clicks copies the bio_link_clicks field discipline
-- (one row per event, link key + title snapshot, referrer, created_at)
-- for release landings. kind distinguishes a landing 'view' from an
-- outbound 'click'. channel is the creator-facing attribution label the
-- fan arrived with (?src= / utm_source on the shared link) — a plain
-- text label, never a fingerprint. country is a coarse ISO country
-- code taken from the CDN's geo header when one is present — the IP
-- itself is never stored.
--
-- Retargeting pixels are per-release columns on distribution_releases:
-- the creator's own Meta Pixel / TikTok Pixel / Google tag IDs. The
-- public landing fires exactly the configured pixels on view; a release
-- with none configured fires nothing. IDs are validated server-side on
-- save (invalid IDs are refused, never silently dropped).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS release_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES distribution_releases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'click' CHECK (kind IN ('view', 'click')),
  link_key TEXT NOT NULL DEFAULT '',
  link_title TEXT NOT NULL DEFAULT '',
  channel TEXT,
  referrer TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner analytics aggregate per release, newest first.
CREATE INDEX IF NOT EXISTS release_link_clicks_release_idx
  ON release_link_clicks (release_id, created_at);

ALTER TABLE distribution_releases ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT;
ALTER TABLE distribution_releases ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT;
ALTER TABLE distribution_releases ADD COLUMN IF NOT EXISTS google_tag_id TEXT;
