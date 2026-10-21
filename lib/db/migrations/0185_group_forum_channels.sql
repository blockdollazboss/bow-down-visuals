-- 0184: Group forum channels / threads / replies (Wave 3 #13).
--
-- The group feed is one flat stream. Forums give a group topic-contained
-- boards INSIDE the group page: channels (topics) hold threads, threads
-- hold replies. All forum content hangs off the group: visibility and
-- write rules are the group's own (routes resolve the parent group and
-- apply the same public/private + membership gates as the feed).
--
--   group_forum_channels  one row per topic board in a group. Created
--     and managed by group admins+ (the existing role ladder).
--   group_forum_threads   one row per discussion. group_id is
--     denormalized from the channel's group at write time (never from
--     client input) so reads scope by group without a join.
--     reply_count / last_reply_at are maintained by the reply routes.
--     is_pinned / is_locked are moderator controls (pin floats a
--     thread to the top of its channel; lock closes replies for
--     regular members). tags is a plain text array — per-thread
--     labels, nothing more is claimed.
--   group_forum_replies   one row per reply, same denormalized
--     group_id scoping.
--
-- Deletes cascade group -> channels -> threads -> replies, matching
-- group_posts. Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT,
-- no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS group_forum_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_forum_channels_group_idx
  ON group_forum_channels (group_id, position, created_at);

CREATE TABLE IF NOT EXISTS group_forum_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES group_forum_channels(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at TIMESTAMPTZ,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_forum_threads_channel_idx
  ON group_forum_threads (channel_id, created_at);
CREATE INDEX IF NOT EXISTS group_forum_threads_group_idx
  ON group_forum_threads (group_id);
CREATE INDEX IF NOT EXISTS group_forum_threads_author_idx
  ON group_forum_threads (author_user_id);

CREATE TABLE IF NOT EXISTS group_forum_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES group_forum_threads(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_forum_replies_thread_idx
  ON group_forum_replies (thread_id, created_at);
CREATE INDEX IF NOT EXISTS group_forum_replies_group_idx
  ON group_forum_replies (group_id);
