-- Creator Streaming Platform — Worker 9 (0091): groups, events, DMs, group posts.
--
-- Groups/events are the social layer of the streaming platform: fan crews,
-- creator-led communities, streams/drops/premieres, and 1:1 DMs.
--
-- Worker 8's posts table was not yet landed when this was written, so group
-- feed scoping lives in the local `group_posts` table (nullable-ready: a
-- future worker can union `posts` with `group_id IS NOT NULL` into the same
-- feed query without touching this table).
--
-- Link-graph contract (cross-surface wiring):
--   groups  -> members link to /creator/:slug (Worker 2 profiles)
--   events  -> host profile (/creator/:slug), ticket products (ticket_url),
--              stream/drop destination (destination_url)
--   DMs     -> participant profiles (/creator/:slug)
--   Explore -> every card deep-links to its destination
--   event reminder notifications carry link=/events/:id
--
-- Idempotent: every statement is safe to re-run.

/* ── Groups ───────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  owner_profile_id UUID REFERENCES creator_profiles(id) ON DELETE SET NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_slug_idx ON groups (slug);
CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups (owner_profile_id);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'mod', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

/* ── Group-scoped posts (group feed lives here until Worker 8's `posts`
      table lands; then union on posts.group_id) ───────────────────────── */
CREATE TABLE IF NOT EXISTS group_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_posts_group_idx ON group_posts (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_posts_author_idx ON group_posts (author_user_id);

/* ── Events ───────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('stream', 'drop', 'premiere', 'other')),
  cover_url TEXT,
  -- Link graph: where the event happens (stream URL / drop page / premiere
  -- destination) and where to buy tickets / paid access.
  destination_url TEXT,
  ticket_url TEXT,
  rsvp_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events (starts_at);
CREATE INDEX IF NOT EXISTS events_profile_idx ON events (profile_id);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS event_rsvps_user_idx ON event_rsvps (user_id);

/* ── DMs ──────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a UUID NOT NULL,
  participant_b UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'inbox'
    CHECK (status IN ('inbox', 'request', 'blocked')),
  requested_by UUID,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_a, participant_b),
  -- Canonical ordering: participant_a is always the lexicographically
  -- smaller UUID (enforced by the API on insert). No reversed duplicates.
  CHECK (participant_a <> participant_b),
  CHECK (participant_a < participant_b)
);

CREATE INDEX IF NOT EXISTS conversations_participants_idx
  ON conversations (participant_a, participant_b);
CREATE INDEX IF NOT EXISTS conversations_last_message_idx
  ON conversations (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_idx
  ON messages (sender_user_id);
