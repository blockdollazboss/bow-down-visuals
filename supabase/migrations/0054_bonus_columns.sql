-- 0054: Bonus / jackpot-wheel columns on the Supabase `profiles` table.
--
-- WHY THIS EXISTS: the API's runtime `ensureBonusColumns()` runs its ALTER
-- against DATABASE_URL (Render Postgres in production), which is a DIFFERENT
-- database from the Supabase project that serves `profiles`. The runtime
-- ALTER can therefore never create these columns in production. Run this
-- file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: every statement uses IF NOT EXISTS.

alter table profiles add column if not exists bonus_credits integer not null default 0;
alter table profiles add column if not exists bonus_credits_expires_at timestamptz null;
alter table profiles add column if not exists daily_streak integer not null default 0;
alter table profiles add column if not exists last_daily_claim date null;
alter table profiles add column if not exists last_wheel_spin timestamptz null;

create table if not exists wheel_spins (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  spun_at       timestamptz not null default now(),
  prize_credits integer     not null,
  was_jackpot   boolean     not null default false
);
create index if not exists idx_wheel_spins_user on wheel_spins(user_id);
