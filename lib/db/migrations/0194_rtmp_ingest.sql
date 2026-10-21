-- 0193: RTMP stream-key ingest for Go Live.
--
-- Until now the multistream rails only pushed RTMP OUT (fan-out to a
-- creator's other platforms). Nothing accepted RTMP IN, so no external
-- encoder — OBS, VirtualDJ, Serato, djay — could be a Bow Down stage
-- source. This migration adds the key storage that fixes that:
--
--   live_ingest_keys: ONE personal ingest key per creator.
--     The plain key is NEVER stored — hashing is one-way, so a
--     database read alone yields no working key (the keys are
--     high-entropy random). The plain key exists only in the
--     owner-only create/regenerate response that mints it: shown
--     once, then unrecoverable — a lost key is replaced by
--     regenerating, never re-shown. It is never present in any
--     stream DTO.
--     key_lookup  SHA-256 hex of the plain key. Publish auth looks up
--                 by hash and compares hashes in constant time.
--     key_hint    last 4 chars of the plain key — lets the owner
--                 recognize which key a program is holding.
--     stream_title the creator's standing title for encoder-started
--                 streams (an encoder can't type a title at push
--                 time); NULL falls back to "<display name> live".
--     revoked_at  set = dead key. Revocation is enforced on every
--                 publish connect and drops any live connection.
--
--   live_streams.ingest_source: 'camera' (browser studio) | 'rtmp'
--   (external encoder). Playback/chat/fan-out treat both identically;
--   the column is the honest source label. Existing rows default to
--   'camera', which is what every stream so far has been.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS live_ingest_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  key_lookup TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  stream_title TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_ingest_keys_user_uidx
  ON live_ingest_keys (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS live_ingest_keys_lookup_uidx
  ON live_ingest_keys (key_lookup);
CREATE INDEX IF NOT EXISTS live_ingest_keys_profile_idx
  ON live_ingest_keys (profile_id);

ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS ingest_source TEXT NOT NULL DEFAULT 'camera';
