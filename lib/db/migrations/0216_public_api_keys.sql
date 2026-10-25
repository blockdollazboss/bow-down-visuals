-- 0216: Public API keys (Stack-100 #3, #18) — a user mints a scoped key
-- (bdv_live_…) from their settings; integrators generate on the SAME
-- credit rails with the key's user as the charged account. Only the
-- SHA-256 of the secret is stored — the plaintext shows once at mint.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.
-- Schema alignment: api_keys.user_id carries NO foreign key — the Drizzle
-- schema (lib/db/src/schema/api-keys.ts) defines it as a plain uuid and no
-- migration creates a users table, so the REFERENCES clause was dropped to
-- let this file apply on any database.

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["generate:read"]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_status_check CHECK (status IN ('active', 'revoked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_ux ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id, created_at);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys (key_prefix);
