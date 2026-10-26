-- 9999-results-wall.sql — PROVISIONAL (Stack-200 lane stack200/rem-results-wall;
-- number assigned at join). Public Results Wall (dedupe audit #177):
-- opt-in prefs + platform-verified milestone events. Idempotent.
-- Events are written ONLY by the server derivation scan from platform
-- records (digital_sales / follows / credit_usage / play_events chart);
-- there is no user-input insert path.

CREATE TABLE IF NOT EXISTS results_wall_prefs (
  user_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL DEFAULT false,
  hidden_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS results_wall_prefs_profile_idx ON results_wall_prefs (profile_id);

CREATE TABLE IF NOT EXISTS results_wall_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('first_sale', 'sales', 'followers', 'vb_earned', 'chart_placement')),
  threshold integer NOT NULL,
  value integer NOT NULL,
  detail jsonb NOT NULL DEFAULT '{"source":"follows"}'::jsonb,
  occurred_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS results_wall_events_unique_idx
  ON results_wall_events (profile_id, kind, threshold);
CREATE INDEX IF NOT EXISTS results_wall_events_wall_idx ON results_wall_events (occurred_at);
CREATE INDEX IF NOT EXISTS results_wall_events_profile_idx ON results_wall_events (profile_id, occurred_at);
