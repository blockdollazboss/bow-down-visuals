-- 9999 (PROVISIONAL number — integrator renumbers at join) Sample Clearance Lane (Stack-200 N2).
-- Creator-declared samples on their own songs: plain-words risk flags +
-- cleared-loop alternatives. Declarations are creator-stated, never
-- platform-verified. No money moves in this lane.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS sample_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_description text NOT NULL,
  use_kind text NOT NULL DEFAULT 'loop',
  clearance_status text NOT NULL DEFAULT 'unsure',
  recognizable boolean NOT NULL DEFAULT true,
  risk_acknowledged boolean NOT NULL DEFAULT false,
  risk_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sample_declarations_song_idx ON sample_declarations (song_id);
CREATE INDEX IF NOT EXISTS sample_declarations_user_idx ON sample_declarations (user_id);
