-- 0141: Party Games v1 (#7 owner's games pick) — one row per player per
-- finished party match (Trivia / Court Battle). Rooms are ephemeral
-- socket state and are never stored; only match RESULTS land here, for
-- the party leaderboard and player records.
-- Scores and wins ONLY: this table carries NO Visual Bucs and the party
-- flow never calls a credits function — wagering is a separate owner
-- ruling that has not been made.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS party_match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  game TEXT NOT NULL,
  user_id UUID NOT NULL,
  placement INTEGER NOT NULL,
  score INTEGER NOT NULL,
  rounds_won INTEGER NOT NULL DEFAULT 0,
  won BOOLEAN NOT NULL DEFAULT false,
  player_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS party_match_results_user_idx ON party_match_results (user_id);
CREATE INDEX IF NOT EXISTS party_match_results_user_game_idx ON party_match_results (user_id, game);
CREATE INDEX IF NOT EXISTS party_match_results_room_idx ON party_match_results (room_code);
