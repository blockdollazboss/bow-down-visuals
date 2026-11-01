-- 0310: Drop the two dead counter columns (stack1200 dead-code cleanup,
-- 2026-11-01; census: stack1100 Lane X5 counter-consistency round 2).
--
--   * group_posts.like_count — no writer exists anywhere: there is no
--     like door for group posts, so the column has read 0 on every row
--     since creation. Its only uses were a board ordering key (all-zero
--     degrades to recency) and payload fields that truthfully read 0.
--     The readers now order by created_at explicitly and shape the
--     wire field as the constant 0 (community.ts feed + explore,
--     group-digest aggregate).
--
--   * profile_videos.repost_count — no writer exists: a video "repost"
--     creates a short/post instead of bumping a counter (the repost
--     doors in creator-platform.ts bump only profile_tracks; the
--     generic bumpCounter "video:repost" map entry was unreachable
--     and is removed). Readers were the video DTO (now shapes the
--     honest constant 0) and the shorts ranking SQL, where the
--     repost_count * 4.0 term contributed 0 on every row and is
--     removed — ranking output is unchanged.
--
-- Both columns are removed from the drizzle schema source in the same
-- commit (lib/db/src/schema/community.ts, creator-platform.ts).
-- profile_tracks.repost_count and posts.repost_count are LIVE counters
-- with real writers and are NOT touched.
--
-- Idempotent: DROP COLUMN IF EXISTS is a no-op where a column is
-- already gone (e.g. a database built from the current schema).

ALTER TABLE group_posts DROP COLUMN IF EXISTS like_count;
ALTER TABLE profile_videos DROP COLUMN IF EXISTS repost_count;
