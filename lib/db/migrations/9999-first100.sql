-- 9999-first100 (PROVISIONAL — renumber at join): First 100 Fans
-- program state (Stack-200 List 2 #155).
--
-- One row per creator: the milestones the house has already
-- celebrated with them (recognition fires exactly once per
-- milestone) and their dismissal/snooze state (smart law — the
-- path never nags). The fan count itself is NEVER stored: it is
-- derived live from the real `follows` rows on every read, so this
-- table cannot drift from the truth.
--
-- No charges, no Visual Bucs, no prices. Recognition rides the
-- existing notifications table (kind 'first100_milestone').
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS first100_state (
  user_id uuid PRIMARY KEY,
  celebrated_milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  dismissed_at timestamptz,
  snooze_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
