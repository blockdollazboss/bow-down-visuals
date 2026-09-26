-- Sponsor marketplace v2 — escrow payments + application workflow.
-- Extends 0010_sponsor_deals.sql (which created sponsor_deals + sponsor_applications).
--
-- Deal lifecycle: active → funded (brand funds escrow) → in_progress
-- (creator starts) → completed (creator delivers) → paid (brand releases).
-- Application lifecycle: pending → accepted | rejected.
--
-- Run ONCE against the production database (Render Postgres) before the
-- matching code deploys. Idempotent: safe to run multiple times.
--
-- Must stay in sync with lib/db/src/schema/sponsor-deals.ts
-- (boot-time `drizzle-kit push` derives the same shape from the schema).

-- ── sponsor_deals: escrow + accepted-creator tracking ─────────────────
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS agreed_amount_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS escrow_status TEXT NOT NULL DEFAULT 'unfunded';
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS creator_payout_cents INTEGER;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS accepted_application_id UUID;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS accepted_user_id TEXT;
ALTER TABLE sponsor_deals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sponsor_deals_escrow_status_idx ON sponsor_deals (escrow_status);
CREATE INDEX IF NOT EXISTS sponsor_deals_accepted_user_idx ON sponsor_deals (accepted_user_id);

-- ── sponsor_applications: review workflow + portfolio link ─────────────
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE sponsor_applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sponsor_applications_status_idx ON sponsor_applications (status);

-- ── sponsor_payouts: platform-fee ledger for released deals ────────────
-- One row per released deal: gross = what the brand funded,
-- fee = the Bow Down Visuals cut (15%), net = the creator's payout.
CREATE TABLE IF NOT EXISTS sponsor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  creator_user_id TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'released',
  stripe_transfer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS sponsor_payouts_creator_idx ON sponsor_payouts (creator_user_id);
CREATE INDEX IF NOT EXISTS sponsor_payouts_deal_idx ON sponsor_payouts (deal_id);
