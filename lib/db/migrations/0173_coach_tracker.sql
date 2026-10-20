-- 0173: Coach action tracker (Stack-3 coach full-page depth).
-- The Monetization Coach (/coach) could build a money plan, but its
-- money moves lived only in the response — reload and they were gone,
-- and nothing on the page could be checked off or measured over time.
-- Two small per-user tables close that:
--   coach_action_items — checkable action items saved from a plan
--     (source 'plan'), a niche analysis ('niche'), or typed in by hand
--     ('custom'). completed_at stamps the check-off moment.
--   coach_goals — one row per user holding the typed monthly income
--     goal (cents) that the coach plan-numbers math measures the
--     creator's real ledger run-rate against. No row / NULL = unset.
-- Owner-scoped by user_id on every access (routes/coach-tracker.ts).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS coach_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('plan', 'niche', 'custom')),
  done BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_action_items_user_idx ON coach_action_items (user_id, done, sort_order, created_at);

CREATE TABLE IF NOT EXISTS coach_goals (
  user_id UUID PRIMARY KEY,
  monthly_goal_cents INTEGER CHECK (monthly_goal_cents IS NULL OR monthly_goal_cents > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
