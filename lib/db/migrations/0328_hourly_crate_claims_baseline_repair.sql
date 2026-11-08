-- 0328: hourly_crate_claims — BASELINE REPAIR (Stack 400, item C-39).
--
-- WHY THIS FILE EXISTS: the table's creating migration is 0055
-- (0055_hourly_crate_global.sql), which sits AT the boot runner's
-- BASELINE (lib/db/migrate-boot.mjs: migrations numbered <= 55 are
-- skipped on any database that already carries the credit_usage
-- canary, on the assumption they were applied manually pre-runner).
-- The staging database carries the canary but was never given the
-- manual 0055 application, so the runner skips 0055 on every boot
-- forever while live code errors on every crate read/write
-- ("relation hourly_crate_claims does not exist" in the deploy logs):
-- lib/bonus.ts (insert/select/delete), lib/retention.ts, and
-- routes/activity-feed.ts all read this table through
-- hourlyCrateClaimsTable (lib/db/src/schema/hourly-crate-claims.ts —
-- unchanged; the TS schema was already in sync).
--
-- THE REPAIR: re-issue 0055's CREATE TABLE IF NOT EXISTS VERBATIM in
-- a file numbered ABOVE the baseline — files above the baseline
-- always run, and IF NOT EXISTS makes this a no-op on any database
-- where the table genuinely exists (including fresh databases, which
-- run 0055 itself). 0055 is never edited (applied-migration files
-- are immutable). The boot runner's new baseline-table assertion
-- (also C-39) now fails loudly if any other code-referenced baseline
-- table is missing, so the next gap of this shape is caught by the
-- boot log instead of scrolling past unnoticed. Idempotent: safe to
-- re-run, and written without explicit transaction control.

-- >>> re-issued verbatim from 0055_hourly_crate_global.sql >>>
CREATE TABLE IF NOT EXISTS hourly_crate_claims (
  hour_slot TEXT PRIMARY KEY,  -- e.g. "2026-10-04T00" (UTC hour)
  claimed_by UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prize_credits INTEGER NOT NULL
);

COMMENT ON TABLE hourly_crate_claims IS
  'Global hourly crate: one claim per hour site-wide, first come first served.';
-- <<< re-issued verbatim from 0055_hourly_crate_global.sql <<<
