-- 0117: share_events table for the share-to-earn viral loop.
-- Every share action (native share / X / WhatsApp / copy link) from a
-- ShareMenu posts one row here via POST /api/shares. Rows feed the
-- "Viral Sharer" weekly quest (quest_progress, quest_key = 'viral-sharer').
-- Idempotent: safe to re-run as a no-op.
CREATE TABLE IF NOT EXISTS share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content_type TEXT NOT NULL,
  content_id TEXT,
  channel TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_events_user_id_idx ON share_events (user_id);
CREATE INDEX IF NOT EXISTS share_events_created_at_idx ON share_events (created_at);
