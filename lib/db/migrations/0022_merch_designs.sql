-- Merch Designer (v1): AI-designed merch, dropship model.
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- merch_designs: one row per creator design. Listing is free; design
-- batches cost credits (charged in the API, not here). Checkout is
-- honestly "coming soon" — no payment columns, no faked transactions.

CREATE TABLE IF NOT EXISTS merch_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  product TEXT NOT NULL,
  style TEXT NOT NULL,
  prompt TEXT,
  image_url TEXT NOT NULL,
  image_path TEXT,
  price_cents INTEGER,
  base_cost_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payments_live BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS merch_designs_user_id_idx
  ON merch_designs (user_id);
