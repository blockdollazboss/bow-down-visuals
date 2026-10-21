-- 0076: Link-in-Bio pages.
--
-- Creators build a public link-in-bio page (draft free, 100 Visual Bucs to
-- publish) served at /bio/:slug with no login required. Click analytics are
-- stored per link so the builder shows a simple counts dashboard.
-- Safe to run anywhere: all statements are IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS bio_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  -- [{ title: string, url: string, icon: string }] — the link rows
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { instagram, tiktok, youtube, x, spotify, discord } -> url
  socials JSONB NOT NULL DEFAULT '{}'::jsonb,
  theme TEXT NOT NULL DEFAULT 'gold-royal',
  -- [{ label: string, url: string, kind: string }] — featured hub assets
  featured JSONB NOT NULL DEFAULT '[]'::jsonb,
  tip_jar_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bio_pages_user ON bio_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_bio_pages_slug ON bio_pages(slug);
CREATE INDEX IF NOT EXISTS idx_bio_pages_published ON bio_pages(is_published);

CREATE TABLE IF NOT EXISTS bio_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bio_page_id UUID NOT NULL REFERENCES bio_pages(id) ON DELETE CASCADE,
  link_index INTEGER NOT NULL DEFAULT -1,
  link_title TEXT NOT NULL DEFAULT '',
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bio_link_clicks_page ON bio_link_clicks(bio_page_id);
CREATE INDEX IF NOT EXISTS idx_bio_link_clicks_page_created ON bio_link_clicks(bio_page_id, created_at DESC);
