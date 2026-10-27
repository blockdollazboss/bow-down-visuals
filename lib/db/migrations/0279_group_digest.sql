-- 9999 (PROVISIONAL — renumber at join): Per-group activity digest.
--
-- A periodic digest per group for each member: what happened in the
-- group since their last digest (posts, forum threads/replies, new
-- members, top post), delivered on the existing notifications bell
-- rail, plus email ONLY for members who opted in (group_digest_prefs
-- .email_enabled, default false).
--
-- group_digest_prefs: one row per account, the retention_prefs /
-- sound_prefs house shape — user_id is the primary key, an account
-- with no row reads as the default (enabled, weekly, bell only), and
-- the first PATCH creates the row.
--
-- group_digest_deliveries: the exactly-once ledger. UNIQUE
-- (user_id, group_id, period_end) makes a duplicate sweep a no-op;
-- period_end doubles as the member's high-water mark, so the next
-- digest aggregates everything since the last one — a quiet period
-- sends nothing and loses nothing.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS group_digest_prefs (
  user_id UUID PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'weekly',
  email_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_digest_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  channels text NOT NULL DEFAULT 'notification',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_digest_deliveries_user_group_period_uidx
  ON group_digest_deliveries (user_id, group_id, period_end);

CREATE INDEX IF NOT EXISTS group_digest_deliveries_user_idx
  ON group_digest_deliveries (user_id, period_end);
