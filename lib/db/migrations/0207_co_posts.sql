-- 0207_co_posts.sql
-- Co-posts & collab releases, Feed half (Stack-100 #3, #24): ONE post,
-- TWO author sides. The post row in `posts` stays single (its like /
-- reply / repost counts exist exactly once — engagement never
-- double-counts); this table records each creator's side + consent.
--
-- Status machine (api-server src/lib/co-posts.ts is the source):
--   author side starts 'accepted', co-author side starts 'pending';
--   published <=> every side has accepted_at set (kept after withdraw);
--   'declined' is pre-live only and ends the co-post;
--   'withdrawn' removes ONLY that side — the post leaves that creator's
--   profile and the other creator keeps theirs.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house migration rules).

-- Deploy repair (2026-10-25): collab_requests is created by
-- 0018_collab_finder.sql, which sits at/below the migrate-boot BASELINE
-- (55) — the boot runner skips <= 0055 on existing databases, assuming
-- they were applied manually pre-runner. 0018 evidently never ran
-- against production, so collab_requests is missing there and the
-- post_co_authors FK below FATALed the bc755447 deploy. This file has
-- never successfully applied on any database where it FATALs, and where
-- it has applied the runner skips it by filename, so this edit never
-- re-runs there; IF NOT EXISTS makes the guard a no-op where the table
-- already exists. Definition copied exactly from 0018.
CREATE TABLE IF NOT EXISTS collab_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collab_requests_to_user_id_idx
  ON collab_requests (to_user_id);

CREATE INDEX IF NOT EXISTS collab_requests_from_user_id_idx
  ON collab_requests (from_user_id);

CREATE TABLE IF NOT EXISTS post_co_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_author',
  status text NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  collab_request_id uuid REFERENCES collab_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_co_authors_role_check
    CHECK (role IN ('author','co_author')),
  CONSTRAINT post_co_authors_status_check
    CHECK (status IN ('pending','accepted','declined','withdrawn'))
);

CREATE UNIQUE INDEX IF NOT EXISTS post_co_authors_post_profile_uidx
  ON post_co_authors (post_id, profile_id);
CREATE INDEX IF NOT EXISTS post_co_authors_post_idx
  ON post_co_authors (post_id);
CREATE INDEX IF NOT EXISTS post_co_authors_profile_status_idx
  ON post_co_authors (profile_id, status);
CREATE INDEX IF NOT EXISTS post_co_authors_user_status_idx
  ON post_co_authors (user_id, status);
