-- Cheat Code Jackpot goes monthly (2026-09-27).
--
-- The jackpot is now one event per calendar month, auto-created by the API
-- server on the first status/attempt request of each month with a fresh
-- crypto-random code (only the SHA-256 hash is stored). No DDL change is
-- needed — cheat_code_events already models arbitrary windows.
--
-- One-time transition: retire any still-active legacy (6-month) cycles so
-- the monthly event is the spotlight. History rows are kept.
--
-- NOTE: this deliberately does NOT seed or activate a monthly event.
-- Activation happens automatically via ensureCurrentMonthEvent(); the owner
-- can pause a month via POST /api/cheat-code/admin/events/:id/deactivate.

UPDATE cheat_code_events
SET is_active = false, updated_at = NOW()
WHERE is_active = true
  AND name NOT LIKE 'Cheat Code Jackpot — %';

COMMENT ON TABLE cheat_code_events IS
  'Cheat Code Jackpot: one row per calendar month (auto-created, random code hash). Legacy 6-month cycles retired 2026-09-27.';
