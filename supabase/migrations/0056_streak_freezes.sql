-- 0056: Streak-freeze tokens for the daily login streak (login streaks with teeth).
--
-- streak_freezes: non-VB tokens on the Supabase `profiles` table.
-- Earned: +1 at every 7-day daily-login milestone claim.
-- Consumed: auto-consumed (exactly 1) when the user misses exactly one day,
-- preserving the streak instead of resetting it. Never pays Visual Bucs.
--
-- WHY THIS EXISTS: the API's runtime `ensureBonusColumns()` in
-- artifacts/api-server/src/lib/bonus.ts runs its ALTER against DATABASE_URL
-- (Render Postgres in production), which is a DIFFERENT database from the
-- Supabase project that serves `profiles`. The runtime ALTER can therefore
-- never create this column in production. Run this file ONCE in the
-- Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: uses IF NOT EXISTS.

alter table profiles add column if not exists streak_freezes integer not null default 0;
