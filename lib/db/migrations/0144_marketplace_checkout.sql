-- 0144: Marketplace real card checkout (World Ring 2, item 2.26).
-- POST /api/storefronts/checkout used to RECORD a sale in shop_events the
-- moment the buyer clicked — no card was ever charged, yet analytics and
-- earnings counted it as a sale. Now a checkout writes PENDING rows first
-- (event_type='pending_sale', payment_status='pending'), opens a Stripe
-- Checkout session on the platform account (test mode), and the sale only
-- becomes a sale (event_type='sale', payment_status='paid', paid_at set)
-- when the session is confirmed paid — via POST
-- /api/storefronts/checkout/verify or the central Stripe webhook, both
-- running the same guarded flip, so replays never double-count.
-- Stripe Connect here is recipient/transfers-only (money-out to creators);
-- there are no destination charges anywhere in the house, so the seller is
-- recorded on the row (user_id = shop owner) and their net is settled later
-- through the existing creator-payout path — platform-account checkout is
-- the honest v1, Connect destination charges are a follow-on.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS checkout_group_id TEXT;

-- One checkout session can cover several cart lines (one row per line,
-- all sharing the session id), so this index is deliberately NOT unique:
-- idempotency lives in the guarded pending_sale -> sale flip, not here.
CREATE INDEX IF NOT EXISTS shop_events_stripe_session_idx
  ON shop_events (stripe_session_id);
CREATE INDEX IF NOT EXISTS shop_events_checkout_group_idx
  ON shop_events (checkout_group_id);
