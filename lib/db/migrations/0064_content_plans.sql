-- 0064: Public content-plan shares (Content Intelligence chain).
--
-- Creators can publish their finished intelligence plan (validated idea,
-- winning hook, niche verdict, competitor gaps, 7-day calendar) to a
-- public, indexable /plan/:slug page. Opt-in, free, no auth to view.
--
-- Safe to run anywhere: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS content_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  creator_name TEXT NOT NULL DEFAULT 'Anonymous Creator',
  include_credit BOOLEAN NOT NULL DEFAULT TRUE,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_plans_slug_idx ON content_plans (slug);
CREATE INDEX IF NOT EXISTS content_plans_user_id_idx ON content_plans (user_id);
