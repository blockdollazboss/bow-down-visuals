-- 0126: King's Welcome hardening — anchor the official profile to the
-- house account ONLY.
--
-- WHY: Migration 0125 is already applied on staging, and its repair pass
-- stamps ANY profile holding the slug "thy-cheat-code" (or the sentinel
-- user id) as official + verified + public. If a squatter had grabbed
-- that slug before 0125 ran, 0125 would have crowned a stranger's
-- profile the official account — and its backfill (which anchors on
-- "any profile flagged is_official") would have connected every
-- creator to them. 0125 is an applied migration and is never edited;
-- this migration repairs whatever state it left behind.
--
-- What this does, in order:
--   1) Un-crowns every profile flagged official that is NOT owned by
--      the house sentinel account.
--   2) Crowns the house account's own row if it exists.
--   3) Seeds the official profile ONLY if the house row is missing AND
--      the slug is genuinely free. If a squatter holds the slug, this
--      safely does nothing — no official profile exists, the runtime
--      lookup (also pinned to the house account in kings-welcome.ts)
--      finds nothing, and the King's Welcome simply stays off instead
--      of friending anyone to a stranger.
--   4) Backfills mutual first-friend follows anchored to the house
--      account specifically (never "any official profile"), so a
--      house profile seeded here still connects existing creators.
--      Idempotent: inserts are ON CONFLICT DO NOTHING and follower
--      counts bump only for rows actually inserted.
--
-- Follows that 0125's backfill may have created toward a squatter
-- profile are NOT deleted here: once un-crowned, that profile is an
-- ordinary profile and those rows are indistinguishable from organic
-- follows. Unfollowing remains the user's own choice, as designed.
--
-- Idempotent throughout: re-running changes nothing.

-- 1) Un-crown any non-house profile flagged official.
UPDATE creator_profiles
SET is_official = false, updated_at = now()
WHERE is_official
  AND user_id <> '00000000-0000-4000-8000-000000000001';

-- 2) Crown the house account's own row, if it exists.
UPDATE creator_profiles
SET is_official = true, is_verified = true, is_public = true, updated_at = now()
WHERE user_id = '00000000-0000-4000-8000-000000000001'
  AND (NOT is_official OR NOT is_verified OR NOT is_public);

-- 3) Seed the official profile only if the house row is missing AND
--    the slug is genuinely free.
INSERT INTO creator_profiles (
  user_id, slug, display_name, bio, avatar_url, banner_url,
  theme_id, vertical, social_links, tip_jar_enabled,
  is_public, is_verified, is_official
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  'thy-cheat-code',
  'Thy Cheat Code',
  '🦈 The King Shark — I run Bow Down Visuals, the content creation cheat code. I''m everybody''s first friend here: new drops, jackpot winners, creator tips and cheat codes, straight to your feed. Now go make something they can''t ignore — and get paid for it.',
  '/images/shark-king-clean-authority.png',
  '/bowdownvisuals-banner-sharkking.jpg',
  'gold-lux',
  'influencer',
  '{"website": "https://bowdownvisuals.com"}'::jsonb,
  false,
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM creator_profiles
  WHERE slug = 'thy-cheat-code'
     OR user_id = '00000000-0000-4000-8000-000000000001'
);

-- 4) Backfill mutual first-friend follows, anchored to the house
--    account's profile specifically. No-op when no house profile exists.
WITH thy AS (
  SELECT id, user_id FROM creator_profiles
  WHERE user_id = '00000000-0000-4000-8000-000000000001'
    AND is_official
  LIMIT 1
),
ins_user_follows_thy AS (
  INSERT INTO follows (follower_user_id, profile_id)
  SELECT cp.user_id, thy.id
  FROM creator_profiles cp CROSS JOIN thy
  WHERE cp.user_id <> thy.user_id
  ON CONFLICT DO NOTHING
  RETURNING profile_id
),
ins_thy_follows_user AS (
  INSERT INTO follows (follower_user_id, profile_id)
  SELECT thy.user_id, cp.id
  FROM creator_profiles cp CROSS JOIN thy
  WHERE cp.id <> thy.id
  ON CONFLICT DO NOTHING
  RETURNING profile_id
),
bump AS (
  SELECT profile_id, count(*) AS n
  FROM (
    SELECT profile_id FROM ins_user_follows_thy
    UNION ALL
    SELECT profile_id FROM ins_thy_follows_user
  ) s
  GROUP BY profile_id
)
UPDATE creator_profiles cp
SET follower_count = cp.follower_count + bump.n, updated_at = now()
FROM bump
WHERE cp.id = bump.profile_id;
