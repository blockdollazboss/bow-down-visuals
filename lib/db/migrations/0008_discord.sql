-- Discord Live integration (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- discord_webhooks: one row per user. The webhook URL is stored AES-256-GCM
-- encrypted (SOCIAL_TOKEN_KEY) — never plaintext. channel_name and
-- mention_everyone are display prefs (not secret).
-- discord_streams: scheduled / live / ended stream records per user.

CREATE TABLE IF NOT EXISTS discord_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  webhook_url_encrypted TEXT NOT NULL,
  channel_name TEXT,
  mention_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discord_webhooks_user_id_idx
  ON discord_webhooks (user_id);

CREATE TABLE IF NOT EXISTS discord_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  game TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  vod_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discord_streams_user_id_idx
  ON discord_streams (user_id);
