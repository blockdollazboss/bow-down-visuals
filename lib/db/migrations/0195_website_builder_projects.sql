-- 0195: Server-side persistence for AI Website Builder projects
-- (competitor dossier ~/workspace/competitor-study/ai-builders.md, gap G2).
--
-- The defect: website-builder builds lived only in React state on the
-- page (useState<FilesMap>). Refresh or close the tab and the generated
-- site — which the member paid 3,000 VB to build — was gone; the edit
-- endpoint had to re-receive the entire file map from the browser
-- because the server kept nothing. Every competitor in the category
-- (Lovable / Replit / Bolt / v0) treats the project as a persistent,
-- versioned thing.
--
-- website_builder_projects: one row per saved build, owner-scoped.
--   client_ref  the builder client's per-build id (the hub_projects
--               0142 pattern): saves upsert by (user_id, client_ref),
--               so a retried save after a lost response lands on the
--               same project instead of duplicating it. Null for rows
--               saved without a client id; Postgres treats NULLs as
--               distinct in a unique index, so they never collide.
--   brief       the settings that produced the CURRENT head version
--               ({ description, style, colorScheme }) — mirrored from
--               the head version row on every append.
--
-- website_builder_versions: APPEND-ONLY. Every generation, re-
-- generation, conversational edit, restore, and explicit save writes
-- a NEW row; no version is ever updated or overwritten, so a restore
-- can never destroy history.
--   version     1-based sequence per project (UNIQUE with project_id).
--   source      'generate' | 'regenerate' | 'edit' | 'restore' | 'save'.
--   note        the edit request text for 'edit', "Restored from
--               version N" for 'restore'; null otherwise.
--   brief       the brief/settings snapshot that produced THIS
--               version (an edit inherits the brief it edited).
--   files       the full generated site payload (file path -> full
--               contents) — exactly what the builder produced, stored
--               verbatim so a re-open round-trips byte-identical.
--   file_count  Object.keys(files).length, recorded at write time so
--               list views never need to load the payload.
--
-- Honest storage: there is deliberately NO thumbnail/preview column —
-- no preview image is ever rendered server-side, and the UI shows a
-- labeled live-preview affordance instead of a fake screenshot.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS website_builder_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  client_ref TEXT,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS website_builder_projects_client_ref_idx
  ON website_builder_projects (user_id, client_ref);
-- The saved-sites list reads one member's projects newest-activity first.
CREATE INDEX IF NOT EXISTS website_builder_projects_user_idx
  ON website_builder_projects (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS website_builder_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES website_builder_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generate', 'regenerate', 'edit', 'restore', 'save')),
  note TEXT,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  files JSONB NOT NULL,
  file_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS website_builder_versions_project_version_idx
  ON website_builder_versions (project_id, version);
