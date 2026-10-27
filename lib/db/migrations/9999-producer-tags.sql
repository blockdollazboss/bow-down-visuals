-- 9999-producer-tags.sql (PROVISIONAL number — renumbered at join)
-- #159 Your Own Tag: one signature tag per creator, with a draft ->
-- approve-by-ear lifecycle. Drafts are free to audition; approval charges
-- the tag price unless it is the creator's first approved tag (the house
-- gift). stamp_enabled carries the per-creator export-stamping toggle.

CREATE TABLE IF NOT EXISTS producer_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'spoken',
  text TEXT,
  voice TEXT,
  preset TEXT,
  format TEXT NOT NULL DEFAULT 'mp3',
  audio_url TEXT,
  storage_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  stamp_enabled BOOLEAN NOT NULL DEFAULT true,
  price_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS producer_tags_user_idx ON producer_tags (user_id);
CREATE INDEX IF NOT EXISTS producer_tags_user_status_idx ON producer_tags (user_id, status);
