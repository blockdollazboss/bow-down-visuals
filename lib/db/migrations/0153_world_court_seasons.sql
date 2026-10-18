-- 0153: Court seasons (World / THE-GAME Ring 4 — "Court seasons:
-- named seasons with a settling ceremony and a season marks wall").
-- A court season is one UTC calendar month on the palace calendar,
-- derived deterministically in lib/world-court-season (Season I =
-- October 2026, the month the palace game layer opened). During a
-- season, court standing accumulates from the earned-rank ladder's
-- own business sources (lib/creator-rank's countRankSources),
-- windowed to the season's span — the ladder itself is never
-- forked. At the season's turn, the SETTLING freezes the final
-- standings into this table and heralds the court through the
-- palace announce channel (Ring 3). The Season Marks Wall in the
-- Royal Court Chamber reads these frozen rows — past seasons'
-- standings as collectible marks, public to everyone, guests
-- included (standings are public spectacle; no VB moves — marks
-- are honor, not money).
--   court_season_settlements — one row per settled season;
--     season_key ("2026-10") is the primary key, so the settling
--     is idempotent across restarts and twin ticks by
--     construction: a re-run inserts nothing and heralds nothing.
--     standings keeps the frozen top of the court (place, creator,
--     season points, and the earned rank they held at the turn);
--     herald_text keeps the announcement the palace heard.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS court_season_settlements (
  season_key TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  standings JSONB NOT NULL DEFAULT '[]'::jsonb,
  herald_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS court_season_settlements_ordinal_idx
  ON court_season_settlements (ordinal);
