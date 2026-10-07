-- Song Mashup (Suno parity). Idempotent.
-- songs gains mashup provenance columns: which two songs a mashup was
-- blended from, and which blend style was used. Albums already exist
-- (0066_albums.sql); no new album tables needed here.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_sources JSONB;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mashup_style TEXT;
