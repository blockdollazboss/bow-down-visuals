-- Stack-200 upgrade N11 (one-tap beat leases) — PROVISIONAL migration.
-- The join renumbers this file into the next free slot; the statement
-- is idempotent and safe to re-run.
--
-- beat_licenses.terms_accepted_at: the durable acceptance record — when
-- the buyer tapped "Agree & pay" on the plain-words checkout, binding
-- them to the row's terms_snapshot exactly as rendered. NULL for
-- purchases that never passed through the plain-words tap.

ALTER TABLE beat_licenses
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
