-- 9999-wave4346 (PROVISIONAL number — renumber at join): Make-an-offer
-- (Wave 4 #43). Buyers propose a price below list on a storefront
-- product (store_products) or a shop product (shop_products); the
-- seller accepts / declines / counters; the buyer accepts / declines /
-- counters a counter. An accepted offer's agreed_amount_cents becomes
-- the purchase price through the EXISTING checkouts (storefront
-- /storefront/checkout and shops /storefronts/checkout, both flat-5%
-- fee out of the seller's cut, Stripe TEST mode) — this table carries
-- the negotiation only; orders, refunds and entitlements stay on the
-- existing store_orders / shop_events rails, and no payout rail is
-- added (seller nets remain pending balances as before).
--
-- Negotiation law, enforced in the checks below and in
-- artifacts/api-server/src/lib/product-offers.ts:
--   offer 1..list-1; a counter strictly between the answered amount
--   and list; one open offer per (buyer, product) enforced app-side;
--   expires_at = 7 days after the last move (lazy expiry on read);
--   an accepted offer is claimed by one checkout at a time
--   (claimed_ref / claimed_at, 30-minute stale window) and consumed
--   exactly once when its sale records.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS product_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id       uuid NOT NULL,
  seller_user_id      uuid NOT NULL,
  item_kind           text NOT NULL,
  item_id             uuid NOT NULL,
  profile_id          uuid,
  shop_id             uuid,
  list_price_cents    integer NOT NULL,
  offer_amount_cents  integer NOT NULL,
  counter_amount_cents integer,
  agreed_amount_cents integer,
  status              text NOT NULL DEFAULT 'pending',
  message             text NOT NULL DEFAULT '',
  expires_at          timestamptz NOT NULL,
  claimed_ref         text,
  claimed_at          timestamptz,
  consumed_ref        text,
  consumed_at         timestamptz,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_offers_item_kind_check CHECK (item_kind IN ('store_product', 'shop_product')),
  CONSTRAINT product_offers_status_check CHECK (status IN ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'consumed')),
  CONSTRAINT product_offers_list_nonneg CHECK (list_price_cents > 0),
  CONSTRAINT product_offers_amount_range CHECK (offer_amount_cents > 0 AND offer_amount_cents < list_price_cents),
  CONSTRAINT product_offers_counter_range CHECK (counter_amount_cents IS NULL OR (counter_amount_cents > offer_amount_cents AND counter_amount_cents < list_price_cents)),
  CONSTRAINT product_offers_agreed_range CHECK (agreed_amount_cents IS NULL OR (agreed_amount_cents > 0 AND agreed_amount_cents < list_price_cents))
);

CREATE INDEX IF NOT EXISTS product_offers_buyer_idx ON product_offers (buyer_user_id);
CREATE INDEX IF NOT EXISTS product_offers_seller_idx ON product_offers (seller_user_id);
CREATE INDEX IF NOT EXISTS product_offers_item_idx ON product_offers (item_kind, item_id);
