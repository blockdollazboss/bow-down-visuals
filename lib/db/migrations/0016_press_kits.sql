-- Press kits (EPKs): shareable artist pages at /press/:handle.
-- NOTE: sibling feature branches also used the 0008 prefix — renumber at
-- merge time so migrations apply in a clean sequence.
CREATE TABLE IF NOT EXISTS press_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  artist_name TEXT NOT NULL,
  tagline TEXT,
  bio TEXT,
  genre TEXT,
  location TEXT,
  booking_email TEXT,
  website TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  youtube_url TEXT,
  spotify_url TEXT,
  achievements JSONB NOT NULL DEFAULT '[]'::jsonb,
  press_quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  artist_vault_id UUID,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS press_kits_user_id_idx ON press_kits (user_id);
CREATE INDEX IF NOT EXISTS press_kits_handle_idx ON press_kits (handle);
