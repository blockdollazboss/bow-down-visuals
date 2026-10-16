-- 0133: Stack 2 "The stream comes alive" — go-live alert deliveries,
-- web-push subscriptions, stream tips + pinned messages, channel
-- moderators, viewer samples, and the per-stream tip goal.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT (the boot
-- migrator wraps files itself).

-- Go-live alert dedupe: one row per (stream, follower) — the fan-out
-- inserts with ON CONFLICT DO NOTHING and only notifies the followers
-- whose row actually landed, so a stream start can never double-notify.
CREATE TABLE IF NOT EXISTS live_go_live_deliveries (
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  follower_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, follower_user_id)
);

-- Web-push subscriptions (browser Push API endpoints), one row per
-- browser endpoint. Dead endpoints (404/410 from the push service)
-- are deleted by the sender.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- Stream tips: a fan -> creator Visual Bucs transfer tied to a live
-- stream. The chat message the tip rides on is a live_chat_messages
-- row (kind='tip'); pinned_until marks the currently-pinned tip
-- message (a later qualifying tip replaces it by expiring the old
-- rows). idempotency_key is the scoped charge key — unique, so a
-- retried tip can never create a second transfer row.
CREATE TABLE IF NOT EXISTS live_stream_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  tipper_user_id UUID NOT NULL,
  creator_user_id UUID NOT NULL,
  amount_vb INTEGER NOT NULL,
  message_id UUID REFERENCES live_chat_messages(id) ON DELETE SET NULL,
  pinned_until TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_stream_tips_stream_created_idx
  ON live_stream_tips (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_stream_tips_stream_pinned_idx
  ON live_stream_tips (stream_id, pinned_until DESC);

-- Tip messages are chat rows with a kind + amount, so history, replay
-- and moderation treat them exactly like chat (with a gold badge).
ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE live_chat_messages ADD COLUMN IF NOT EXISTS tip_amount_vb INTEGER;

-- Channel moderators: appointed per creator profile (not per stream),
-- so a mod's powers ride every stream that creator runs.
CREATE TABLE IF NOT EXISTS live_channel_moderators (
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  moderator_user_id UUID NOT NULL,
  appointed_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, moderator_user_id)
);
CREATE INDEX IF NOT EXISTS live_channel_moderators_user_idx
  ON live_channel_moderators (moderator_user_id);

-- Viewer samples: one row per heartbeat window per stream, written by
-- the heartbeat route (throttled), so a post-stream summary can report
-- a real average instead of guessing from the peak alone.
CREATE TABLE IF NOT EXISTS live_viewer_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  viewer_count INTEGER NOT NULL,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_viewer_samples_stream_sampled_idx
  ON live_viewer_samples (stream_id, sampled_at);

-- The creator's Visual Bucs goal for a stream (overlay goal bar +
-- summary). Null = no goal set.
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS tip_goal_vb INTEGER;
