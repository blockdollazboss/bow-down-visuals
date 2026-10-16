-- 0134: Stack 3 "The profile IS the website" — profile layout blocks,
-- theme settings, spotlight pin, fan collections, and the Hosting plan's
-- entitlement table.
--
-- creator_profiles gains:
--   layout_blocks        JSONB ordered block list for the block layout
--                        model (item 2 plumbing). Empty = "no saved
--                        layout" — reads derive the default from the
--                        profile's current section order, so an untouched
--                        profile renders exactly as today.
--   pinned_kind/pinned_item_id  the spotlight pin (item 5): ONE featured
--                        track or video, by content id, validated at
--                        write time (own + published content only).
--   collection_visibility  fan collection privacy (item 6): 'public'
--                        (the house default — profiles and achievements
--                        are public by default) or 'private'.
-- creator_hosting: one entitlement row per profile for the Hosting plan
-- (item 8) — custom domain + clean branding + the profile page, synced
-- from Stripe subscription webhooks (TEST mode only), mirroring the
-- creator_subscriptions shape.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT (the boot
-- migrator wraps files itself).

ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS layout_blocks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS pinned_kind TEXT;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS pinned_item_id UUID;
ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS collection_visibility TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_profiles_pinned_kind_check') THEN
    ALTER TABLE creator_profiles ADD CONSTRAINT creator_profiles_pinned_kind_check
      CHECK (pinned_kind IS NULL OR pinned_kind IN ('track', 'video'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_profiles_collection_visibility_check') THEN
    ALTER TABLE creator_profiles ADD CONSTRAINT creator_profiles_collection_visibility_check
      CHECK (collection_visibility IN ('public', 'private'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS creator_hosting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES creator_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_hosting_stripe_sub_idx ON creator_hosting (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS creator_hosting_stripe_customer_idx ON creator_hosting (stripe_customer_id);
