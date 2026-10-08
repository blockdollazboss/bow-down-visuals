-- 0101 — Waitlist invite mechanics (virality wave worker 4).
-- Personal invite codes per waitlisted user, queue-jump tracking, milestone
-- flags, and an invite-attribution table. All DDL is idempotent; the API
-- route also self-heals with CREATE TABLE / ADD COLUMN IF NOT EXISTS at boot.

-- New columns on the existing waitlist table (created in supabase/setup.sql)
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invited_by_email TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invites_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS jump_spots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS early_access_unlocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS launch_bonus_bucs INTEGER NOT NULL DEFAULT 0;

-- Unique invite codes (NULLs allowed; unique index ignores NULL rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'waitlist_invite_code_uidx'
  ) THEN
    CREATE UNIQUE INDEX waitlist_invite_code_uidx ON waitlist (invite_code);
  END IF;
END $$;

-- Invite attribution: one row per successful invite.
-- UNIQUE(invitee_email) makes attribution idempotent — a retry or a later
-- signup can never double-credit the inviter.
CREATE TABLE IF NOT EXISTS waitlist_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_email TEXT NOT NULL,
  invitee_email TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_invites_inviter_idx ON waitlist_invites (inviter_email);
