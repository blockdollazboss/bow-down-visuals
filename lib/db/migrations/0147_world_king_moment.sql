-- 0147: The King's daily moment (World Ring 3, THE-GAME §5 Q2 +
-- §5(b)). Once a day, at the palace day-turn (00:00 UTC — the same
-- boundary the site's daily claim flips on), the King holds court
-- in the Throne Hall: the palace is heralded through the announce
-- channel, the day's risers and tonight's slate are named, and the
-- members standing in the hall may claim a small audience gift.
-- THE MONEY RULE: the gift is NOT new issuance — it pays out of the
-- existing weekly quest pool (the ≤300 VB/week envelope the four
-- weekly quests draw from, QUEST_DEFS in lib/retention), enforced
-- at claim time in lib/world-king-moment. These two tables are the
-- moment's durable state:
--   king_moments — one row per palace day the moment has fired;
--     moment_date (the UTC day) is the primary key, so the firing
--     is idempotent across restarts by construction. fired_at +
--     claim_deadline bound the claim window; payload keeps the
--     announcement the palace heard.
--   king_moment_claims — one row per member per day (unique
--     user+date: a second claim conflicts, never double-pays);
--     amount_vb is the draw on the week's quest pool.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS king_moments (
  moment_date DATE PRIMARY KEY,
  fired_at TIMESTAMPTZ NOT NULL,
  claim_deadline TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS king_moment_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  moment_date DATE NOT NULL,
  amount_vb INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT king_moment_claims_amount_check CHECK (amount_vb > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS king_moment_claims_user_date_uq
  ON king_moment_claims (user_id, moment_date);

CREATE INDEX IF NOT EXISTS king_moment_claims_date_idx
  ON king_moment_claims (moment_date);
