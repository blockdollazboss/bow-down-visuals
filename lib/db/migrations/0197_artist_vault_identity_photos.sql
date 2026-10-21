-- 0196: Identity Set photos for Artist Vault characters
-- (competitor study ~/workspace/competitor-study/higgsfield.md G4 —
-- Higgsfield's Soul ID trains an identity from a photo set; ours held
-- exactly one reference_image_url per character plus a text
-- consistency prefix).
--
-- This is the honest near-term form — NO training is added or implied:
-- a vault character can hold a SET of labeled photos of the same
-- character (angle / expression / wardrobe), and the generation rail
-- picks the best-matching reference per shot, showing the creator
-- which photo was chosen and why (overridable, never silent).
--
-- artist_vault_identity_photos:
--   vault_id   the character (artist_vaults row) this photo belongs to.
--   user_id    the vault owner, denormalized so reads/writes stay
--              owner-scoped without a join.
--   angle      shot angle label (front, left_profile, full_body, …) —
--              vocabulary enforced at the route, text here so new
--              labels never need a migration.
--   expression expression label (neutral, smile, singing, …).
--   wardrobe   free-text wardrobe label (e.g. "stage outfit").
--   source     'upload' (the creator's own photo) or 'generated'
--              (an AI-generated portrait, admitted only labeled —
--              generated faces never enter a set silently).
--   deleted_at soft delete, like the vault itself: user data is
--              never hard-deleted; storage objects are never touched.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS artist_vault_identity_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES artist_vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  image_url TEXT NOT NULL,
  image_path TEXT,
  angle TEXT NOT NULL DEFAULT 'front',
  expression TEXT NOT NULL DEFAULT 'neutral',
  wardrobe TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'generated')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- The set is always read per vault, live rows only, in display order.
CREATE INDEX IF NOT EXISTS artist_vault_identity_photos_vault_idx
  ON artist_vault_identity_photos (vault_id, deleted_at, sort_order);
-- Owner-scoped lookups (another member's set is never visible).
CREATE INDEX IF NOT EXISTS artist_vault_identity_photos_user_idx
  ON artist_vault_identity_photos (user_id);
