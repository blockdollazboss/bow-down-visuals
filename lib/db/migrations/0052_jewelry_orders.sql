-- 0052: Custom jewelry line (dropship, made-to-order).
-- Reservation-only v1: statuses stay honest ("received" /
-- "pending_fulfillment") until a real fulfillment integration reports
-- otherwise. No charge is taken at reservation time.

CREATE TABLE IF NOT EXISTS jewelry_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  finish TEXT NOT NULL,
  size_option TEXT NOT NULL,
  engraving TEXT,
  design_notes TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  shipping_address JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jewelry_orders_user_id_idx ON jewelry_orders (user_id);
CREATE INDEX IF NOT EXISTS jewelry_orders_status_idx ON jewelry_orders (status);
CREATE INDEX IF NOT EXISTS jewelry_orders_created_at_idx ON jewelry_orders (created_at DESC);
