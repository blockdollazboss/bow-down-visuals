-- Branding shop orders (dropship model). Idempotent.
-- v1 honesty contract: statuses are only 'received' / 'pending_fulfillment'.
-- No shipped/delivered/tracking concept until a real dropship partner exists.
CREATE TABLE IF NOT EXISTS branding_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  items JSONB NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'pending_fulfillment')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branding_orders_user_id
  ON branding_orders (user_id);
CREATE INDEX IF NOT EXISTS idx_branding_orders_created_at
  ON branding_orders (created_at DESC);
