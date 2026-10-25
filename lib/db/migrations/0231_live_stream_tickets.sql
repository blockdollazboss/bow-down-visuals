-- 0231: Ticketed live streams — pay-per-view doors on Go Live (Wave 4 #31).
-- A creator can put a Visual Bucs ticket price (and an optional seat
-- capacity) on a stream at Go Live setup. The door lives on the stream
-- row (ticket_price_vb NULL/0 = free, exactly as before; ticket_capacity
-- NULL = unlimited seats); a purchase is one live_stream_tickets row —
-- a fan -> creator VB transfer on the same rails as stream tips, split
-- through lib/platform-fees (PLATFORM_FEE_BPS, flat 5%).
-- Exactly-once is structural: the charge idempotency key is UNIQUE and
-- (stream_id, buyer_user_id) is UNIQUE, so no retry or double-tap can
-- charge a fan twice for the same show.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS ticket_price_vb integer;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS ticket_capacity integer;

CREATE TABLE IF NOT EXISTS live_stream_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  price_vb integer NOT NULL,
  platform_fee_vb integer NOT NULL DEFAULT 0,
  creator_net_vb integer NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  creator_credited_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_stream_tickets_stream_buyer_uniq
  ON live_stream_tickets (stream_id, buyer_user_id);
CREATE INDEX IF NOT EXISTS live_stream_tickets_stream_idx
  ON live_stream_tickets (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_stream_tickets_buyer_idx
  ON live_stream_tickets (buyer_user_id);
