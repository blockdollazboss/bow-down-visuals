-- Global Drop (#165) — UPGRADE of Translate & Dub.
-- Provisional number 9999 (renumbered at join). Idempotent.
--
-- global_drop_packages: ONE package per music release — the five
-- launch-language versions (es/pt/fr/de/ja), each reviewed by the
-- creator before publish. Publishing writes approved versions' URLs
-- into the release's existing smartlink_language_destinations.

CREATE TABLE IF NOT EXISTS global_drop_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  release_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_drop_packages_status_check CHECK (status IN ('draft','active'))
);

CREATE UNIQUE INDEX IF NOT EXISTS global_drop_packages_release_idx
  ON global_drop_packages (release_id);
