-- 9999 (PROVISIONAL — Stack-200 N10 Local Scenes lane; the integrator
-- renumbers on join): the creator's DECLARED city.
--
-- Local Scenes builds a city page ONLY from what creators declared
-- themselves: creator_profiles.declared_city is free text the creator
-- typed in profile setup (e.g. "New York" or "New York, NY"). NULL /
-- blank = the creator declared no city and appears on NO scene page.
-- Nothing ever geocodes, infers, or backfills this column — a city
-- with no declared-location creators gets no scene page at all.
--
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house migration rules).

ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS declared_city text;

CREATE INDEX IF NOT EXISTS creator_profiles_declared_city_idx
  ON creator_profiles (declared_city)
  WHERE declared_city IS NOT NULL;
