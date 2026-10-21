-- 0137: Stack 9 "Reach" — multistream keys, premieres, raids,
-- stream-linked drops, loyalty, close-friends, broadcast channels.
-- Idempotent: safe to re-run as a no-op. Schema: lib/db/src/schema/reach.ts
-- (+ stories.audience below, in creator-stories-posts.ts).

CREATE TABLE IF NOT EXISTS live_destination_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  ingest_url TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_destination_keys_user_platform_uidx ON live_destination_keys (user_id, platform);
CREATE INDEX IF NOT EXISTS live_destination_keys_profile_idx ON live_destination_keys (profile_id);
COMMENT ON TABLE live_destination_keys IS 'Multistream stream keys — SECRETS. Server-side only; never returned by any API DTO.';

CREATE TABLE IF NOT EXISTS premieres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  clip_id UUID REFERENCES generated_clips(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  stream_id UUID REFERENCES live_streams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS premieres_scheduled_idx ON premieres (scheduled_at);
CREATE INDEX IF NOT EXISTS premieres_profile_idx ON premieres (profile_id);
CREATE INDEX IF NOT EXISTS premieres_owner_idx ON premieres (owner_user_id);

CREATE TABLE IF NOT EXISTS live_raids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  source_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  target_stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  target_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'announced',
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_raids_source_idx ON live_raids (source_stream_id, created_at);
CREATE INDEX IF NOT EXISTS live_raids_target_idx ON live_raids (target_stream_id, created_at);

CREATE TABLE IF NOT EXISTS stream_watch_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  seconds_watched INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stream_watch_progress_user_stream_uidx ON stream_watch_progress (user_id, stream_id);

CREATE TABLE IF NOT EXISTS stream_drop_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  threshold_seconds INTEGER NOT NULL,
  amount_vb INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stream_drop_awards_user_stream_threshold_uidx ON stream_drop_awards (user_id, stream_id, threshold_seconds);
CREATE INDEX IF NOT EXISTS stream_drop_awards_week_idx ON stream_drop_awards (week_start);

CREATE TABLE IF NOT EXISTS loyalty_settings (
  profile_id UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  watch_points_per_10min INTEGER NOT NULL DEFAULT 10,
  chat_points INTEGER NOT NULL DEFAULT 2,
  tip_points_per_100vb INTEGER NOT NULL DEFAULT 5,
  custom_reward_label TEXT,
  custom_reward_cost INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_balances (
  user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  watch_minutes_credited INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, profile_id)
);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  perk_kind TEXT NOT NULL,
  perk_label TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_profile_status_idx ON loyalty_redemptions (profile_id, status);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_user_idx ON loyalty_redemptions (user_id);

CREATE TABLE IF NOT EXISTS close_friends (
  owner_user_id UUID NOT NULL,
  owner_profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL,
  friend_profile_id UUID REFERENCES creator_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS close_friends_friend_idx ON close_friends (friend_user_id);
CREATE INDEX IF NOT EXISTS close_friends_owner_profile_idx ON close_friends (owner_profile_id);

CREATE TABLE IF NOT EXISTS broadcast_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES creator_profiles(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_channels_owner_idx ON broadcast_channels (owner_user_id);

CREATE TABLE IF NOT EXISTS broadcast_members (
  channel_id UUID NOT NULL REFERENCES broadcast_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS broadcast_members_user_idx ON broadcast_members (user_id);

CREATE TABLE IF NOT EXISTS broadcast_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES broadcast_channels(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_posts_channel_created_idx ON broadcast_posts (channel_id, created_at);

-- Stories gain the same audience scoping posts already have
-- ('public' | 'followers' | 'close_friends'), enforced at read time.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'public';
