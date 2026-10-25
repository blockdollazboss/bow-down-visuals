-- 0237: Wishlists + price-drop alerts (Wave 4 #38).
-- A fan can save any storefront product (store_products) or shop
-- product (shop_products) to a wishlist docked in their Library. The
-- price at save time is recorded; when the product's price later drops
-- below the lowest price seen since the save (and since the last
-- alert), the fan gets ONE in-app notification per drop through the
-- existing notifications rail. Rises never alert. Removing the item
-- stops all future alerts. Sellers never see who saved their product.
--
-- lowest_cents is the alert baseline: it only ever moves down, and the
-- alert path claims a row by moving it to the new price in a guarded
-- UPDATE, so a drop can never notify twice and a further drop can
-- notify again.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS wishlists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  item_kind         text NOT NULL,
  item_id           uuid NOT NULL,
  price_at_add_cents integer NOT NULL,
  lowest_cents      integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlists_item_kind_check CHECK (item_kind IN ('store_product', 'shop_product')),
  CONSTRAINT wishlists_price_at_add_nonneg CHECK (price_at_add_cents >= 0),
  CONSTRAINT wishlists_lowest_nonneg CHECK (lowest_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS wishlists_user_item_unique
  ON wishlists (user_id, item_kind, item_id);
CREATE INDEX IF NOT EXISTS wishlists_user_idx ON wishlists (user_id);
CREATE INDEX IF NOT EXISTS wishlists_item_idx ON wishlists (item_kind, item_id);
