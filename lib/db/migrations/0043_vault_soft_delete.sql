-- Soft deletes for artist_vaults: never permanently lose user data.
-- Adds deleted_at timestamp; application sets it instead of hard-deleting.
ALTER TABLE artist_vaults
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_artist_vaults_user_deleted
  ON artist_vaults (user_id, deleted_at);
