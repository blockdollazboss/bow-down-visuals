-- 9999 (PROVISIONAL — renumber at join): Top-Supporter Recognition
-- (Wave-4 #49 + N6 Front Row Boards delta).
--
-- The supporter board is derived at read time from real ledgers only
-- (completed store/digital sales, paid live-shop sales, credited stage
-- tips, paid fan-club joins, active live tickets); rank is never
-- stored. These tables hold only what cannot be derived:
--   supporter_board_settings — the creator's controls: board on/off
--     and the N6 perks text in the creator's own plain words.
--     No row = defaults (board ON, no perks stated).
--   supporter_board_opt_outs — a fan's opt-out of ONE creator's public
--     board (name + badge come off that board; support still counts
--     in the creator's private Fan Graph).
--
-- Recognition only: no Visual Bucs move, nothing is charged.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS supporter_board_settings (
  creator_user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  perks_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supporter_board_opt_outs (
  creator_user_id uuid NOT NULL,
  fan_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_user_id, fan_user_id)
);

CREATE INDEX IF NOT EXISTS supporter_board_opt_outs_creator_idx
  ON supporter_board_opt_outs (creator_user_id);
