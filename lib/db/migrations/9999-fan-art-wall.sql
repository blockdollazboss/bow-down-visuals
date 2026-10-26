-- 9999 (PROVISIONAL — renumber at join time): Fan Art Wall
-- (Stack-200, owner idea batch 4 #157 — TRULY NEW).
--
-- fan_art_pieces: fan-submitted art FOR a creator, displayed in that
-- creator's profile GALLERY block (block type 'gallery') only after
-- the creator approves THAT piece. Born status='pending'; the public
-- wall reads status='approved' only. Revocation (approved -> revoked)
-- removes a piece from the wall immediately; the creator may approve
-- a revoked piece again. artist_name is a submit-time credit snapshot
-- carried on every row in every state — artist credit is never
-- stripped. NO PRICES: no charge rail touches this table.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS fan_art_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  artist_user_id uuid NOT NULL,
  artist_name text NOT NULL DEFAULT 'A fan',
  title text NOT NULL,
  image_url text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fan_art_pieces_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'))
);

CREATE INDEX IF NOT EXISTS fan_art_pieces_wall_idx
  ON fan_art_pieces (creator_profile_id, status, created_at);
CREATE INDEX IF NOT EXISTS fan_art_pieces_artist_idx
  ON fan_art_pieces (artist_user_id, created_at);
