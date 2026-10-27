-- Drop Day Kit (#169) — UPGRADE of Product Drops + Release Checklist
-- + Promo Clips + presave notify.
-- Provisional number 9999 (renumbered at join). Idempotent.
--
-- drop_day_kits: ONE kit per music release — the one-tap assembly
-- (teaser-short spec + banner set from the release's own art/track,
-- countdown bound to the existing presave page, land-time heads-up
-- riding the existing presave_follows rail). Specs only: nothing in
-- here is a finished render or a sent email.

CREATE TABLE IF NOT EXISTS drop_day_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  release_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  kit jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drop_day_kits_status_check CHECK (status IN ('draft','active','landed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS drop_day_kits_release_idx
  ON drop_day_kits (release_id);
