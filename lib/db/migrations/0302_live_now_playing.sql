-- 0302: Live now-playing state (stack900 lane D3 — the feed lane C2's
-- stream overlays were missing).
--
-- The studio's media playback is client-side canvas state that was
-- never reported to the server, so the OBS/Streamlabs overlays had no
-- truthful "now playing" feed (lane C2 scoped that overlay out rather
-- than fake one). This table is the feed: ONE row per live stream —
-- the track the creator's studio reports as playing on the program
-- right now (title, artist, duration when known, when it started,
-- and an expiry bound set by every report so a closed or crashed
-- studio tab can never leave a song "playing" forever). A track
-- change replaces the row, a stop deletes it, and a stream end
-- deletes it in the stream's close-out. Reads carry title + artist
-- only, keyed by the creator's overlay token (lane C2's
-- creator_overlay_tokens) — no user ids, no stream ids.
--
-- JOIN NOTE: numbered 0302 because 0300 is claimed twice on sibling
-- stack900 branches (B4 room invites + C2 overlay tokens, C2 slated
-- to renumber to 0301 at the join). If the join orders differently,
-- renumber this file to the next free number — nothing references
-- "0302" outside this header.
CREATE TABLE IF NOT EXISTS live_now_playing (
  stream_id uuid PRIMARY KEY REFERENCES live_streams(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  duration_sec integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_now_playing_creator_idx
  ON live_now_playing (creator_user_id);
