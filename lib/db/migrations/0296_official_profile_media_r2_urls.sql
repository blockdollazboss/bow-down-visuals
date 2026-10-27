-- 9999 (PROVISIONAL — renumber at Join #2): S27-17 DB part — the official
-- Thy Cheat Code profile's seeded avatar/banner URLs move from
-- origin-relative paths to the R2 media bucket.
--
-- WHY: Migrations 0125 and 0126 seeded the house profile with
-- origin-relative media URLs ('/images/shark-king-clean-authority.png',
-- '/bowdownvisuals-banner-sharkking.jpg'). Site media moved to the R2
-- bucket (bow-down-visuals-media) so heavy media is served off Render's
-- metered bandwidth, and every other surface was repointed (S27-17 FE
-- part). The seeded DB values were the remaining origin-pinned holdout.
-- 0125/0126 are applied migrations and are never edited, so the rewrite
-- lands here as a new file.
--
-- Both target objects already live on R2 at the same paths (uploaded in
-- the Oct 19 site-media migration; bucket root / images keys verified at
-- the public r2.dev URL), so the absolute URLs below resolve today.
--
-- Exactly-once safe: each UPDATE only matches rows still carrying the
-- exact seeded origin-relative value, so a re-run is a no-op and an
-- avatar/banner the house account has since edited is never clobbered.
-- Scoped to the house sentinel account — the only row 0125/0126 seeded.

UPDATE creator_profiles
SET avatar_url = 'https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/images/shark-king-clean-authority.png',
    updated_at = now()
WHERE user_id = '00000000-0000-4000-8000-000000000001'
  AND avatar_url = '/images/shark-king-clean-authority.png';

UPDATE creator_profiles
SET banner_url = 'https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/bowdownvisuals-banner-sharkking.jpg',
    updated_at = now()
WHERE user_id = '00000000-0000-4000-8000-000000000001'
  AND banner_url = '/bowdownvisuals-banner-sharkking.jpg';
