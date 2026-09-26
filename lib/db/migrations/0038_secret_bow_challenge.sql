-- 0038_secret_bow_challenge.sql
-- Secret Bow Challenge: a hidden milestone. Users bow the shark for fun,
-- unaware that reaching the target bow count awards credits. The challenge
-- is NEVER announced in the UI — only the admin panel controls it.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS bow_challenge_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target_bows INTEGER NOT NULL DEFAULT 100,
  reward_credits INTEGER NOT NULL DEFAULT 5,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bow_challenge_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_bow_counts (
  user_id UUID PRIMARY KEY,
  bow_count INTEGER NOT NULL DEFAULT 0,
  rewarded BOOLEAN NOT NULL DEFAULT false,
  last_bow_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_bow_counts_count_idx
  ON user_bow_counts (bow_count DESC);
