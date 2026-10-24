-- 0221: Post-purchase one-click upsell for the storefront rail
-- (Stack-100 #3, Wave 3, lane 1 — numbered at the join; the lane's
-- own 0206 label is void). After a purchase completes, the buyer is
-- offered the product's designated add-on (the SAME seller attachment
-- as the checkout bump: store_products.bump_product_id /
-- bump_percent_off) once, and can accept in one click — charged
-- off-session to the payment method saved by the completed checkout
-- through a PaymentIntent with a deterministic idempotency key.
--
-- The offer state lives in store_upsell_offers: ONE row per parent
-- order (UNIQUE parent_order_id), carrying the price/fee snapshot the
-- buyer saw, the saved Stripe customer + payment method, and the
-- decision. An accepted upsell records as its OWN store_orders row,
-- linked back by parent_order_id and pinned exactly-once by the
-- UNIQUE stripe_payment_intent_id.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text UNIQUE;

CREATE TABLE IF NOT EXISTS store_upsell_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL UNIQUE,
  buyer_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  product_id uuid NOT NULL,
  upsell_product_id uuid NOT NULL,
  upsell_title text NOT NULL,
  upsell_kind text NOT NULL,
  list_price_cents integer NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL,
  creator_amount_cents integer NOT NULL,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_method_brand text,
  payment_method_last4 text,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  stripe_payment_intent_id text,
  upsell_order_id uuid,
  shown_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_upsell_offers
  DROP CONSTRAINT IF EXISTS store_upsell_offers_status_range;
ALTER TABLE store_upsell_offers
  ADD CONSTRAINT store_upsell_offers_status_range
  CHECK (status IN ('pending', 'accepted', 'declined', 'failed'));
