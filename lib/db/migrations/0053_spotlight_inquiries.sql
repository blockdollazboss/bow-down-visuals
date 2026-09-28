-- 0053: Spotlight Takeover inquiries (auth-screen ad slot).
-- Lead-capture only v1: advertisers request the 7-day video-background slot
-- on the sign-in / sign-up screens. No charge is taken at inquiry time;
-- the owner follows up and approves before anything goes live.

CREATE TABLE IF NOT EXISTS spotlight_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  video_url TEXT NOT NULL,
  target_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spotlight_inquiries_status_idx
  ON spotlight_inquiries (status);
CREATE INDEX IF NOT EXISTS spotlight_inquiries_created_at_idx
  ON spotlight_inquiries (created_at DESC);
