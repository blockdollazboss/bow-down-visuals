-- 0236: Back-in-stock alerts (Wave 4 #37) — "tell me when it's back".
--
-- A signed-in fan taps once on a sold-out store product and waits here:
-- one row per (user, product), status 'waiting'. When the product's
-- stock returns, the restock fan-out claims the waiting rows exactly
-- once (status-guarded flip to 'notified' — the RETURNING set is the
-- fan-out list), sends one in-app notification per fan (plus one email
-- only when the fan is already a confirmed subscriber of the seller's
-- email list), and the subscription is CONSUMED: a notified row never
-- fires again, and re-subscribing re-arms the same row to 'waiting'.
--
-- The seller's demand signal is COUNT(*) of 'waiting' rows per product.
-- Alerts are about stock only; license keys (#35) mint at fulfillment
-- and never interact with this table.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS stock_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'waiting',
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  CHECK (status IN ('waiting', 'notified'))
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_alerts_user_product_ux
  ON stock_alerts (user_id, product_id);
CREATE INDEX IF NOT EXISTS stock_alerts_product_status_idx
  ON stock_alerts (product_id, status);
CREATE INDEX IF NOT EXISTS stock_alerts_user_idx
  ON stock_alerts (user_id);
