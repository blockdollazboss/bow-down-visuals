-- 0240: Commerce tracking pixels (Stack-200 lane 5, wave-4 #41).
--
-- Retargeting pixels existed ONLY in the distribution rail
-- (migration 0186: meta_pixel_id / tiktok_pixel_id / google_tag_id on
-- distribution_releases, fired on the release smartlink landing). The
-- same creator selling through their storefront or shop had no pixel
-- at all. This migration gives both commerce owners the same three
-- columns, with the same discipline:
--
--   * creator_profiles carries the STOREFRONT's pixels (the storefront
--     is per creator profile — store_products.profile_id).
--   * shops carries each customer SHOP's pixels.
--
-- The IDs are the seller's OWN ad-platform IDs, validated server-side
-- on save (invalid IDs are refused, never silently dropped — the
-- release rail's cleanPixelId rule). No ID set = nothing fires; the
-- public surfaces re-validate stored shapes before handing them to
-- the page, so a bent row can never arm a pixel.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS google_tag_id TEXT;

ALTER TABLE shops ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS tiktok_pixel_id TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS google_tag_id TEXT;
