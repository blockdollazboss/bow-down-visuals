-- Artist Vault wardrobe: outfits worn by the artist.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Outfits are vault-scoped (they belong WITH the artist). Deleting a vault
-- cascades to its outfits. Deleting an outfit deletes ONLY this row — the
-- image object in Supabase storage is never touched (non-destructive by
-- design; see the PR #27 lesson on the vault Remove button).
-- Must stay in sync with lib/db/src/schema/artist-outfits.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

CREATE TABLE IF NOT EXISTS artist_outfits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES artist_vaults(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artist_outfits_vault_id_idx
  ON artist_outfits (vault_id);
