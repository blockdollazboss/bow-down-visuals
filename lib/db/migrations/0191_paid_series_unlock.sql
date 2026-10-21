-- 0191: Paid Series unlock — sell a kind='series' playlist as a one-time
-- unlock on the EXISTING digital store rail (routes/store.ts).
--
-- Until now playlists carried no price or access fields at all: a series
-- was free-only, even though episodic selling is a proven format (TikTok
-- Series) — and TikTok keeps the buyer relationship. Here the buyer list
-- stays the creator's: the purchase is an ordinary digital_sales row
-- (item_kind 'series', item_id = playlist id), so the sale appears in the
-- creator's sales dashboard + earnings exactly like a product sale, and
-- the row itself is the entitlement record:
--
--   * access  = a digital_sales row for (buyer, 'series', playlist) with
--               status 'completed' — the 0182 clawback flips refunded /
--               disputed sales to 'refunded', which locks the episodes
--               again with no extra bookkeeping.
--   * price   = playlists.price_cents, set by the CREATOR (their price,
--               like every product price on the rail). NULL/0 = free.
--   * preview = playlists.preview_item, ONE items entry ({kind, id})
--               the creator marks free for non-buyers (trailer / first
--               episode). NULL = no free preview.
--
-- The fee is the rail's standing fee (STOREFRONT_PLATFORM_FEE_BPS, 5%),
-- taken from the seller's cut exactly like track/video sales.

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS price_cents integer;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS preview_item jsonb;

ALTER TABLE digital_sales DROP CONSTRAINT IF EXISTS digital_sales_item_kind_check;
ALTER TABLE digital_sales
  ADD CONSTRAINT digital_sales_item_kind_check
  CHECK (item_kind IN ('track', 'video', 'album', 'pack', 'digital', 'series'));
