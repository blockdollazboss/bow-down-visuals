-- 9999 (PROVISIONAL — payfix sponsor-purchase lane; renumber at join):
-- Direct profile sponsorships: a signed-in user sponsors a SPECIFIC
-- creator from that creator's /artist/:slug profile. The purchase rides
-- the existing sponsor_deals escrow rail — this column is the only
-- schema change: it marks a deal as bought for one named creator (the
-- deal's accepted_user_id) instead of posted to the open marketplace.
-- NULL = marketplace deal (all pre-existing rows).
--
-- The money math is unchanged: sponsorFeeSplit() in
-- routes/generate/sponsors.ts applies SPONSOR_PLATFORM_FEE_BPS
-- (default 1500 = 15% platform / 85% creator) at release.
--
-- Idempotent: safe to re-run.

ALTER TABLE sponsor_deals
  ADD COLUMN IF NOT EXISTS target_creator_user_id text;

CREATE INDEX IF NOT EXISTS sponsor_deals_target_creator_idx
  ON sponsor_deals (target_creator_user_id)
  WHERE target_creator_user_id IS NOT NULL;
