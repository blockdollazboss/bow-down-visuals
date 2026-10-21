-- 0104 — Stripe Connect payouts (money-out).
-- creator_payouts: ledger of transfers sent to creators' Stripe Connect
-- (Express) accounts. Creator earnings accrue as pending balances in
-- digital_sales.creator_amount_cents + store_orders.creator_amount_cents;
-- a payout row settles part of that balance via stripe.transfers.create.
-- Connect account fields on creator_profiles track onboarding state
-- (kept in sync by the account.updated webhook).
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS creator_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS creator_payouts_profile_idx
  ON creator_payouts (profile_id);
-- NULL transfer ids are ignored by the unique index, so only completed
-- transfers are uniqueness-guarded (idempotency safety net).
CREATE UNIQUE INDEX IF NOT EXISTS creator_payouts_transfer_uidx
  ON creator_payouts (stripe_transfer_id);

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;
