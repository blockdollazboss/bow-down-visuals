-- Creation Hub projects (2026-09-28).
--
-- One active project per user: the hub's working state (name, type, asset
-- tray) follows the account across devices. The client treats localStorage
-- as a fast cache and syncs here (debounced) when signed in.
-- Assets are metadata + URLs only (generation outputs live in object storage).

CREATE TABLE IF NOT EXISTS hub_projects (
  user_id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  type TEXT NOT NULL DEFAULT 'song',
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE hub_projects IS
  'Creation Hub: one synced active project per user (name, type, asset tray).';
