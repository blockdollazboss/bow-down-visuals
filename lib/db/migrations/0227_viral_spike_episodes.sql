-- 0227: Viral Spike Watch (Stack-100 #3, Wave 3, lane 11 — numbered
-- at the join): episode state for baseline-relative play spikes over
-- play_events. One row per item that has ever spiked; 'active' mutes
-- re-alerts for the episode, 'rearmed' (metric fell back near
-- baseline) lets a fresh spike alert once more.
CREATE TABLE IF NOT EXISTS viral_spike_episodes (
  kind text NOT NULL,
  media_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  episode_state text NOT NULL DEFAULT 'active',
  baseline_daily double precision NOT NULL DEFAULT 0,
  last_current_plays integer NOT NULL DEFAULT 0,
  notified_at timestamptz,
  rearmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, media_id),
  CONSTRAINT viral_spike_episodes_kind_check CHECK (kind IN ('track','video')),
  CONSTRAINT viral_spike_episodes_state_check CHECK (episode_state IN ('active','rearmed'))
);
CREATE INDEX IF NOT EXISTS viral_spike_episodes_state_idx ON viral_spike_episodes (episode_state);
CREATE INDEX IF NOT EXISTS viral_spike_episodes_owner_idx ON viral_spike_episodes (owner_user_id);
