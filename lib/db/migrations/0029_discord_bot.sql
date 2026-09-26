-- Discord Live Companion Bot (Phase 1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- discord_bot_config: per-user wiring between the site and the discord.js
--   bot service (guild, announce channel, role ping, streamer identity).
-- discord_live_state: current Go Live state, written by the bot on every
--   transition, read by the site to render the LIVE badge.

CREATE TABLE IF NOT EXISTS discord_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  guild_id TEXT,
  announce_channel_id TEXT,
  announce_role_id TEXT,
  mention_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  streamer_discord_user_id TEXT,
  streamer_discord_username TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_bot_config_user_id_idx ON discord_bot_config (user_id);

CREATE TABLE IF NOT EXISTS discord_live_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  is_live BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  channel_id TEXT,
  channel_name TEXT,
  stream_title TEXT,
  announcement_message_id TEXT,
  thread_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_live_state_user_id_idx ON discord_live_state (user_id);
