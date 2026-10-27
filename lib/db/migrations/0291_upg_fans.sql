-- 9999-upg-fans (PROVISIONAL — renumbered at join): upg-fans lane
-- #175 Collab Match (house-suggested pairings) · N17 Fan Links · N16
-- Audience Room play sources.
--
-- collab_suggestions: one row per unordered creator pair the house has
-- ever suggested. Both sides opt in before any contact exists; a pass
-- from either side closes the pair forever (the scorer skips any pair
-- that already has a row), so a declined pairing can never be re-nagged.
--
-- fan_links / fan_link_events: per-fan share links for creator content
-- and the proven touches they produced (click / arrival / signup).
-- Signup attribution is exactly-once per new account (partial unique
-- index below).
--
-- play_events.source: nullable; rows recorded before this column are
-- honestly "untracked" in the Audience Room, never back-filled with a
-- guess.

CREATE TABLE IF NOT EXISTS collab_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id uuid NOT NULL,
  user_b_id uuid NOT NULL,
  score integer NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  a_status text NOT NULL DEFAULT 'pending',
  b_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'open',
  intro_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collab_suggestions_pair_uidx ON collab_suggestions (user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS collab_suggestions_a_idx ON collab_suggestions (user_a_id, status);
CREATE INDEX IF NOT EXISTS collab_suggestions_b_idx ON collab_suggestions (user_b_id, status);

CREATE TABLE IF NOT EXISTS fan_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  fan_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  content_type text NOT NULL,
  content_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fan_links_fan_content_uidx ON fan_links (fan_user_id, content_type, content_id);
CREATE INDEX IF NOT EXISTS fan_links_creator_idx ON fan_links (creator_user_id);
CREATE INDEX IF NOT EXISTS fan_links_code_idx ON fan_links (code);

CREATE TABLE IF NOT EXISTS fan_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_link_id uuid NOT NULL REFERENCES fan_links (id) ON DELETE CASCADE,
  kind text NOT NULL,
  visitor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fan_link_events_link_idx ON fan_link_events (fan_link_id, kind);
CREATE INDEX IF NOT EXISTS fan_link_events_visitor_idx ON fan_link_events (visitor_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fan_link_events_signup_once_uidx
  ON fan_link_events (visitor_user_id) WHERE kind = 'signup' AND visitor_user_id IS NOT NULL;

ALTER TABLE play_events ADD COLUMN IF NOT EXISTS source text;
