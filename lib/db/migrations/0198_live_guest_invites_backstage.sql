-- 0198: Go Live guest invite links + backstage (competitor study G3 —
-- the StreamYard mechanic on Bow Down's own pipe).
--
-- Until now the Go Live studio was host-only: nobody could be brought
-- ON AIR except the host, and there was no greenroom — a guest act had
-- no way to get ready with the host before the audience saw them. This
-- migration lands the data layer:
--
--   live_guest_invites: ONE stream's shareable invite links.
--     The plain token is NEVER stored — token_lookup is its SHA-256
--     hex (the same one-way treatment as the RTMP ingest keys, 0193),
--     so a database read alone yields no working link. The plain token
--     exists only in the host's mint response and in the link itself.
--     token_hint (last 4) lets the host recognize a link.
--     expires_at NULL = lives until the stream ends or revocation;
--     max_joins NULL = no per-link cap beyond the room cap.
--     revoked_at set = dead link, enforced on EVERY guest call: a
--     revoke kills future joins and every live session minted from
--     the link at once.
--
--   live_guest_sessions: one row per guest who joined via a link.
--     The guest's session token is likewise stored only as a SHA-256
--     lookup. state walks 'backstage' → 'on_stage' (host promoted) →
--     'left' | 'removed'. There is deliberately NO user_id: a guest
--     is not a member, holds no account, and every surface labels
--     them "Guest" — identity honesty is structural, not cosmetic.
--
--   live_backstage_messages: the greenroom's chat, in its OWN table
--     by design — the public audience chat rail reads
--     live_chat_messages only, so backstage words can never leak to
--     the audience through it. author_kind 'host' | 'guest'; guest
--     rows carry the session id + a display-name snapshot.
--
-- No credits, no prices: guest invites and backstage are FREE (house
-- rule — going live is free; a guest/backstage charge would be an
-- owner ruling, never invented here).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS live_guest_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  host_user_id UUID NOT NULL,
  token_lookup TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  label TEXT,
  expires_at TIMESTAMPTZ,
  max_joins INTEGER,
  join_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_guest_invites_lookup_uidx
  ON live_guest_invites (token_lookup);
CREATE INDEX IF NOT EXISTS live_guest_invites_stream_idx
  ON live_guest_invites (stream_id, created_at);

CREATE TABLE IF NOT EXISTS live_guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES live_guest_invites(id) ON DELETE CASCADE,
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  session_lookup TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'backstage',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_guest_sessions_lookup_uidx
  ON live_guest_sessions (session_lookup);
CREATE INDEX IF NOT EXISTS live_guest_sessions_stream_state_idx
  ON live_guest_sessions (stream_id, state);
CREATE INDEX IF NOT EXISTS live_guest_sessions_invite_idx
  ON live_guest_sessions (invite_id);

CREATE TABLE IF NOT EXISTS live_backstage_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL,
  author_user_id UUID,
  guest_session_id UUID REFERENCES live_guest_sessions(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_backstage_messages_stream_created_idx
  ON live_backstage_messages (stream_id, created_at);
