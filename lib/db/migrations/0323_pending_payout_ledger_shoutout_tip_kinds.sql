-- 0323: pending_payout_ledger — two new payable rails join the source_kind
-- list: 'shoutout_request' and 'tip_jar_tip' (stack1600 w8 lane).
--
-- Live-proven Nov 5, 2026 (staging two-account run, test mode): a paid
-- $10.00 shoutout (flat 5% fee → creator keeps $9.50, shown correctly on
-- the creator's shoutout dashboard) and a paid $5.00 tip-jar tip (no fee,
-- jar totals correct) both settled for real, yet NEITHER appeared in the
-- creator's Earnings total or pending payout — lib/seller-earnings.ts
-- reconciled only five rails into pending_payout_ledger (digital_sale,
-- store_orders, shop_event, beat_license, membership) and its unified
-- summary had no shoutout or paid-tip-jar reader at all.
--
-- This migration only widens the source_kind CHECK so the reconciliation
-- can accrue the two rails (amounts are computed by the sync in
-- api-server lib/seller-earnings.ts from the source rows the rails
-- already record: shoutout_requests at the flat-5% split, tip_jar_tips
-- at full amount — tips carry no fee). No fee math changes here.
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE pending_payout_ledger
  DROP CONSTRAINT IF EXISTS pending_payout_ledger_source_kind_check;

ALTER TABLE pending_payout_ledger
  ADD CONSTRAINT pending_payout_ledger_source_kind_check
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip'));
