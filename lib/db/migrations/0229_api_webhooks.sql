-- 0229: Developer API webhooks (Stack-100 #3, wave 3, lane 20 —
-- numbered at the join; kept separate from the public-api lane's
-- api_keys migration 0216). secret_hash stores ONLY the SHA-256 hex
-- of the plaintext secret (whsec_…), shown once at creation; the
-- stored hash doubles as the HMAC signing key. events is a
-- comma-joined list from the closed v1 event set enforced in code
-- (new-sale, new-follower, new-member). status is
-- active | paused | disabled; anything not active receives nothing.
CREATE TABLE IF NOT EXISTS api_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  events text NOT NULL,
  secret_prefix text NOT NULL,
  secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_webhooks_user_idx ON api_webhooks (user_id);
CREATE INDEX IF NOT EXISTS api_webhooks_user_status_idx ON api_webhooks (user_id, status);

CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES api_webhooks (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  attempt integer NOT NULL,
  status text NOT NULL,
  response_status integer,
  error text,
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_webhook_deliveries_webhook_idx
  ON api_webhook_deliveries (webhook_id, created_at);
CREATE INDEX IF NOT EXISTS api_webhook_deliveries_event_idx
  ON api_webhook_deliveries (event_id);
