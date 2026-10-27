-- PROVISIONAL (orphan-wave lane): renumber at join time.
-- Viral-spike response kit: prefs (on/off), view-counter snapshots
-- (the honest velocity history), and fired-kit alerts (cooldown + history).
-- Idempotent; no BEGIN/COMMIT (boot migrator wraps application).

CREATE TABLE IF NOT EXISTS viral_spike_prefs (
  user_id    uuid PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS viral_spike_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  content_kind text NOT NULL,
  content_id  uuid NOT NULL,
  views       integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viral_spike_snapshots_content_idx
  ON viral_spike_snapshots (user_id, content_kind, content_id, recorded_at);

CREATE TABLE IF NOT EXISTS viral_spike_alerts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL,
  content_kind              text NOT NULL,
  content_id                uuid NOT NULL,
  title                     text NOT NULL DEFAULT '',
  basis                     text NOT NULL,
  recent_gain               integer NOT NULL,
  recent_velocity_per_hour  double precision NOT NULL,
  baseline_velocity_per_hour double precision,
  multiplier                double precision,
  detected_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viral_spike_alerts_user_idx
  ON viral_spike_alerts (user_id, detected_at);
CREATE INDEX IF NOT EXISTS viral_spike_alerts_content_idx
  ON viral_spike_alerts (user_id, content_kind, content_id, detected_at);
