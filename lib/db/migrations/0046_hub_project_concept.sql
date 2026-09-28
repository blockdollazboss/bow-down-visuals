-- Hub project templates: preloaded concept brief + template key.
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS concept text NOT NULL DEFAULT '';
ALTER TABLE hub_projects ADD COLUMN IF NOT EXISTS template_key text;
