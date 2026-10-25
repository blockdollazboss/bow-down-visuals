-- 0241: Settings-cards schema repair (Stack-200 lane 2).
--
-- WHY: four Settings cards (Connected Accounts, Social Proof, Discord,
-- API keys) error on load in production. Two distinct root causes:
--
-- 1. BASELINE-SKIP GAP (social_accounts, discord_webhooks): these tables
--    are created ONLY by migrations 0002/0004/0007/0008 — all at/below
--    the migrate-boot BASELINE (55) — so the boot runner skips them on
--    existing databases on the assumption they were applied manually
--    pre-runner. The Oct 25 production-shaped replay proved that
--    assumption false for sibling tables (collab_requests,
--    distribution_releases, songs). Where the tables are absent, every
--    query 500s. The CREATEs below are copied exactly from
--    0002/0004/0007/0008 and are no-ops where the tables already exist.
--    creator_social_proof (0203) is re-guarded the same way for the
--    Social Proof card.
--
-- 2. api_keys SHAPE MISMATCH (deterministic, every database that took
--    0216): 0216 created scopes as JSONB plus a `status` column and NO
--    `revoked_at`, while the Drizzle schema (lib/db/src/schema/api-keys.ts)
--    and all of lib/api-keys.ts expect scopes as comma-joined TEXT and
--    revocation as a `revoked_at` timestamp. Every api_keys query names
--    revoked_at, so the list/create/auth paths fail with 42703 on the
--    0216-shaped table. The DO blocks below align the table to the
--    schema: add revoked_at and convert jsonb scopes to the
--    comma-joined text form parseScopes() reads. Every step is
--    idempotent, so the file is a no-op in effect on a database whose
--    api_keys already matches the Drizzle schema.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

-- ── social_accounts (exact copy of 0002 + 0004 + 0007) ─────────────────
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
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS page_name TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider_user_id TEXT;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;
CREATE INDEX IF NOT EXISTS social_accounts_user_id_idx
  ON social_accounts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_ig_idx
  ON social_accounts (user_id, platform, ig_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_page_idx
  ON social_accounts (user_id, platform, page_id) WHERE platform = 'facebook';
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_provider_idx
  ON social_accounts (user_id, platform, provider_user_id);

-- ── discord_webhooks + discord_streams (exact copy of 0008) ──────────
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

-- ── creator_social_proof (exact copy of 0203) ──────────────────────────
CREATE TABLE IF NOT EXISTS creator_social_proof (
  profile_id UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  figures JSONB NOT NULL DEFAULT '[]'::jsonb,
  hidden_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_social_proof_user_idx
  ON creator_social_proof (user_id);

-- ── api_keys: create in the Drizzle shape if absent, then align ──────
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_ux ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id, created_at);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);

-- 0216 shape: scopes is JSONB ('["profile:read"]') — convert to the
-- comma-joined TEXT the code reads/writes ('profile:read'). The plain
-- TYPE change casts jsonb through its text output; the UPDATE then
-- strips the JSON array punctuation from any converted values
-- (parseScopes also trims each segment, so the space after a comma is
-- harmless). On an already-TEXT column both statements are no-ops in
-- effect: the type is unchanged and no comma-joined value starts
-- with '['.
ALTER TABLE api_keys ALTER COLUMN scopes TYPE text;
UPDATE api_keys
SET scopes = REPLACE(REPLACE(REPLACE(scopes, '[', ''), ']', ''), '"', '')
WHERE scopes LIKE '[%';

-- NOTE on 0216's `status` column: it is deliberately left in place
-- (the Drizzle schema ignores it) and no status→revoked_at backfill is
-- needed — no row could ever be created through the app on the 0216
-- shape, because the create insert itself writes comma-joined scopes
-- text, which the jsonb column rejects as invalid JSON. The table is
-- therefore empty wherever it kept the 0216 shape.
