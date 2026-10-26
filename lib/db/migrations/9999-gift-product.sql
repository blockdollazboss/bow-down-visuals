-- 9999-gift-product.sql — PROVISIONAL NUMBER (Wave-4 #45 Gift-This-Product).
-- The integrator MUST renumber this file to the next free migration
-- number at join time. Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.
--
-- Gift-This-Product: a buyer purchases a real store product AS A GIFT
-- for another member, paying Visual Bucs on the existing credits rail
-- (test mode). The paid value is held on the row as the recipient's
-- claimable credit until they claim it — unclaimed value is never
-- forfeited to the platform or the seller. The store's flat 5%
-- platform fee is recorded at purchase (feeSplit) and settled exactly
-- once by the claim's store_orders row (stripe_session_id='gift:{id}').

CREATE TABLE IF NOT EXISTS product_gifts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           UUID REFERENCES store_products(id) ON DELETE SET NULL,
  profile_id           UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  product_title        TEXT NOT NULL DEFAULT '',
  product_kind         TEXT NOT NULL DEFAULT 'digital',
  buyer_user_id        UUID NOT NULL,
  recipient_user_id    UUID,
  recipient_email      TEXT NOT NULL,
  gift_message         TEXT,
  quantity             INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_cents         INT NOT NULL CHECK (amount_cents > 0),
  credits_charged      INT NOT NULL CHECK (credits_charged > 0),
  platform_fee_cents   INT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  creator_amount_cents INT NOT NULL DEFAULT 0 CHECK (creator_amount_cents >= 0),
  claimable_cents      INT NOT NULL CHECK (claimable_cents >= 0 AND claimable_cents <= amount_cents),
  idempotency_key      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled','awaiting_claim','claimed')),
  delivery_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at         TIMESTAMPTZ,
  claimed_at           TIMESTAMPTZ,
  claim_order_id       UUID,
  resend_count         INT NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  last_resent_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_gifts_idem_ux
  ON product_gifts (idempotency_key);
CREATE INDEX IF NOT EXISTS product_gifts_recipient_user_idx
  ON product_gifts (recipient_user_id);
CREATE INDEX IF NOT EXISTS product_gifts_recipient_email_idx
  ON product_gifts (recipient_email);
CREATE INDEX IF NOT EXISTS product_gifts_buyer_idx
  ON product_gifts (buyer_user_id);
CREATE INDEX IF NOT EXISTS product_gifts_status_delivery_idx
  ON product_gifts (status, delivery_at);

CREATE TABLE IF NOT EXISTS product_gift_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id         UUID NOT NULL REFERENCES product_gifts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('charge','claim_settle','resend')),
  amount_cents    INT NOT NULL DEFAULT 0,
  ref             TEXT,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_gift_ledger_idem_ux
  ON product_gift_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS product_gift_ledger_gift_idx
  ON product_gift_ledger (gift_id);
