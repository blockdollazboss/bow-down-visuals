-- 0062: Atomic credit increment RPC for Supabase `profiles`.
--
-- WHY: the api-server's addCreditsToProfile() is read-modify-write
-- (SELECT credits, then UPDATE credits = old + n). Two concurrent grants
-- (webhook + dashboard verify racing) can both read the same balance and
-- one overwrites the other — a lost update. This RPC does the increment
-- atomically inside Postgres: UPDATE ... SET credits = credits + n.
--
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).
-- The api-server falls back to read-modify-write if the function is missing,
-- so this is safe to deploy before running.

CREATE OR REPLACE FUNCTION increment_credits(p_user_id UUID, p_amount INTEGER)
RETURNS TABLE(old_credits INTEGER, new_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old INTEGER;
  v_new INTEGER;
BEGIN
  -- Lock the row and increment atomically.
  UPDATE profiles
  SET credits = credits + p_amount
  WHERE id = p_user_id
  RETURNING credits - p_amount, credits INTO v_old, v_new;

  IF NOT FOUND THEN
    -- No profile row: create it with the granted credits (matches the
    -- previous read-modify-write fallback behavior).
    INSERT INTO profiles (id, credits) VALUES (p_user_id, p_amount)
    ON CONFLICT (id) DO UPDATE SET credits = profiles.credits + p_amount
    RETURNING 0, profiles.credits INTO v_old, v_new;
  END IF;

  RETURN QUERY SELECT v_old, v_new;
END;
$$;

-- Allow the service-role client (used by the api-server) to execute it.
-- SECURITY DEFINER already elevates; grant to authenticated + service_role.
GRANT EXECUTE ON FUNCTION increment_credits(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION increment_credits(UUID, INTEGER) TO authenticated;
