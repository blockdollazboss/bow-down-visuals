-- 0190: Discovery feed preferences (Wave 3 #19, For-You v1).
--
-- feed_preferences: one row per member holding the explicit on/off
-- for For-You personalization on GET /discovery/feed. The ranking
-- itself reads only signals the platform already records (play_events,
-- likes, saves, reactions, reposts) — this table stores NO signal
-- data, just the member's choice. No row = default ON; the routes
-- still serve the untouched legacy feed to any member with no
-- recorded engagement (cold start), and OFF reproduces the legacy
-- feed exactly.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS feed_preferences (
  user_id UUID PRIMARY KEY,
  for_you_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
