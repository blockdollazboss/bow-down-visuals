-- 0182: Payment reversals — the refund / chargeback clawback trail
-- (payments defect D1, ~/workspace/payments-test-matrix.md).
--
-- Until now the central Stripe webhook had NO charge.refunded /
-- charge.dispute.closed handler: a pack refunded from the Stripe
-- dashboard kept its Visual Bucs, a refunded membership kept its
-- entitlement, refunded beats/digital/shop purchases kept access —
-- the platform ate the loss and the goods stayed. The webhook now
-- reverses what the original payment granted, keyed off the existing
-- payment/grant records (stripe_payments, and the per-rail grant rows
-- keyed on the checkout session id).
--
-- payment_reversals: one row per CHARGE (UNIQUE stripe_charge_id),
-- written insert-first by lib/payment-reversals.ts BEFORE any money
-- moves — the same claiming discipline as stripe_payments (P0-7/9/24).
-- The row is BOTH the idempotency claim and the admin audit trail:
--   rail                 which rail's grant was reversed ('credit_pack',
--                        'membership', 'beat_license', 'digital_sale',
--                        'marketplace_shop', 'storefront_order',
--                        'live_shop_sale', 'tip_jar_tip',
--                        'shoutout_request', 'sponsor_deal',
--                        'branding_order', 'subscription',
--                        'unidentified').
--   trigger              'charge.refunded' | 'charge.dispute.closed'.
--   granted_credits      VB the original payment granted (pack rail).
--   credits_clawed       VB actually debited back so far (cumulative —
--                        partial refunds claw pro-rata; a retry resumes
--                        from this number, never double-claws).
--   referral_credits_clawed  VB debited back from the referrer whose
--                        25% revenue share the purchase paid.
--   refunded_cents_seen  highest cumulative amount_refunded processed.
--   dispute_lost         a lost dispute forces a FULL reversal.
--   entitlement_revoked  the rail's entitlement/access was revoked.
--   seller_reversed      the seller-side ledger no longer counts the
--                        sale (payout/earnings exclusion applied).
--   shortfall_credits    VB that could not be recovered because the
--                        balance could not cover it — recorded honestly,
--                        the balance is NEVER driven negative.
--   status               'processing' | 'completed' |
--                        'partial_shortfall' | 'failed' |
--                        'needs_manual_review' (charge identified but
--                        not auto-reversible, or not identifiable at
--                        all — the row IS the manual work item; the
--                        webhook answers 200 so Stripe never retry-loops
--                        a case a retry cannot fix).
--   details              jsonb evidence: session id, grant row ids,
--                        per-step outcomes, shortfall notes.
--
-- digital_sales gains the status vocabulary store_orders already
-- carries ('completed' | 'refunded') + refunded_at, so a refunded
-- download sale drops out of payout/earnings sums and its download
-- links are expired at reversal time.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS payment_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT,
  stripe_charge_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  trigger TEXT NOT NULL,
  rail TEXT NOT NULL,
  user_id UUID,
  session_id TEXT,
  granted_credits INTEGER NOT NULL DEFAULT 0,
  credits_clawed INTEGER NOT NULL DEFAULT 0,
  referral_credits_clawed INTEGER NOT NULL DEFAULT 0,
  refunded_cents_seen INTEGER NOT NULL DEFAULT 0,
  charge_amount_cents INTEGER,
  dispute_lost BOOLEAN NOT NULL DEFAULT false,
  entitlement_revoked BOOLEAN NOT NULL DEFAULT false,
  seller_reversed BOOLEAN NOT NULL DEFAULT false,
  shortfall_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_reversals_charge_ux
  ON payment_reversals (stripe_charge_id);

CREATE INDEX IF NOT EXISTS payment_reversals_status_idx
  ON payment_reversals (status, created_at);

CREATE INDEX IF NOT EXISTS payment_reversals_user_idx
  ON payment_reversals (user_id, created_at);

ALTER TABLE digital_sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE digital_sales ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
