-- 0079: Release Metadata Manager — DistroKid-parity metadata columns.
--
-- Extends distribution_releases (created in 0011, v2 columns in 0034/0057)
-- with the full DistroKid-style release metadata set:
--   - upc / upc_kind ('internal' | 'official'): the "generate barcode" helper
--     mints a valid-format UPC-A placeholder marked INTERNAL — a real,
--     store-recognized UPC only comes from a distribution partner.
--   - label_imprint: custom label name (DistroKid-style label imprint).
--   - copyright_c_line / copyright_p_line: © and ℗ lines, auto-suggested
--     from label + release year in the UI.
--   - subgenre alongside the existing genre (primary genre) column.
--   - original_release_date (first release) and preorder_date pickers.
--   - territories_mode ('worldwide' | 'include' | 'exclude') + territories
--     jsonb (ISO 3166-1 alpha-2 codes) for include/exclude lists.
--
-- Idempotent: safe to re-run. No explicit transaction control — the runner
-- wraps each file in BEGIN/COMMIT automatically.

ALTER TABLE distribution_releases
  ADD COLUMN IF NOT EXISTS upc_kind text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS label_imprint text,
  ADD COLUMN IF NOT EXISTS copyright_c_line text,
  ADD COLUMN IF NOT EXISTS copyright_p_line text,
  ADD COLUMN IF NOT EXISTS subgenre text,
  ADD COLUMN IF NOT EXISTS original_release_date text,
  ADD COLUMN IF NOT EXISTS preorder_date text,
  ADD COLUMN IF NOT EXISTS territories_mode text NOT NULL DEFAULT 'worldwide',
  ADD COLUMN IF NOT EXISTS territories jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: releases with a manually-typed UPC that is not an internal
-- placeholder stay 'internal' until the creator marks it official in the
-- Release Metadata Manager. Nothing to do here — default holds.

-- Constrain the enum-ish columns only for NEW writes; keep it a plain
-- CHECK so older clients can still read/write the base columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'distribution_releases_upc_kind_check'
  ) THEN
    ALTER TABLE distribution_releases
      ADD CONSTRAINT distribution_releases_upc_kind_check
      CHECK (upc_kind IN ('internal', 'official'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'distribution_releases_territories_mode_check'
  ) THEN
    ALTER TABLE distribution_releases
      ADD CONSTRAINT distribution_releases_territories_mode_check
      CHECK (territories_mode IN ('worldwide', 'include', 'exclude'));
  END IF;
END $$;
