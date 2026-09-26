-- 0039_global_bow_race.sql
-- Global Bow Race: REPLACES the per-user secret bow challenge (0038).
-- Every signed-in user's bows feed ONE site-wide monthly counter
-- (bow_race_months). Each calendar month draws a random target of
-- 1000-5000 bows on its first recorded bow. Whoever's bow lands exactly
-- on the target wins the credit reward (default 50). Exactly one winner
-- per month; the counter freezes once the race is won. A new month
-- automatically starts a new race — no cron, no manual step.
-- The race is NEVER announced in the UI: only the winner's own client
-- learns it won (via the /api/bow response), and only /admin sees the
-- counter, target, and winner.
-- The old user_bow_counts table is SUPERSEDED (kept for history, no
-- longer written). bow_challenge_config keeps reward_credits + enabled,
-- gains a one-shot target_override, and target_bows is retired.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS bow_race_months (
  period TEXT PRIMARY KEY, -- YYYY-MM, e.g. '2026-10'
  target INTEGER NOT NULL, -- 1000..5000, drawn randomly at month start
  total_bows INTEGER NOT NULL DEFAULT 0,
  winner_user_id UUID NULL,
  winner_email TEXT NULL,
  won_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bow_race_months_winner_idx
  ON bow_race_months (winner_user_id) WHERE winner_user_id IS NOT NULL;

-- One-shot admin target override for the next race month.
-- NULL (default) = random 1000-5000. Consumed (reset to NULL) when the
-- next month's row is created.
ALTER TABLE bow_challenge_config
  ADD COLUMN IF NOT EXISTS target_override INTEGER NULL;

-- Global race reward default: 50 credits.
ALTER TABLE bow_challenge_config
  ALTER COLUMN reward_credits SET DEFAULT 50;

UPDATE bow_challenge_config
  SET reward_credits = 50, updated_at = now()
  WHERE id = 1 AND reward_credits = 5;

-- Atomic bow recorder. Takes a row lock on the month so concurrent bows
-- serialize: exactly one transaction can move the counter onto the target
-- and claim the win. Returns (new total, target, won?, race over?).
CREATE OR REPLACE FUNCTION bow_race_record(
  p_user_id UUID,
  p_period TEXT,
  p_override_target INT
)
RETURNS TABLE (o_total INT, o_target INT, o_won BOOLEAN, o_race_over BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  r bow_race_months%ROWTYPE;
  v_target INT;
BEGIN
  -- Lock the month row, creating it (with the drawn target) if needed.
  LOOP
    SELECT * INTO r FROM bow_race_months WHERE period = p_period FOR UPDATE;
    IF FOUND THEN EXIT; END IF;
    v_target := p_override_target;
    IF v_target IS NULL THEN
      v_target := 1000 + floor(random() * 4001)::INT; -- 1000..5000 inclusive
    END IF;
    BEGIN
      INSERT INTO bow_race_months(period, target) VALUES (p_period, v_target);
      -- One-shot override is consumed by the month it created.
      IF p_override_target IS NOT NULL THEN
        UPDATE bow_challenge_config SET target_override = NULL, updated_at = now()
          WHERE id = 1;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Another transaction created the row first; loop back and lock it.
    END;
  END LOOP;

  -- Race already decided: freeze the counter, stay silent.
  IF r.winner_user_id IS NOT NULL THEN
    RETURN QUERY SELECT r.total_bows, r.target, FALSE, TRUE;
    RETURN;
  END IF;

  UPDATE bow_race_months
     SET total_bows = total_bows + 1
   WHERE period = p_period
  RETURNING total_bows INTO r.total_bows;

  -- The bow that lands exactly on the target wins — exactly once.
  IF r.total_bows = r.target THEN
    UPDATE bow_race_months
       SET winner_user_id = p_user_id, won_at = now()
     WHERE period = p_period AND winner_user_id IS NULL;
    IF FOUND THEN
      RETURN QUERY SELECT r.total_bows, r.target, TRUE, TRUE;
      RETURN;
    END IF;
    SELECT * INTO r FROM bow_race_months WHERE period = p_period; -- re-read (still locked)
  END IF;

  RETURN QUERY SELECT r.total_bows, r.target, FALSE, (r.winner_user_id IS NOT NULL);
END;
$$;

-- Atomic rollback for a failed payout: reopens the race one bow back so
-- a later bow can still land exactly on the target and win.
CREATE OR REPLACE FUNCTION bow_race_undo_win(p_period TEXT, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE bow_race_months
     SET winner_user_id = NULL,
         winner_email = NULL,
         won_at = NULL,
         total_bows = GREATEST(total_bows - 1, 0)
   WHERE period = p_period
     AND winner_user_id = p_user_id;
END;
$$;
