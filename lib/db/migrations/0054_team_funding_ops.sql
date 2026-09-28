-- 0054: Team funding saga state machine + one-active-team enforcement.
-- NOTE: deploys apply schema via `drizzle-kit push` from the TypeScript
-- schema (lib/db/src/schema/teams.ts); this file is the human-readable
-- record of the intent. The statements below are idempotent.

-- Durable funding-operation log for the cross-database funding saga
-- (Supabase personal balance -> Render Postgres team pool). See
-- teamFundingOpsTable in lib/db/src/schema/teams.ts for the state machine.
CREATE TABLE IF NOT EXISTS team_funding_ops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'started',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_funding_ops_team_key_uidx
  ON team_funding_ops (team_id, idempotency_key);
CREATE INDEX IF NOT EXISTS team_funding_ops_stuck_idx
  ON team_funding_ops (status, updated_at);

-- V1: one active team per user, enforced at the database level so concurrent
-- invite acceptances cannot create two active memberships. Partial index:
-- pending invites (user_id IS NULL) are unaffected.
-- If this fails on existing data, some user already has two active
-- memberships — resolve the duplicates first, then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_active_per_user_uidx
  ON team_members (user_id) WHERE status = 'active';
