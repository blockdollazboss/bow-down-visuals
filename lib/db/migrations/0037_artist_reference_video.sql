-- 0037: Character video references (paid option).
-- A generated video portrait of the artist that autoplays on character select.
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_video_url TEXT;
ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_video_path TEXT;
