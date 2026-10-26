-- 9999 (PROVISIONAL — Stack-200 N18 Song Requests, Live; the integrator
-- renumbers at join time) — song request rules + the live request queue.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS song_request_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  requests_open boolean NOT NULL DEFAULT true,
  catalog_only boolean NOT NULL DEFAULT true,
  excluded_song_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_tip_vb integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS song_request_rules_creator_idx
  ON song_request_rules (creator_user_id);

CREATE TABLE IF NOT EXISTS song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  fan_user_id uuid NOT NULL,
  song_id uuid REFERENCES songs(id) ON DELETE SET NULL,
  song_title text NOT NULL,
  amount_vb integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  creator_credited_at timestamptz,
  played_at timestamptz,
  decided_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS song_requests_idempotency_idx
  ON song_requests (idempotency_key);

CREATE INDEX IF NOT EXISTS song_requests_stream_status_idx
  ON song_requests (stream_id, status, created_at);

CREATE INDEX IF NOT EXISTS song_requests_creator_idx
  ON song_requests (creator_user_id, created_at);

CREATE INDEX IF NOT EXISTS song_requests_fan_idx
  ON song_requests (fan_user_id, created_at);
