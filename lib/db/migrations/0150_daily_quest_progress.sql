-- 0150: The Daily Quest Trio (World Ring 4, THE-GAME).
--
-- One row per member × daily quest × palace day (the UTC date).
-- The trio's defs rotate deterministically by day (lib/daily-quests
-- in the API), so the day is the scope: progress made today never
-- leaks into tomorrow's slate, and a completion left unclaimed at
-- the day-turn expires with its day. Claims stamp reward_vb +
-- marks at claim time (the King's-gift pattern — the row records
-- what was actually paid), and the VB half draws from the shared
-- weekly quest pool (lib/quest-pool counts these rows as its
-- fourth source), never a new issuance.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS daily_quest_progress (
  user_id uuid NOT NULL,
  quest_key text NOT NULL,
  day_date date NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  target integer NOT NULL DEFAULT 1,
  completed boolean NOT NULL DEFAULT false,
  reward_vb integer,
  marks integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_key, day_date)
);

-- The pool's weekly sum and the member's status/marks reads both
-- walk one member's rows by day.
CREATE INDEX IF NOT EXISTS daily_quest_progress_user_day_idx
  ON daily_quest_progress (user_id, day_date);
