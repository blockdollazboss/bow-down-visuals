-- Voice personas (Suno parity) — saveable vocal identities
CREATE TABLE IF NOT EXISTS voice_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
  -- Vocal settings: style, tone, etc. as JSON
  settings JSONB NOT NULL DEFAULT '{}',
  -- Whether this is a public template or private to the user
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_personas_user ON voice_personas(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_personas_public ON voice_personas(is_public) WHERE is_public = true;
