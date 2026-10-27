-- 9999 (PROVISIONAL — payfix store-dashboards lane): pending-payout ledger.
-- One ledger for a seller's payable money. Each completed sale on a
-- payable rail (digital_sales, store_orders, shop_events sales,
-- beat_licenses, paid fan_members) accrues the seller net exactly once
-- ('accrual'); a refund records exactly one 'reversal' of the same
-- amount. Exactly-once is the UNIQUE (source_kind, source_id,
-- entry_type) key below + INSERT ... ON CONFLICT DO NOTHING in the
-- reconciliation (api-server lib/seller-earnings.ts), mirroring the
-- credit-pack clawback's claim discipline.
-- Fee math is untouched: amounts are copied from the source rows the
-- rails already recorded (store 5%, beats 15%; memberships carry no
-- fee split in their model, so their payable stays price_cents as the
-- 0142 settlement has always counted it).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS pending_payout_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id     uuid NOT NULL,
  seller_profile_id  uuid,
  source_kind        text NOT NULL,
  source_id          uuid NOT NULL,
  entry_type         text NOT NULL,
  gross_cents        integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  net_cents          integer NOT NULL DEFAULT 0,
  stripe_session_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership')),
  CHECK (entry_type IN ('accrual','reversal'))
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_payout_ledger_source_entry_ux
  ON pending_payout_ledger (source_kind, source_id, entry_type);

CREATE INDEX IF NOT EXISTS pending_payout_ledger_seller_idx
  ON pending_payout_ledger (seller_user_id, created_at);
