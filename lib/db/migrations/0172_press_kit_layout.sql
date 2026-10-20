-- 0172: Press-kit page layout (Ring 4 parity tail — press-kit layout
-- editing). Until now the public press-kit page (/press/:handle)
-- rendered its six content sections — bio, achievements, press quotes,
-- top tracks, photos, booking & contact — in one hardcoded order with
-- no way for the kit's owner to reorder or hide any of them.
--   layout — the owner's saved arrangement: a JSONB array of
--     { "key": <section key>, "visible": <bool> } in render order,
--     validated by pressKitLayoutSchema in lib/db/src/schema/
--     press-kits.ts (unknown or duplicate keys are refused at save).
--   NULL means "no layout saved" and renders exactly as the page
--   always has — all six sections, visible, in canonical order — so
--   every existing kit keeps its current public page untouched.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE press_kits ADD COLUMN IF NOT EXISTS layout JSONB;
