-- 0179: The World's two locks (Cloud Operator Phase 2 — Lane F).
-- (The owner ruled Oct 20, 2026: "lock" = BOTH kinds — a person
-- locked out of a room for a time, and a room's door locked so
-- nobody new enters. Thy Cheat Code works both ONLY on an admin
-- account's command, through the executor's Tier-4 gate; he never
-- locks on his own judgment.)
--
-- world_person_locks: one live row per (room, member) — the
-- durable truth the World join path enforces. A rejoin, a
-- reconnect, or a restart never sheds a lock; it ends when
-- expires_at passes or an admin lifts the row early. Re-locking
-- replaces the row (the write path deletes then inserts), so the
-- newest command is the standing one.
--   room_id          the palace room id (e.g. 'world:kings-hall',
--                    'world:music-hall', 'creator:<slug>').
--   user_id          the locked member's account.
--   display_name     their name when the lock landed (the unlock
--                    command resolves by it while they're absent).
--   locked_by_*      the admin whose command landed the lock.
--   expires_at       when the lock lifts on its own.
--
-- world_door_locks: one row per locked room, keyed by room id.
-- People inside stay; nobody new joins; the only bypass is an
-- admin account. No duration — an admin unlocks it.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS world_person_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  locked_by_user_id UUID NOT NULL,
  locked_by_email TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS world_person_locks_room_user_idx
  ON world_person_locks (room_id, user_id);
CREATE INDEX IF NOT EXISTS world_person_locks_expires_idx
  ON world_person_locks (expires_at);

CREATE TABLE IF NOT EXISTS world_door_locks (
  room_id TEXT PRIMARY KEY,
  locked_by_user_id UUID NOT NULL,
  locked_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
