-- User-uploaded LUT files ("My LUTs") for the LUT Import feature.
-- Idempotent.
CREATE TABLE IF NOT EXISTS user_luts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'cube',
  lut_size INTEGER,
  storage_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_luts_user_id ON user_luts (user_id);
