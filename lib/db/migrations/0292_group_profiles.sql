-- 9999 (PROVISIONAL — renumbered at join): Duo/Group public profiles
-- (Stack-200 UPGRADE N20).
--
-- The public half of a team: group_profiles binds 1:1 to a team and
-- carries the group's public identity (slug, name, bio, publish flag)
-- plus its WRITTEN split terms (a sale-splits ProductSplit list,
-- sum-to-100, team owner included, active members only — validated in
-- lib/group-profiles.ts). store_products.group_profile_id marks the
-- shared store: products sold under the group name, with the group's
-- terms stamped onto the product's existing splits column so the
-- shipped sale-splits rail divides the sales. No new money path.
CREATE TABLE IF NOT EXISTS group_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text,
  banner_url text,
  is_published boolean NOT NULL DEFAULT false,
  split_terms jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_profiles_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

CREATE INDEX IF NOT EXISTS group_profiles_published_idx
  ON group_profiles (is_published);

ALTER TABLE store_products
  ADD COLUMN IF NOT EXISTS group_profile_id uuid
  REFERENCES group_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS store_products_group_profile_idx
  ON store_products (group_profile_id)
  WHERE group_profile_id IS NOT NULL;
