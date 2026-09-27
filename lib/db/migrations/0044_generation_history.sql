-- Generation history: automatically save every AI generation (images, videos, songs, etc.)
-- so users never lose their work.
CREATE TABLE IF NOT EXISTS generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL, -- 'image', 'video', 'song', 'voice', etc.
  title TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  prompt TEXT,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Soft delete: never permanently lose user data
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_generations_user_created
  ON generations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_user_type
  ON generations (user_id, type);
