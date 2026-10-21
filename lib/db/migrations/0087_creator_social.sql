-- Creator Streaming Platform — Foundation (0087): social layer.
--
-- follows (profile wall follows), profile_comments (wall), media_comments
-- (per track/video), likes (polymorphic kind+target), reposts (tracks),
-- play_events (raw play log backing analytics), notifications (inbox).
--
-- Idempotent: every statement is safe to re-run.

CREATE TABLE IF NOT EXISTS follows (
  follower_user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, profile_id)
);

CREATE INDEX IF NOT EXISTS follows_profile_id_idx
  ON follows (profile_id);

CREATE TABLE IF NOT EXISTS profile_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_comments_profile_id_idx
  ON profile_comments (profile_id);

CREATE TABLE IF NOT EXISTS media_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('track', 'video')),
  media_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_comments_media_idx
  ON media_comments (kind, media_id);
CREATE INDEX IF NOT EXISTS media_comments_author_idx
  ON media_comments (author_user_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('track', 'video', 'playlist', 'comment')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, target_id)
);

CREATE INDEX IF NOT EXISTS likes_target_idx
  ON likes (kind, target_id);

CREATE TABLE IF NOT EXISTS reposts (
  user_id UUID NOT NULL,
  track_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS reposts_track_id_idx
  ON reposts (track_id);

CREATE TABLE IF NOT EXISTS play_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('track', 'video')),
  media_id UUID NOT NULL,
  user_id UUID,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS play_events_media_idx
  ON play_events (kind, media_id);
CREATE INDEX IF NOT EXISTS play_events_user_idx
  ON play_events (user_id);
CREATE INDEX IF NOT EXISTS play_events_played_at_idx
  ON play_events (played_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx
  ON notifications (user_id, is_read);
