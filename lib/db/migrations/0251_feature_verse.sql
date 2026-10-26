-- 9999 (PROVISIONAL number — integrator renumbers at join):
-- Feature Verse Market (Stack-200 N7).
--
-- A buyer commissions a feature verse/appearance from a creator.
-- The creator sets their own price in Visual Bucs (no platform price,
-- no default, no fee invented by this lane). The splits for the
-- resulting track are written into the order and validated by the
-- existing publishing-splits validator; BOTH parties sign before
-- the escrow can be funded, and delivery is gated on both
-- signatures + a held escrow.
--
-- Escrow follows the sponsors-escrow state machine
-- (escrow_status: none -> held -> released | refunded, every
-- transition status-guarded) on the Visual Bucs credits rail —
-- never real money. feature_verse_escrow_ledger.idempotency_key is
-- UNIQUE: one hold, one release, one refund per order, ever.
--
-- Lifecycle: terms_proposed -> signed -> escrow_held -> delivered
-- -> released, with disputed / refunded / declined /
-- expired_unaccepted exits. Unaccepted orders never held a fee
-- (funding requires both signatures); any held fee refunds in full.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS feature_verse_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  creator_name text NOT NULL DEFAULT 'Creator',
  price_vb integer NOT NULL CHECK (price_vb > 0),
  title text NOT NULL DEFAULT 'Feature verse',
  description text NOT NULL DEFAULT '',
  turnaround_days integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_verse_listings_creator_key
  ON feature_verse_listings (creator_user_id);

CREATE TABLE IF NOT EXISTS feature_verse_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  price_vb integer NOT NULL CHECK (price_vb > 0),
  track_context text NOT NULL DEFAULT '',
  usage_terms text NOT NULL DEFAULT '',
  deadline_ask text,
  splits jsonb NOT NULL,
  status text NOT NULL DEFAULT 'terms_proposed',
  escrow_status text NOT NULL DEFAULT 'none',
  buyer_signed_at timestamptz,
  creator_signed_at timestamptz,
  sign_by timestamptz NOT NULL,
  escrow_held_at timestamptz,
  delivery_note text,
  delivery_url text,
  delivered_at timestamptz,
  dispute_reason text,
  disputed_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_verse_orders_idempotency_key
  ON feature_verse_orders (idempotency_key);
CREATE INDEX IF NOT EXISTS feature_verse_orders_buyer_idx
  ON feature_verse_orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS feature_verse_orders_creator_idx
  ON feature_verse_orders (creator_user_id);

CREATE TABLE IF NOT EXISTS feature_verse_escrow_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  kind text NOT NULL,
  amount_vb integer NOT NULL CHECK (amount_vb > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS feature_verse_escrow_ledger_key
  ON feature_verse_escrow_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS feature_verse_escrow_ledger_order_idx
  ON feature_verse_escrow_ledger (order_id);
