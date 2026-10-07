-- AI voice cloning — custom voice profiles per user
-- Profiles backed by ElevenLabs instant voice cloning when available;
-- `source` records the provider so speak-as can route correctly.
CREATE TABLE IF NOT EXISTS voice_clones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- ElevenLabs voice id when cloned via ElevenLabs; null for fallback profiles
  elevenlabs_voice_id TEXT,
  -- Where the user's sample lives (Supabase storage ref or url), for re-clone/debug
  sample_ref TEXT,
  -- 'elevenlabs' | 'openai-match'
  source TEXT NOT NULL DEFAULT 'elevenlabs',
  -- Base OpenAI voice used when speaking via the fallback provider
  base_voice TEXT,
  -- JSON analysis of the sample (duration, rms, speech rate) for matching
  analysis JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_clones_user ON voice_clones(user_id);
