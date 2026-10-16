-- 0129: live_streams — native on-site broadcasts ("Go Live" stream studio).
--
-- A broadcast session is NOT a discord_streams row: those carry schedule /
-- announce semantics for Discord webhook posts (game, scheduled_for, a VOD
-- link pasted after the fact). A broadcast has a provider lifecycle instead:
-- a Cloudflare Stream live input is created when the creator goes live and
-- deleted when the stream ends, playback ids/URLs hang off it, viewer counts
-- accrue while it runs, and the browser-recorded VOD is registered back onto
-- the row (and into generated_clips) when the stream wraps. Different shape,
-- different table — the Discord announce flow stays untouched and simply
-- links to the watch page.
--
-- Idempotent: safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS live_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  provider TEXT NOT NULL DEFAULT 'cloudflare-stream',
  provider_input_id TEXT,
  playback_id TEXT,
  -- Broadcaster-only: the WHIP publish URL handed out once at create time.
  -- Server-side record; never exposed in public/watch DTOs.
  whip_url TEXT,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  vod_url TEXT,
  vod_clip_id UUID REFERENCES generated_clips(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_streams_status_started_idx ON live_streams (status, started_at DESC);
CREATE INDEX IF NOT EXISTS live_streams_user_id_idx ON live_streams (user_id);
CREATE INDEX IF NOT EXISTS live_streams_profile_id_idx ON live_streams (profile_id);
-- One live broadcast per creator at a time, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_live_per_user_idx
  ON live_streams (user_id) WHERE status = 'live';
-- Multistream readiness: every broadcast carries its destinations list
-- (platform + label + status). V1 only ever activates the site itself
-- ("Your profile"); fan-out destinations slot in here later without a
-- model change. The API normalizes the list on write and on read.
ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS destinations JSONB NOT NULL
  DEFAULT '[{"platform":"site","label":"Your profile","status":"active"}]'::jsonb;
