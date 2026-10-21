-- 0083: Team Seats (DistroKid-style team roles per account).
-- Owner / Manager / Collaborator / Viewer seats on an account's artist profile,
-- with a permission matrix (credits, publishing, money, profile editing).
-- Invites are link-based: no email provider is configured, so the invite link
-- is shown to the inviter to copy manually. The seat activates when the
-- invited email's signed-in account accepts the link (matched on auth email).
-- All statements idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS team_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'collaborator',
  status TEXT NOT NULL DEFAULT 'invited',
  invite_token TEXT UNIQUE,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (owner_id, email)
);
CREATE INDEX IF NOT EXISTS team_seats_owner_id_idx ON team_seats (owner_id);
CREATE INDEX IF NOT EXISTS team_seats_email_idx ON team_seats (email);
CREATE INDEX IF NOT EXISTS team_seats_invite_token_idx ON team_seats (invite_token);
