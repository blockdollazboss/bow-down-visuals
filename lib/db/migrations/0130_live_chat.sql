-- 0130: live stream chat — messages + per-stream mutes for broadcasts.
--
-- Chat rides a broadcast (live_streams, 0129): signed-in viewers post
-- while the stream is live, the streamer moderates (delete any message,
-- mute a chatter for the rest of the stream), and after the stream ends
-- the same rows serve as the read-only "Chat replay" on the watch page.
-- Deletes are soft: the row remains for moderation audit with its body
-- cleared, and reads never serve a deleted row again.
--
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS live_chat_messages_stream_created_idx
  ON live_chat_messages (stream_id, created_at);

CREATE TABLE IF NOT EXISTS live_chat_mutes (
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  muted_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, user_id)
);
