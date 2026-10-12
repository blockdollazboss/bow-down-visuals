-- 0058: Custom jewelry line table on Supabase.
--
-- WHY THIS EXISTS: the jewelry_orders table was defined in
-- lib/db/migrations/ (0052_jewelry_orders.sql + 0074 avatar_url), which
-- the boot-time runner applies against DATABASE_URL (Render Postgres in
-- production). That is a DIFFERENT database from the Supabase project
-- that the API actually queries via getSupabaseAdmin() (SUPABASE_URL).
-- The Render-side migration can therefore never create this table where
-- the routes look for it, and every jewelry endpoint 500s with
-- "relation does not exist".
-- Run this file ONCE in the Supabase SQL Editor (or via the Supabase CLI):
--   app.supabase.com → your project → SQL Editor → paste → Run
-- Safe to re-run: every statement uses IF NOT EXISTS.
-- Mirrors the pattern documented in 0054_bonus_columns.sql.
-- Includes the avatar_url column (lib/db 0074) so no second pass is needed.

-- jewelry_orders: custom jewelry reservations (dropship, made-to-order).
-- Reservation-only v1: no charge at reservation time.
CREATE TABLE IF NOT EXISTS jewelry_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  finish TEXT NOT NULL,
  size_option TEXT NOT NULL,
  engraving TEXT,
  avatar_url TEXT,
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
