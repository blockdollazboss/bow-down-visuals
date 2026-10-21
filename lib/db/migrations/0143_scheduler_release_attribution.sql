-- 0143: Scheduler release attribution (site-linkage audit DE-20's deferred
-- half). The scheduler-from-release flow (DE-4) already hands the composer
-- a prefilled announcement from the release itself; until now the created
-- scheduled_posts rows had no way to remember WHICH release they announce,
-- so release-driven posts were indistinguishable from hand-typed ones.
--   1. scheduled_posts.release_id — nullable attribution column. Stamped
--      only when a post is created from a release (the composer carries
--      the release id through the ?schedule=1 deep link); posts scheduled
--      any other way stay NULL. Plain column, no FK: attribution only —
--      deleting a release must never block on, or cascade into, a user's
--      already-scheduled posts (same reasoning that keeps
--      scheduled_posts.user_id FK-free in spirit: this table outlives
--      the things it points at).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

-- ── 1. Scheduler release attribution ───────────────────────────────────
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS release_id UUID;
