-- 0297 (stack400 lane 2): stamp the BUYER's account id on shop sale lines.
--
-- The Oct 26 + Oct 28 payments gates both lost the buyer's delivery the
-- same way: shop_events carried only buyer_email — a free-text field the
-- buyer may leave blank or type differently from their account email —
-- and shop_deliveries resolved the buyer from that email alone. A
-- signed-in buyer who left the field blank got a delivery row keyed to
-- nobody, invisible in their library forever.
--
-- buyer_user_id is stamped at checkout from the buyer's verified session
-- when one rides along (optional auth — guest checkout keeps working and
-- keeps the email key). The paid flip carries it into shop_deliveries,
-- whose buyer library matches on account id OR checkout email.
-- Idempotent; no BEGIN/COMMIT; no CONCURRENTLY.

ALTER TABLE shop_events ADD COLUMN IF NOT EXISTS buyer_user_id uuid;

CREATE INDEX IF NOT EXISTS shop_events_buyer_user_idx ON shop_events (buyer_user_id);
