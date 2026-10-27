-- 9999 (PROVISIONAL — renumber at join time; next free after 0244):
-- schema-drift repair for tables the boot runner can never create.
--
-- Root cause: migrate-boot skips every file numbered <= BASELINE (55)
-- on any database that already has the credit_usage canary, on the
-- assumption those files were applied manually in the pre-runner era.
-- Two table sets were only ever written down inside that skipped
-- range (or only inside a runtime self-heal), so a production database
-- where the manual run never landed drifts forever — production logs
-- 2026-10-25 show `relation "contest_entries" does not exist` and
-- `relation "profiles" does not exist` at request time. This file
-- writes the Render-side tables down in the runner chain, the same
-- repair 0120/0122 made for the push-era billing/creator tables.
--
--   * contests / contest_entries — verbatim from
--     0024_fan_contests.sql, mirroring lib/db/src/schema/contests.ts.
--     Queried via Drizzle by routes/generate/contests.ts and
--     routes/activity-feed.ts, both of which 500'd on the missing
--     relation.
--   * wheel_spins — verbatim from the CREATE the old bonus.ts
--     ensureBonusColumns() bundled into its (wrong-database) ALTER
--     batch against Supabase `profiles`; the batch aborted on the
--     missing `profiles` relation, so this Render-side table was never
--     created either. bonus.ts now defers to this migration (the
--     Supabase-side bonus columns stay owned by
--     supabase/migrations/0054 + 0056 — there is deliberately NO
--     `profiles` table here: profiles is Supabase's, and Render code
--     reads it through the service-role client, see credits.ts).
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS throughout — a no-op
-- on databases that already have these tables. No BEGIN/COMMIT (the
-- runner wraps), no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  entry_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  winner_entry_id UUID,
  draw_audit JSONB,
  announcement_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contests_user_id_idx
  ON contests (user_id);

CREATE TABLE IF NOT EXISTS contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID NOT NULL,
  handle TEXT NOT NULL,
  email TEXT,
  entry_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contest_entries_contest_id_idx
  ON contest_entries (contest_id);

CREATE INDEX IF NOT EXISTS contest_entries_handle_idx
  ON contest_entries (handle);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  spun_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prize_credits INTEGER NOT NULL,
  was_jackpot BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_wheel_spins_user ON wheel_spins(user_id);
