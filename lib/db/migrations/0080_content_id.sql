-- Content ID Monitor: YouTube Content ID opt-in management + detected-use log.
-- Idempotent. Powers the "Content ID" tab in /analytics-hub (DistroKid
-- YouTube Content ID parity).
--
-- HONESTY NOTE: real YouTube Content ID claiming requires a distribution /
-- CMS partnership this site does not yet have. These tables track the user's
-- opt-in intent, their manually-logged detections, and revenue they record —
-- every opt-in starts at status 'pending_partner' and the claim endpoint
-- refuses with a clear message naming the missing partnership.

CREATE TABLE IF NOT EXISTS content_id_optins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  release_id UUID,
  track_title TEXT NOT NULL DEFAULT '',
  artist_name TEXT,
  -- opted_in: user intent. status: where it stands in the (future) pipeline.
  -- 'pending_partner' = setup stored, awaiting distribution-partner integration.
  opted_in BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending_partner'
    CHECK (status IN ('pending_partner', 'active', 'paused', 'opted_out')),
  opted_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_id_optins_user_idx
  ON content_id_optins (user_id, created_at DESC);
-- One opt-in row per user per release (or per standalone track title).
CREATE UNIQUE INDEX IF NOT EXISTS content_id_optins_user_release_uidx
  ON content_id_optins (user_id, release_id) WHERE release_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_id_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  optin_id UUID REFERENCES content_id_optins (id) ON DELETE SET NULL,
  video_url TEXT NOT NULL DEFAULT '',
  channel_name TEXT NOT NULL DEFAULT '',
  -- 'detected' = user logged it; 'claimed'/'disputed'/'released' are user-set
  -- tracking of where the manual follow-up stands (no automated claims).
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'claim_pending', 'claimed', 'disputed', 'released')),
  notes TEXT NOT NULL DEFAULT '',
  detected_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_id_detections_user_idx
  ON content_id_detections (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_id_detections_optin_idx
  ON content_id_detections (optin_id);
