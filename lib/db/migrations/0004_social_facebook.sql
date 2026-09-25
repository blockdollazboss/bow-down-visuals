-- Facebook Pages auto-post — extends social_accounts (see 0002_social_accounts.sql).
-- Run ONCE against the production database before the matching code deploys.
-- Idempotent: safe to run multiple times.
--
-- platform='facebook' rows store one Facebook Page each: page_id + page_name
-- identify the Page, and the Page access token (AES-256-GCM encrypted, never
-- plaintext) is used for POST /{page-id}/videos. Page tokens minted from a
-- long-lived user token effectively never expire, so token_expires_at is left
-- NULL for facebook rows; a dead token surfaces as Meta error 190 at publish
-- time and the user is asked to reconnect.

ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_name TEXT;

-- One row per Page per user (the (user_id, platform, ig_user_id) index from
-- 0002 can't dedupe facebook rows because ig_user_id is NULL for them).
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_page_idx
  ON social_accounts (user_id, platform, page_id) WHERE platform = 'facebook';
