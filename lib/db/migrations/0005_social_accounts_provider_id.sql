-- TikTok auto-post (drafts tier) — platform-agnostic provider user id + refresh tokens.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
-- Builds on 0002_social_accounts.sql (Instagram MVP); numbered 0005 because
-- 0004 is taken by the Facebook Pages migration.
--
-- The 0002 unique index is (user_id, platform, ig_user_id), which is
-- Instagram-shaped: TikTok rows store their open_id in provider_user_id
-- instead. A second unique index enforces one row per user+platform+provider
-- account for every platform.

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS provider_user_id TEXT;

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;

-- Backfill Instagram rows: their provider id is the IG user id.
UPDATE social_accounts
  SET provider_user_id = ig_user_id
  WHERE provider_user_id IS NULL AND ig_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_provider_idx
  ON social_accounts (user_id, platform, provider_user_id);
