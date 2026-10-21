-- Hum-to-Song: persisted hum/melody recordings.
-- The hum audio itself is saved (Supabase storage ref + public URL) alongside
-- the extracted melody analysis, so it can be re-referenced for regenerations
-- and carried into the hub project. Idempotent.
CREATE TABLE IF NOT EXISTS hum_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  audio_ref TEXT NOT NULL,
  audio_url TEXT,
  analysis JSONB NOT NULL DEFAULT '{}',
  song_url TEXT,
  song_ref TEXT,
  influence TEXT NOT NULL DEFAULT 'text-reference',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hum_recordings_user_id_idx ON hum_recordings (user_id);
CREATE INDEX IF NOT EXISTS hum_recordings_created_at_idx ON hum_recordings (created_at DESC);
