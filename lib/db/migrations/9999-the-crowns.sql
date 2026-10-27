-- 9999 (provisional): The Crowns — N8 yearly house awards, an
-- UPGRADE of the court seasons (0153). Where a court season
-- settles one month of World standing, The Crowns roll up a whole
-- UTC calendar year of platform records — lib/creator-rank's own
-- sources windowed to the year (the ladder is never forked) — and
-- freeze the winners of the published award categories at the
-- year's turn. Winners wear a crown on their profiles for the
-- year after the win. Real numbers decide: no votes, no
-- estimates. Idempotency is structural: year is the primary key,
-- the insert is on-conflict-do-nothing, and the deciding herald
-- fires only for the tick that inserted the row. Crowns are
-- honor, not money: no VB moves.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS house_crown_years (
  year INTEGER PRIMARY KEY,
  crown_key TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  awards JSONB NOT NULL DEFAULT '[]'::jsonb,
  herald_text TEXT NOT NULL DEFAULT ''
);
