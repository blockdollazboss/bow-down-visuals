-- 0140: Arcade v1 (#6 owner's games pick) — one row per finished run in
-- Shark King Endless Runner / Shooter Gallery. Scores only: this table
-- carries NO Visual Bucs. Arcade rewards ride the existing Shark Drop
-- rail (shark_drops, ≤2 drops / rolling 7 days, 100–500 VB each), so
-- nothing in the arcade mints credits.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS arcade_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arcade_scores_game_score_idx ON arcade_scores (game, score DESC);
CREATE INDEX IF NOT EXISTS arcade_scores_user_game_idx ON arcade_scores (user_id, game);
