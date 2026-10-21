-- 0060: Global Bow Race tables + RPCs on Supabase.
--
-- WHY THIS EXISTS: these objects were defined in lib/db/migrations/
-- (0038_secret_bow_challenge.sql, 0040_global_bow_race.sql), which the
-- boot-time runner applies against DATABASE_URL (Render Postgres in
-- production). That is a DIFFERENT database from the Supabase project that
-- the API actually queries via getSupabaseAdmin() (SUPABASE_URL) — see
-- artifacts/api-server/src/routes/bow-challenge.ts, which calls
-- bow_challenge_config / bow_race_months and the bow_race_record /
-- bow_race_undo_win RPCs through Supabase. The Render-side migrations can
-- therefore never create these objects where the routes look for them, and
-- every bow endpoint 500s with "relation does not exist" (tables) or
-- "function does not exist" (RPCs).
-- Run this file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.
-- Run order: after 0059 (order between files does not matter, there are no
-- cross-file dependencies).
-- Mirrors the pattern documented in 0054_bonus_columns.sql.

-- bow_challenge_config: singleton admin config (0038), plus the 0040
-- additions (target_override column, reward_credits default 50).
CREATE TABLE IF NOT EXISTS bow_challenge_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target_bows INTEGER NOT NULL DEFAULT 100,
  reward_credits INTEGER NOT NULL DEFAULT 50,
  enabled BOOLEAN NOT NULL DEFAULT true,
  target_override INTEGER NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- In case this table already exists in the older 0038 shape.
ALTER TABLE bow_challenge_config
  ADD COLUMN IF NOT EXISTS target_override INTEGER NULL;

INSERT INTO bow_challenge_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- bow_race_months: the site-wide monthly counter (0040). One row per
-- calendar month (period = YYYY-MM). Exactly one winner per month; the
-- counter freezes once the race is won.
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

-- bow_race_record: atomic bow recorder (0040). Takes a row lock on the
-- month so concurrent bows serialize: exactly one transaction can move the
-- counter onto the target and claim the win.
-- Returns (new total, target, won?, race over?).
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

-- bow_race_undo_win: atomic rollback for a failed payout (0040). Reopens
-- the race one bow back so a later bow can still land exactly on the target.
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
