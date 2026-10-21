-- 0063: Atomic bonus-credit increment RPC for Supabase `profiles`.
--
-- WHY: the api-server's addBonusCredits() is read-modify-write
-- (SELECT bonus_credits, then UPDATE bonus_credits = old + n). Two
-- concurrent grants (daily claim + hourly crate win landing in the same
-- instant) can both read the same balance and one overwrites the other
-- — a lost update (the user is underpaid; it can never double-pay).
-- This RPC does the increment atomically inside Postgres:
-- UPDATE ... SET bonus_credits = bonus_credits + n, refreshing
-- bonus_credits_expires_at in the same statement. The caller passes the
-- new expiry, so the 48h-from-grant policy stays in code.
--
-- Mirrors 0062's increment_credits (same parameter/return conventions,
-- same SECURITY DEFINER + grant posture).
--
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).
-- The api-server falls back to read-modify-write if the function is missing,
-- so this is safe to deploy before running.

CREATE OR REPLACE FUNCTION increment_bonus_credits(p_user_id UUID, p_amount INTEGER, p_expires_at TIMESTAMPTZ)
RETURNS TABLE(old_bonus_credits INTEGER, new_bonus_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old INTEGER;
  v_new INTEGER;
BEGIN
  -- Lock the row, increment and refresh expiry atomically.
  UPDATE profiles
  SET bonus_credits = bonus_credits + p_amount,
      bonus_credits_expires_at = p_expires_at
  WHERE id = p_user_id
  RETURNING bonus_credits - p_amount, bonus_credits INTO v_old, v_new;

  IF NOT FOUND THEN
    -- No profile row: create it carrying the granted bonus credits
    -- (0062's increment_credits sets this precedent). The old
    -- read-modify-write UPDATE silently matched zero rows here, so a
    -- grant to a brand-new user vanished instead of landing.
    INSERT INTO profiles (id, bonus_credits, bonus_credits_expires_at)
    VALUES (p_user_id, p_amount, p_expires_at)
    ON CONFLICT (id) DO UPDATE
      SET bonus_credits = profiles.bonus_credits + p_amount,
          bonus_credits_expires_at = p_expires_at
    RETURNING 0, profiles.bonus_credits INTO v_old, v_new;
  END IF;

  RETURN QUERY SELECT v_old, v_new;
END;
$$;

-- Allow the service-role client (used by the api-server) to execute it.
-- SECURITY DEFINER already elevates; grant to authenticated + service_role.
GRANT EXECUTE ON FUNCTION increment_bonus_credits(UUID, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION increment_bonus_credits(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;
