-- Branding shop fulfillment (Printful dropship integration). Idempotent.
-- Expands order statuses now that a real fulfillment provider exists, and
-- adds provider/tracking/payment columns. Statuses are only ever set from
-- the provider (Printful live or clearly-labeled mock sandbox) — never
-- fabricated.

-- Widen the status check from the v1 ('received' / 'pending_fulfillment').
ALTER TABLE IF EXISTS branding_orders
  DROP CONSTRAINT IF EXISTS branding_orders_status_check;
ALTER TABLE IF EXISTS branding_orders
  ADD CONSTRAINT branding_orders_status_check CHECK (status IN (
    'received', 'pending_fulfillment', 'in_production',
    'shipped', 'delivered', 'canceled', 'failed'
  ));

ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS tracking_url TEXT;
ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS branding_orders
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_branding_orders_provider_order_id
  ON branding_orders (provider_order_id);
CREATE INDEX IF NOT EXISTS idx_branding_orders_paid
  ON branding_orders (paid);
