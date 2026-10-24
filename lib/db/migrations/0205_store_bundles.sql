-- 0205: Product bundles (Stack-100 #3, F15) — widen digital_sales.item_kind.
--
-- A bundle is a playlists row with kind='bundle' (price_cents = the bundle
-- price, items = the components). Its sale rides the digital store rail as
-- ONE digital_sales row with item_kind='bundle', so the flat 5% fee splits
-- once, on the bundle total. Component grants are recorded at verify:
-- download_links against the bundle sale (tracks/videos) and completed $0
-- 'series' rows keyed by a suffixed session id (series unlocks).
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE digital_sales DROP CONSTRAINT IF EXISTS digital_sales_item_kind_check;
ALTER TABLE digital_sales
  ADD CONSTRAINT digital_sales_item_kind_check
  CHECK (item_kind IN ('track', 'video', 'album', 'pack', 'digital', 'series', 'bundle'));
