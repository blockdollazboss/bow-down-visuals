-- 0109 — Retention systems tables (Daily Drop, Creation Streaks, Shark Drops,
-- Quests, Level Celebrations, Retention Prefs, Activity Tracking).
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).

-- Creation streaks: consecutive days the user CREATED something (not just logged in).
CREATE TABLE IF NOT EXISTS creation_streaks (
  user_id uuid PRIMARY KEY,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_creation_date date,
  milestones_claimed integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Shark drops: surprise Visual Bucs. Unclaimed drops expire after 48h.
CREATE TABLE IF NOT EXISTS shark_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  dropped_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours'
);
CREATE INDEX IF NOT EXISTS shark_drops_user_idx ON shark_drops (user_id);
CREATE INDEX IF NOT EXISTS shark_drops_unclaimed_idx ON shark_drops (user_id)
  WHERE claimed_at IS NULL;

-- Quest progress: weekly quests per user.
CREATE TABLE IF NOT EXISTS quest_progress (
  user_id uuid NOT NULL,
  quest_key text NOT NULL,
  week_start date NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  target integer NOT NULL DEFAULT 1,
  completed boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_key, week_start)
);
CREATE INDEX IF NOT EXISTS quest_progress_week_idx ON quest_progress (week_start);

-- Level celebrations: tracks which creator levels were already celebrated
-- (so the celebration modal fires exactly once per level-up).
CREATE TABLE IF NOT EXISTS level_celebrations (
  user_id uuid NOT NULL,
  level integer NOT NULL,
  celebrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, level)
);

-- Retention prefs: user-facing on/off for every retention system.
-- All default ON except where noted; every system must respect these.
CREATE TABLE IF NOT EXISTS retention_prefs (
  user_id uuid PRIMARY KEY,
  daily_drop_enabled boolean NOT NULL DEFAULT true,
  creation_streaks_enabled boolean NOT NULL DEFAULT true,
  shark_drops_enabled boolean NOT NULL DEFAULT true,
  level_celebrations_enabled boolean NOT NULL DEFAULT true,
  leaderboard_visible boolean NOT NULL DEFAULT true,
  away_digest_enabled boolean NOT NULL DEFAULT true,
  quests_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- User activity: last-seen tracking for "while you were away" digests.
CREATE TABLE IF NOT EXISTS user_activity (
  user_id uuid PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
