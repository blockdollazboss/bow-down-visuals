-- 9999 (PROVISIONAL — renumber at join): Paid Priority DMs (Wave-4 #44).
--
-- Fans pay Visual Bucs (TEST MODE, existing credit rails) to send one
-- priority DM into a creator's priority inbox lane inside Messages.
-- The honesty rule is the feature: creator-set price, stated reply
-- window, unanswered paid messages auto-refund in full, and a block
-- always wins (blocked fans cannot buy; a delivery refused by a block
-- refunds exactly once).
--
-- priority_dm_settings: one row per creator. opted_in defaults false;
-- min_price_vb has NO default — it stays NULL until the creator types
-- their own price. There is no platform default/floor price anywhere.
--
-- priority_dms: one row per paid message. amount_vb is locked at
-- purchase. status is the exactly-once escrow guard:
--   held -> replied           (creator answered in window; escrow pays out)
--   held -> refunded_expired  (window closed unanswered; fan made whole)
--   held -> refunded_blocked  (delivery refused by a block; fan made whole)
-- Money moves only on the held -> terminal transition, and every
-- credit_usage ledger row carries a deterministic idempotency key
-- derived from this row's id (priority-dm:<id>:charge / :refund / :payout).
-- idempotency_key is UNIQUE so a retried purchase can never double-charge.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS priority_dm_settings (
  creator_user_id uuid PRIMARY KEY,
  opted_in boolean NOT NULL DEFAULT false,
  min_price_vb integer,
  reply_window_hours integer NOT NULL DEFAULT 48,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS priority_dms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  sender_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  amount_vb integer NOT NULL,
  status text NOT NULL DEFAULT 'held',
  idempotency_key text NOT NULL,
  reply_deadline timestamptz NOT NULL,
  replied_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS priority_dms_idempotency_uidx ON priority_dms (idempotency_key);
CREATE INDEX IF NOT EXISTS priority_dms_creator_status_idx ON priority_dms (creator_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS priority_dms_sender_idx ON priority_dms (sender_user_id, created_at);
CREATE INDEX IF NOT EXISTS priority_dms_conversation_idx ON priority_dms (conversation_id);
