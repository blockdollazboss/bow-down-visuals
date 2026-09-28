-- 0047: Team workspaces (Shot Caller tier).
-- Teams have a shared credit pool; members spend from it via chargeCredits().
-- Artist vaults can be shared with a team via artist_vaults.team_id.

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  owner_id UUID NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  UNIQUE (team_id, email)
);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members (team_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);

ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS team_id UUID;
CREATE INDEX IF NOT EXISTS credit_usage_team_id_idx ON credit_usage (team_id);

ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS team_id UUID;
CREATE INDEX IF NOT EXISTS artist_vaults_team_id_idx ON artist_vaults (team_id);
