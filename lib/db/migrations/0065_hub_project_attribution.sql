-- Hub project "Made with Bow Down Visuals" attribution toggle.
-- Project-level flag (default ON) that flows into every export/share
-- output from every tool in the project. Idempotent.
ALTER TABLE hub_projects
  ADD COLUMN IF NOT EXISTS attribution BOOLEAN NOT NULL DEFAULT TRUE;
