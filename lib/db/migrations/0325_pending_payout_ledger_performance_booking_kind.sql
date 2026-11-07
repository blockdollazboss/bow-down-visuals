-- 0325: pending_payout_ledger — one new payable rail joins the
-- source_kind list: 'performance_booking' (stack200 lane M1).
--
-- Live-proven at Gate #5 (test mode): a $250.00 performance booking
-- funded, completed, and RELEASED — the release flip stamps
-- platform_fee_cents / artist_payout_cents (the rail's 15% split:
-- $37.50 fee / $212.50 artist) on the booking row and notifies the
-- artist "You were paid $212.50" — yet the money existed in NO payout
-- surface: lib/seller-earnings.ts reconciled only eight rails into
-- pending_payout_ledger, its unified summary had no bookings reader,
-- and the Stripe Connect cash-out pays only the pending figure — so
-- a released booking's artist net was stranded forever while the
-- artist had been told it landed. This is the exact W8 shoutout/tip
-- defect pattern (migration 0323) on the one escrow rail that pile
-- did not cover; the C-25 briefs rail (0324) is the closest sibling.
--
-- This migration only widens the source_kind CHECK so the
-- reconciliation can accrue the rail (amounts are copied by the sync
-- in api-server lib/seller-earnings.ts from the release stamps the
-- booking row already records — gross is the held amount that was
-- split, platform_fee_cents + artist_payout_cents, so a release
-- shrunk by a partial refund accrues what actually released). No fee
-- math changes here.
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE pending_payout_ledger
  DROP CONSTRAINT IF EXISTS pending_payout_ledger_source_kind_check;

ALTER TABLE pending_payout_ledger
  ADD CONSTRAINT pending_payout_ledger_source_kind_check
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip','ugc_brief','performance_booking'));
