-- 0064: Atomic NFC tap-count increment RPC for Supabase `nfc_profiles`.
--
-- WHY: GET /api/nfc-cards/profile/:slug counted a tap read-then-write
-- (SELECT tap_count, then UPDATE tap_count = old + 1). Two concurrent
-- taps of the same card both read the same count and both write old + 1
-- — one tap is silently lost. tap_count is a vanity analytics counter
-- (no money or rank feeds from it), but the race is real. This RPC does
-- the increment atomically inside Postgres:
-- UPDATE ... SET tap_count = tap_count + 1, so the row lock serializes
-- concurrent taps and every tap lands.
--
-- Mirrors 0062's increment_credits / 0063's increment_bonus_credits
-- (same SECURITY DEFINER + grant posture). Unlike those two it takes a
-- slug (the tap destination's public key, which is what the route has)
-- and returns the single new count; a slug with no profile row returns
-- NULL instead of creating a row — a tap can never mint a profile.
--
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).
-- The api-server falls back to the legacy read-then-write if the function
-- is missing, so this is safe to deploy before running.

CREATE OR REPLACE FUNCTION increment_nfc_tap(p_slug TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  -- One statement: Postgres takes the row lock, increments and stamps
  -- updated_at atomically. Concurrent calls serialize on the row.
  UPDATE nfc_profiles
  SET tap_count = tap_count + 1,
      updated_at = now()
  WHERE slug = p_slug
  RETURNING tap_count INTO v_new;

  -- No matching row → v_new stays NULL and the caller sees NULL.
  RETURN v_new;
END;
$$;

-- Allow the service-role client (used by the api-server) to execute it.
-- SECURITY DEFINER already elevates; grant to authenticated + service_role.
GRANT EXECUTE ON FUNCTION increment_nfc_tap(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION increment_nfc_tap(TEXT) TO authenticated;
