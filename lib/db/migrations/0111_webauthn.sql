-- WebAuthn passkey credentials for passwordless login
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_cred_id ON webauthn_credentials(credential_id);

-- Challenges for registration/authentication (short-lived)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_challenge ON webauthn_challenges(challenge);
