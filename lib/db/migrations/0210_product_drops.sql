-- 0210: Timed product drops (Stack-100 #3 #25) — a creator schedules a
-- storefront product to publish at a future moment (drop_at, timestamptz
-- = UTC instant). Before it, the product page is the drop page
-- (countdown + email capture); at the moment, the sweeper flips the drop
-- live and emails the capture list exactly once (claim ledger below).
-- Captures also subscribe the fan to the creator's existing email list
-- (email_subscribers, source 'drop') — no parallel list is created here.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS product_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  drop_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_drops_status_check CHECK (status IN ('scheduled', 'live', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS product_drops_product_ux ON product_drops (product_id);
CREATE INDEX IF NOT EXISTS product_drops_due_idx ON product_drops (status, drop_at);
CREATE INDEX IF NOT EXISTS product_drops_profile_idx ON product_drops (profile_id);

CREATE TABLE IF NOT EXISTS product_drop_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  source text NOT NULL DEFAULT 'drop',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_drop_captures_drop_email_ux ON product_drop_captures (drop_id, email);
CREATE INDEX IF NOT EXISTS product_drop_captures_drop_idx ON product_drop_captures (drop_id);

CREATE TABLE IF NOT EXISTS product_drop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES product_drops(id) ON DELETE CASCADE,
  capture_id uuid REFERENCES product_drop_captures(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_drop_deliveries_status_check CHECK (status IN ('pending', 'sent', 'failed', 'dead'))
);
CREATE UNIQUE INDEX IF NOT EXISTS product_drop_deliveries_drop_email_idx ON product_drop_deliveries (drop_id, email);
CREATE INDEX IF NOT EXISTS product_drop_deliveries_drop_idx ON product_drop_deliveries (drop_id);
