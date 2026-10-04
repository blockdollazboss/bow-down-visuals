-- 0055: Global hourly crate — one claim per hour across the entire site.
-- First come, first served. Once claimed, it's gone until the next hour.

CREATE TABLE IF NOT EXISTS hourly_crate_claims (
  hour_slot TEXT PRIMARY KEY,  -- e.g. "2026-10-04T00" (UTC hour)
  claimed_by UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prize_credits INTEGER NOT NULL
);

COMMENT ON TABLE hourly_crate_claims IS
  'Global hourly crate: one claim per hour site-wide, first come first served.';
