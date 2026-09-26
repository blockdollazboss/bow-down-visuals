-- 0036: Character linking — characters can star in each other's content.
-- A link connects a character to another character with a role
-- (featured artist, collaborator, cameo, rival, love interest, crew).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS artist_character_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  character_id UUID NOT NULL REFERENCES artist_vaults(id) ON DELETE CASCADE,
  linked_character_id UUID NOT NULL REFERENCES artist_vaults(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_link CHECK (character_id <> linked_character_id),
  CONSTRAINT unique_character_link UNIQUE (character_id, linked_character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_links_character
  ON artist_character_links (character_id);
CREATE INDEX IF NOT EXISTS idx_character_links_user
  ON artist_character_links (user_id);
