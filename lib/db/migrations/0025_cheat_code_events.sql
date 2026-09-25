-- Cheat Code Jackpot (v1).
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- cheat_code_events: one row per 6-month jackpot cycle. The secret
-- directional sequence is NEVER stored in plaintext (the repo is public) —
-- only a SHA-256 hash of the canonical encoding is kept. All validation is
-- server-side; the public status endpoint never exposes the hash or the code.
-- cheat_code_attempts: audit + rate-limit log for jackpot attempts.
--
-- Season 1 is seeded INACTIVE: the owner activates it via
-- POST /api/cheat-code/admin/events/:id/activate when ready. No credits move
-- until activation.

CREATE TABLE IF NOT EXISTS cheat_code_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  /* SHA-256 hex of "bowdown-cheatcode-v1:" + canonical JSON of the direction
     sequence. The plaintext sequence is held by the owner only. */
  code_hash TEXT NOT NULL,
  code_length INTEGER NOT NULL,
  prize_credits INTEGER NOT NULL DEFAULT 100,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  winner_user_id UUID,
  winner_display_name TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cheat_code_events_name_ux
  ON cheat_code_events (name);

CREATE INDEX IF NOT EXISTS cheat_code_events_active_idx
  ON cheat_code_events (is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS cheat_code_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES cheat_code_events (id) ON DELETE CASCADE,
  user_id UUID,
  ip TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cheat_code_attempts_event_idx
  ON cheat_code_attempts (event_id, created_at);

CREATE INDEX IF NOT EXISTS cheat_code_attempts_user_idx
  ON cheat_code_attempts (user_id, created_at);

CREATE INDEX IF NOT EXISTS cheat_code_attempts_ip_idx
  ON cheat_code_attempts (ip, created_at);

-- Season 1 seed: starts now, runs 6 months, INACTIVE until the owner flips it
-- on. Inserted only if a Season 1 row does not already exist.
INSERT INTO cheat_code_events
  (name, code_hash, code_length, prize_credits, starts_at, ends_at, is_active)
SELECT
  'Cheat Code Jackpot — Season 1',
  'ff91cf2bc2a45704ba30e20e984ee38df373b3ea2e56d76935e0056c1d66a6f9',
  10,
  100,
  NOW(),
  NOW() + INTERVAL '6 months',
  FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM cheat_code_events
  WHERE name = 'Cheat Code Jackpot — Season 1'
);
