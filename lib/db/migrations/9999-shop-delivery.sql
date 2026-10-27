-- 9999 (PROVISIONAL, payfix lane 4 — renumber on join): digital delivery
-- for marketplace shops. Free includes selling at the flat 5% fee, and a
-- paid digital purchase must actually deliver: the buyer gets a library
-- entry, download/access, and an order record with a visible order ID.
--
-- shop_products gains the product kind + the deliverable the seller
-- attaches (upload or URL). shop_deliveries is the buyer's delivery
-- record: one row per PAID shop_events sale line, UNIQUE(sale_event_id)
-- is the exactly-once guard. Rows are written only by the paid flip —
-- declined/pending/expired checkouts never create one.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'physical';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS deliverable_url text;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS deliverable_name text;

CREATE TABLE IF NOT EXISTS shop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id uuid NOT NULL UNIQUE,
  shop_id uuid NOT NULL,
  product_id uuid,
  buyer_user_id uuid,
  buyer_email text,
  order_id text NOT NULL,
  product_name text,
  deliverable_url text NOT NULL,
  deliverable_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_deliveries_buyer_email_idx ON shop_deliveries (buyer_email);
CREATE INDEX IF NOT EXISTS shop_deliveries_buyer_user_idx ON shop_deliveries (buyer_user_id);
