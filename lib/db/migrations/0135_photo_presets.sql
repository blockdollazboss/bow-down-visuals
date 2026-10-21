-- 0135: Stack 7 "Photo desk becomes an editor" — user preset packs.
-- One row per saved look (develop recipe JSON, the same camelCase
-- recipe format batch look-sync consumes). Public rows are served by
-- share_slug on the public preset page. store_product_id links a pack
-- to a store product when one is created for it (nullable until then).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS photo_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  recipe JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  share_slug TEXT UNIQUE,
  store_product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_presets_user_idx ON photo_presets (user_id);
CREATE INDEX IF NOT EXISTS photo_presets_public_idx ON photo_presets (is_public) WHERE is_public;
