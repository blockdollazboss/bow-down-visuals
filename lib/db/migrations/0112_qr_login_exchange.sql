-- Secure QR login: one-time exchange codes for the desktop session exchange.
-- When the mobile device approves, the server mints a single-use exchange
-- code on the token row. The desktop polls for it and redeems it exactly
-- once via POST /api/auth/qr-exchange, which atomically consumes it and
-- returns a Supabase magic link so the desktop can establish its own
-- session. The code never leaves the token row except to the polling
-- desktop that holds the token.

ALTER TABLE qr_login_tokens ADD COLUMN IF NOT EXISTS exchange_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_login_tokens_exchange_code
  ON qr_login_tokens(exchange_code);
