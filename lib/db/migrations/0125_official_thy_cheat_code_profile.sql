-- 0125: The Tom setup — an official Thy Cheat Code company profile, and
-- every creator's first friend (both directions) via the follows table.
--
-- WHY: The social layer (feed, explore, groups, messages) was built but
-- buried, and there was no official company profile at all. Thy Cheat Code
-- is the site's mascot-host; this migration makes him a real creator
-- profile (slug "thy-cheat-code", publicly viewable at /artist/thy-cheat-code)
-- and connects him to every existing creator, MySpace-Tom style:
--   direction 1: the creator follows Thy (his posts land in their feed —
--                /api/feed reads the follows table)
--   direction 2: Thy (system user) follows the creator back
-- New signups get the same connection at runtime (see
-- artifacts/api-server/src/lib/tom-friendship.ts, hooked into the
-- requireAuth profile-provisioning branch and creator-profile creation).
-- Unfollowing stays possible — nothing here re-adds a follow at boot,
-- and the runtime hook only fires once per user (at provisioning).
--
-- The system user id below is a fixed sentinel UUID for the house
-- account. It never authenticates (no Supabase auth user exists for it);
-- it only owns the official profile and anchors direction-2 follows.
-- It MUST match THY_CHEAT_CODE_USER_ID in lib/tom-friendship.ts.
--
-- Idempotent throughout: re-running changes nothing.

-- 1) Official flag on creator profiles (the gold "verified" check already
--    exists as is_verified; is_official marks staff/company accounts).
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;

-- 2) Seed the official Thy Cheat Code profile (no-op if already present).
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

-- Repair pass: if the row exists but the flags were never set, set them.
-- (Only the flags — never overwrites an edited bio/name/avatar.)
UPDATE creator_profiles
SET is_official = true, is_verified = true, is_public = true, updated_at = now()
WHERE (slug = 'thy-cheat-code' OR user_id = '00000000-0000-4000-8000-000000000001')
  AND (NOT is_official OR NOT is_verified OR NOT is_public);

-- 3) Backfill: mutual first-friend follows for every existing creator.
--    follower_count is bumped ONLY by rows actually inserted, so a
--    retried run (or a user who already followed) never double-counts.
WITH thy AS (
  SELECT id, user_id FROM creator_profiles WHERE is_official ORDER BY created_at LIMIT 1
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
