-- QR login tokens for passwordless sign-in via QR code scan
-- Flow: desktop generates token -> shows QR -> mobile scans (logged in) -> approves -> desktop polls and signs in

CREATE TABLE IF NOT EXISTS qr_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed', 'expired')),
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  approved_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_token ON qr_login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_qr_login_tokens_expires ON qr_login_tokens(expires_at);

-- Auto-expire old tokens
CREATE OR REPLACE FUNCTION expire_old_qr_tokens()
RETURNS void AS $$
BEGIN
  UPDATE qr_login_tokens
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
