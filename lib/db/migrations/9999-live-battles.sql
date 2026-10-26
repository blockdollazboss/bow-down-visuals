-- 9999 (PROVISIONAL — renumber at join): Live Battles
-- (Stack-200 TRULY NEW #154).
--
-- Two creators head-to-head live inside the existing live surfaces.
-- live_battles is the durable result record both creators keep;
-- live_battle_votes is the audience's recorded voice — one row per
-- signed-in fan per battle (UNIQUE battle+voter), and the winner is
-- declared from a COUNT of those rows only. Tips never count as
-- votes (no bought votes); stream tips keep moving on the existing
-- live-tips rail, untouched.
--
-- NO PRICES: nothing here charges or pays out. The prize is the
-- Charts-page crown slot (read from the most recent completed
-- battle) plus a World palace announcement — honours, never money.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS live_battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_user_id uuid NOT NULL,
  challenger_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  opponent_user_id uuid NOT NULL,
  opponent_profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  stream_id uuid REFERENCES live_streams(id) ON DELETE SET NULL,
  theme text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  round_count integer NOT NULL DEFAULT 3,
  round_seconds integer NOT NULL DEFAULT 90,
  starts_at timestamptz,
  ends_at timestamptz,
  winner_user_id uuid,
  result text,
  challenger_votes integer,
  opponent_votes integer,
  void_reason text,
  spectacle_announced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_battles_challenger_idx ON live_battles (challenger_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_battles_opponent_idx ON live_battles (opponent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_battles_status_created_idx ON live_battles (status, created_at DESC);
CREATE INDEX IF NOT EXISTS live_battles_stream_idx ON live_battles (stream_id);

CREATE TABLE IF NOT EXISTS live_battle_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES live_battles(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL,
  side text NOT NULL,
  round_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_battle_votes_battle_voter_uniq ON live_battle_votes (battle_id, voter_user_id);
CREATE INDEX IF NOT EXISTS live_battle_votes_battle_idx ON live_battle_votes (battle_id, side);
