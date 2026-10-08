-- 0106 — Wave 8 tables (content calendar, royalty splits, sponsor pipeline, merch drops).
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).

-- Content Calendar auto-fill week slots (Wave 8, feature 3).
CREATE TABLE IF NOT EXISTS wave8_calendar_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  day_index integer NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  post_type text NOT NULL DEFAULT 'post',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave8_calendar_slots_user_week_idx
  ON wave8_calendar_slots (user_id, week_start);

-- Royalty split sheets (Wave 8, feature 9). collaborators is a JSON array of
-- { name, role, pct } objects; pct values are whole percentages (0-100).
CREATE TABLE IF NOT EXISTS wave8_royalty_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  song_title text NOT NULL DEFAULT '',
  collaborators jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave8_royalty_splits_user_idx
  ON wave8_royalty_splits (user_id);

-- Sponsor deal pipeline (Wave 8, feature 10).
-- stage: pitched | negotiating | closed | paid
CREATE TABLE IF NOT EXISTS wave8_sponsor_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sponsor_name text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'pitched',
  deal_value_cents integer NOT NULL DEFAULT 0,
  contact text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  last_followup_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave8_sponsor_deals_user_stage_idx
  ON wave8_sponsor_deals (user_id, stage);

-- Merch drop plans (Wave 8, feature 7). concepts and launch_posts are JSON arrays.
CREATE TABLE IF NOT EXISTS wave8_merch_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_name text NOT NULL DEFAULT '',
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  launch_posts jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wave8_merch_drops_user_idx
  ON wave8_merch_drops (user_id);
