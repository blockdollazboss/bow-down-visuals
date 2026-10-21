-- 0139: Stack 11 "Distribution & Legacy" (in-house half) — release landing
-- content (smartlink persistence), real account pre-save records, lyrics
-- packages, takedown/edit requests, permanence elections, label roster,
-- generalized social-unlock gates.
-- Idempotent: safe to re-run as a no-op. Schema: lib/db/src/schema/distribution-legacy.ts
-- No money movement anywhere in this migration's tables.

CREATE TABLE IF NOT EXISTS release_landing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL,
  user_id UUID NOT NULL,
  video_url TEXT,
  store_url TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS release_landing_content_release_uidx ON release_landing_content (release_id);
CREATE INDEX IF NOT EXISTS release_landing_content_user_idx ON release_landing_content (user_id);

CREATE TABLE IF NOT EXISTS presave_account_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'spotify',
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS presave_account_actions_uidx ON presave_account_actions (release_id, user_id, platform);
CREATE INDEX IF NOT EXISTS presave_account_actions_release_idx ON presave_account_actions (release_id);

CREATE TABLE IF NOT EXISTS release_lyrics_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL,
  user_id UUID NOT NULL,
  lyrics TEXT NOT NULL DEFAULT '',
  timed_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS release_lyrics_packages_release_uidx ON release_lyrics_packages (release_id);

CREATE TABLE IF NOT EXISTS release_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS release_change_requests_release_idx ON release_change_requests (release_id, created_at);
CREATE INDEX IF NOT EXISTS release_change_requests_user_idx ON release_change_requests (user_id, created_at);

CREATE TABLE IF NOT EXISTS release_permanence_elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  release_id UUID,
  scope TEXT NOT NULL,
  election TEXT NOT NULL DEFAULT 'permanent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS release_permanence_user_idx ON release_permanence_elections (user_id, scope);
CREATE UNIQUE INDEX IF NOT EXISTS release_permanence_release_uidx ON release_permanence_elections (user_id, release_id);

CREATE TABLE IF NOT EXISTS label_roster_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id UUID NOT NULL,
  team_id UUID,
  artist_user_id UUID,
  artist_name TEXT NOT NULL DEFAULT '',
  artist_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  distribution_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS label_roster_manager_email_uidx ON label_roster_members (manager_user_id, artist_email);
CREATE INDEX IF NOT EXISTS label_roster_artist_idx ON label_roster_members (artist_user_id);
CREATE INDEX IF NOT EXISTS label_roster_manager_idx ON label_roster_members (manager_user_id);

CREATE TABLE IF NOT EXISTS social_unlock_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL,
  target_profile_id UUID,
  content_url TEXT NOT NULL,
  content_label TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_unlock_gates_slug_uidx ON social_unlock_gates (slug);
CREATE INDEX IF NOT EXISTS social_unlock_gates_owner_idx ON social_unlock_gates (owner_user_id);

CREATE TABLE IF NOT EXISTS social_unlock_share_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id UUID NOT NULL,
  user_id UUID NOT NULL,
  channel TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_unlock_shares_gate_user_uidx ON social_unlock_share_records (gate_id, user_id);
CREATE INDEX IF NOT EXISTS social_unlock_shares_gate_idx ON social_unlock_share_records (gate_id);
