-- 0061: Waitlist invite tables on Supabase.
--
-- WHY THIS EXISTS: these tables were defined in lib/db/migrations/
-- (0103_waitlist_invites.sql), which the boot-time runner applies against
-- DATABASE_URL (Render Postgres in production). That is a DIFFERENT
-- database from the Supabase project that the API actually queries via
-- getSupabaseAdmin() (SUPABASE_URL) — see artifacts/api-server/src/routes/waitlist.ts.
-- The Render-side migration can therefore never create these tables where
-- the routes look for them, and waitlist endpoints 500 with
-- "relation does not exist".
-- Run this file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: every statement uses IF NOT EXISTS.
-- Run order: after 0059, 0060 (order between files does not matter, there
-- are no cross-file dependencies).
-- Mirrors the pattern documented in 0054_bonus_columns.sql.
--
-- NOTE: this file creates waitlist_invites (the invite-attribution table).
-- It also defensively creates the companion `waitlist` table from 0103 —
-- waitlist.ts queries BOTH tables via Supabase, so a missing `waitlist`
-- table would 500 the same endpoints. This is NOT the same as creating it
-- twice: setup.sql's `waitlist` shape is the base this mirrors.

-- waitlist: base signup table + invite-mechanic columns (0103).
-- On Supabase projects where setup.sql was never run, the table may not
-- exist yet — create it first so the ALTERs below don't fail.
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  artist_type text,
  want_to_create text,
  social_handle text,
  message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invited_by_email TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invites_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS jump_spots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS early_access_unlocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS launch_bonus_bucs INTEGER NOT NULL DEFAULT 0;

-- Unique invite codes (NULLs allowed; unique index ignores NULL rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'waitlist_invite_code_uidx'
  ) THEN
    CREATE UNIQUE INDEX waitlist_invite_code_uidx ON waitlist (invite_code);
  END IF;
END $$;

-- waitlist_invites: invite attribution — one row per successful invite.
-- UNIQUE(invitee_email) makes attribution idempotent: a retry or a later
-- signup can never double-credit the inviter (0103).
CREATE TABLE IF NOT EXISTS waitlist_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_email TEXT NOT NULL,
  invitee_email TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_invites_inviter_idx ON waitlist_invites (inviter_email);
