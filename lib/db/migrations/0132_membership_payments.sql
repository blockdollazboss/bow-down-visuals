-- 0132: Money starts moving — real (TEST-mode) payment processing for
-- fan memberships, beat licenses, live shopping, and store name-your-price.
--
-- fan_tiers: creator toggles for the 7-day free trial and the annual
-- discount fans get when they pay for a year up front.
-- fan_members: paid joins carry the fan's real account id, the billing
-- period, the current paid period (start/end = the membership's expiry /
-- renewal date), an optional trial end, and the checkout session id as
-- the idempotency key. Gifted seats record who paid.
-- fan_membership_gifts: one row per gift purchase so purchaser and
-- recipient both see an honest state.
-- beat_licenses / live_shop_sales: checkout session id (idempotency) —
-- a license completes / a sale counts as paid ONLY after a verified paid
-- session. live_shop_sales.status separates real 'paid' sales from the
-- legacy manually-recorded 'test' sales; existing rows stay 'test'.
-- profile_tracks / profile_videos: name-your-price opt-in + minimum.
--
-- Idempotent: safe to re-run as a no-op.

ALTER TABLE fan_tiers ADD COLUMN IF NOT EXISTS trial_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fan_tiers ADD COLUMN IF NOT EXISTS annual_discount_pct INTEGER NOT NULL DEFAULT 0;

ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS fan_user_id UUID;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fan_members ADD COLUMN IF NOT EXISTS gifted_by_user_id UUID;
CREATE INDEX IF NOT EXISTS fan_members_fan_user_id_idx ON fan_members (fan_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fan_members_stripe_session_ux ON fan_members (stripe_session_id);

CREATE TABLE IF NOT EXISTS fan_membership_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL,
  creator_user_id UUID NOT NULL,
  purchaser_user_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  member_id UUID,
  stripe_session_id TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fan_membership_gifts_purchaser_idx ON fan_membership_gifts (purchaser_user_id);
CREATE INDEX IF NOT EXISTS fan_membership_gifts_recipient_idx ON fan_membership_gifts (recipient_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fan_membership_gifts_session_ux ON fan_membership_gifts (stripe_session_id);

ALTER TABLE beat_licenses ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS beat_licenses_stripe_session_ux ON beat_licenses (stripe_session_id);

ALTER TABLE live_shop_sales ADD COLUMN IF NOT EXISTS buyer_user_id UUID;
ALTER TABLE live_shop_sales ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE live_shop_sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'test';
CREATE UNIQUE INDEX IF NOT EXISTS live_shop_sales_stripe_session_ux ON live_shop_sales (stripe_session_id);

ALTER TABLE profile_tracks ADD COLUMN IF NOT EXISTS pwyw_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profile_tracks ADD COLUMN IF NOT EXISTS pwyw_min_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profile_videos ADD COLUMN IF NOT EXISTS pwyw_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profile_videos ADD COLUMN IF NOT EXISTS pwyw_min_cents INTEGER NOT NULL DEFAULT 0;
