-- 0198: Tutorials V1 — the two-sided how-to system inside the Academy
-- (tutorials-scope.md rollout V1).
--
-- Bow Down's official tutorials teach members the site; creators'
-- tutorials teach their fans. V1 builds the shared foundation:
-- designate a published video as a tutorial, group tutorials into
-- ordered series, chapters + resources per tutorial, listings in the
-- Academy and on creator profiles, and server-side fan progress
-- (started / in-progress / completed + a resume point per tutorial).
-- The Creator Tutorial Maker is V2 and paid/member gating is V3 —
-- the columns they will dock into (owner_user_id, profile_id,
-- tutorials.access) exist from day one; V1 only ever writes
-- access = 'free'.
--
--   tutorial_series    ordered shelves; official series are the
--                      operating-flow paths (Start Here → Create →
--                      Brand → Promote → Money), seeded lazily by the
--                      API. is_official is admin-designated only.
--   tutorials          one designated published video + the three
--                      doors (Watch it / Walk me through it via
--                      guide_route / Try it now via try_route).
--                      video_id NULL = the tutorial's video is still
--                      in production: the chapter walkthrough teaches
--                      and the surface says the video is coming —
--                      never a fake player.
--   tutorial_chapters  timestamped chapters; body is the walkthrough
--                      text (the script), so chapters teach with or
--                      without finished media.
--   tutorial_resources attachments per tutorial, optionally pinned
--                      to one chapter.
--   tutorial_progress  one row per (fan, tutorial): status, the
--                      completed chapter set, and the resume point
--                      (last chapter + video position in seconds).
--
-- FREE: no credits column, no price, no charge path anywhere in V1.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS tutorial_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  profile_id UUID REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'creator',
  is_official BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tutorial_series_category_check
    CHECK (category IN ('start-here', 'create', 'brand', 'promote', 'money', 'creator'))
);
CREATE INDEX IF NOT EXISTS tutorial_series_profile_idx ON tutorial_series (profile_id);

CREATE TABLE IF NOT EXISTS tutorials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID REFERENCES tutorial_series(id) ON DELETE SET NULL,
  owner_user_id UUID NOT NULL,
  profile_id UUID REFERENCES creator_profiles(id) ON DELETE CASCADE,
  video_id UUID REFERENCES profile_videos(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'creator',
  position INTEGER NOT NULL DEFAULT 0,
  is_official BOOLEAN NOT NULL DEFAULT false,
  access TEXT NOT NULL DEFAULT 'free',
  guide_route TEXT,
  try_route TEXT,
  transcript TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tutorials_category_check
    CHECK (category IN ('start-here', 'create', 'brand', 'promote', 'money', 'creator')),
  CONSTRAINT tutorials_access_check
    CHECK (access IN ('free', 'followers', 'members', 'paid'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tutorials_video_unique
  ON tutorials (video_id) WHERE video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tutorials_series_idx ON tutorials (series_id);
CREATE INDEX IF NOT EXISTS tutorials_profile_idx ON tutorials (profile_id);

CREATE TABLE IF NOT EXISTS tutorial_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_id UUID NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_sec INTEGER,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tutorial_chapters_position_unique
  ON tutorial_chapters (tutorial_id, position);

CREATE TABLE IF NOT EXISTS tutorial_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutorial_id UUID NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  chapter_id UUID REFERENCES tutorial_chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'link',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tutorial_resources_kind_check CHECK (kind IN ('download', 'link'))
);
CREATE INDEX IF NOT EXISTS tutorial_resources_tutorial_idx ON tutorial_resources (tutorial_id);

CREATE TABLE IF NOT EXISTS tutorial_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tutorial_id UUID NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'started',
  completed_chapters JSONB NOT NULL DEFAULT '[]',
  last_chapter_id UUID REFERENCES tutorial_chapters(id) ON DELETE SET NULL,
  last_position_sec INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tutorial_progress_status_check
    CHECK (status IN ('started', 'in_progress', 'completed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tutorial_progress_user_tutorial_unique
  ON tutorial_progress (user_id, tutorial_id);
