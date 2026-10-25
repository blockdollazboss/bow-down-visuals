-- 0235: Co-seller revenue splits on store & shop products (Wave 4 #36).
-- Two creators sell ONE product together; the sale's seller net divides
-- automatically instead of one seller collecting everything and paying
-- the other by hand.
--
-- The split SETTING rides the product rows themselves (a jsonb list of
-- {userId, sharePct}, shares summing to exactly 100 — the publishing
-- splits sum-to-100 machine, lib/sale-splits.ts): store_products for
-- the profile store, shop_products for marketplace shops. Null = no
-- co-sellers; the product sells exactly as before.
--
-- The per-sale DIVISION is recorded in sale_split_entries: one row per
-- seller per product line of a fulfilled sale, the share snapshotted
-- at sale time, amounts in integer cents of the SELLER NET (the flat
-- 5% platform fee comes off the top first, exactly as every rail
-- already computes creator_amount_cents / amount - platform_fee).
-- The parent sale rows keep their existing meaning (full seller net);
-- earnings and payout sums subtract the co-seller rows from the owner
-- and add them to the co-seller (bulk-ledger discipline, like
-- digital_sales / store_orders themselves — no per-row settlement
-- stamps). A refund flips the parent sale AND every entry on it to
-- 'reversed' in the same payment-reversals pass, so both sellers lose
-- the sale symmetrically, exactly once.
--
-- Money law: this is the site's existing real-money sale accounting
-- (Stripe rails, TEST mode until launch). It grants no Visual Bucs
-- and pays nobody by itself — settlement rides the existing Connect
-- payout rail like every other sale ledger.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE store_products ADD COLUMN IF NOT EXISTS splits jsonb;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS splits jsonb;

CREATE TABLE IF NOT EXISTS sale_split_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* The parent sale row: 'store_order' -> store_orders.id,
     'shop_event' -> shop_events.id. product_id is the line's product
     (a store order can carry a bump line for a second product). */
  sale_kind         text NOT NULL,
  sale_id           uuid NOT NULL,
  surface           text NOT NULL,
  product_id        uuid NOT NULL,
  product_title     text NOT NULL DEFAULT '',
  owner_user_id     uuid NOT NULL,
  seller_user_id    uuid NOT NULL,
  /* Snapshot of the seller's creator profile at sale time, when one
     exists (reporting only — money math keys on seller_user_id). */
  seller_profile_id uuid,
  role              text NOT NULL DEFAULT 'co_seller',
  share_pct         numeric(5, 2) NOT NULL,
  gross_cents       integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  amount_cents      integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'earned',
  stripe_session_id text,
  reversed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (sale_kind IN ('store_order', 'shop_event')),
  CHECK (surface IN ('store_product', 'shop_product')),
  CHECK (role IN ('owner', 'co_seller')),
  CHECK (status IN ('earned', 'reversed')),
  CHECK (share_pct > 0 AND share_pct <= 100),
  CHECK (amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_split_entries_sale_seller_ux
  ON sale_split_entries (sale_kind, sale_id, product_id, seller_user_id);
CREATE INDEX IF NOT EXISTS sale_split_entries_seller_idx
  ON sale_split_entries (seller_user_id, status);
CREATE INDEX IF NOT EXISTS sale_split_entries_owner_idx
  ON sale_split_entries (owner_user_id, status);
CREATE INDEX IF NOT EXISTS sale_split_entries_sale_idx
  ON sale_split_entries (sale_kind, sale_id);
