-- 0115: Loading Screen Takeover inquiries (loader ad slot).
-- Lead-capture only v1: advertisers request the 7-day brand placement
-- across the site's loading screens (WittyLoader). No charge is taken at
-- inquiry time; the owner follows up and approves before anything goes live.
-- Mirrors 0053 (spotlight_inquiries).

CREATE TABLE IF NOT EXISTS loading_screen_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  video_url TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loading_screen_inquiries_status_idx
  ON loading_screen_inquiries (status);
CREATE INDEX IF NOT EXISTS loading_screen_inquiries_created_at_idx
  ON loading_screen_inquiries (created_at DESC);
