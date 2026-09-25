-- Instagram auto-post MVP — connected social accounts.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Stores Meta OAuth tokens AES-256-GCM encrypted (never plaintext).
-- user_id references the Supabase auth user; no DB-level FK because auth
-- lives in Supabase while this table lives in Render Postgres.

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'instagram',
  ig_user_id TEXT,
  username TEXT,
  page_id TEXT,
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_accounts_user_id_idx ON social_accounts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_ig_idx
  ON social_accounts (user_id, platform, ig_user_id);
