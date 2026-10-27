-- 9999-unified-live-chat.sql — PROVISIONAL (orphan wave Round-2 #12).
-- Unified cross-platform live chat: source tagging on live_chat_messages.
-- Renumber into the real sequence at join time. Idempotent; no BEGIN/COMMIT.

ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'site';
ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS external_author_name text;

-- Dedupe key for ingested external messages (one row per platform message).
CREATE UNIQUE INDEX IF NOT EXISTS live_chat_messages_source_external_idx
  ON live_chat_messages (stream_id, source, external_id)
  WHERE external_id IS NOT NULL;
