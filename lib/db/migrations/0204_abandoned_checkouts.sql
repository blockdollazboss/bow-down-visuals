-- 0204: Abandoned-checkout records for store + storefront Stripe
-- checkouts (closes the abandoned-checkout automation's blind spot).
--
-- The gap: the abandoned_checkout email automation (0198) reads
-- shop_events 'pending_sale' rows, and only the shop card checkout
-- writes those. The other two creator-goods card rails — the digital
-- store (routes/store.ts) and the profile storefront
-- (routes/storefront.ts) — write NOTHING when a checkout starts:
-- their sale rows exist only after payment. A fan who starts one of
-- those checkouts and never pays leaves no trace the trigger can
-- see, and the UI copy has had to say exactly that.
--
-- The honest signal already arrives: Stripe delivers
-- checkout.session.expired to the central webhook for every unpaid
-- session, and both rails stamp their sessions with the linkage the
-- trigger needs — metadata buyer_user_id (the buyer is always a
-- signed-in user; both checkout routes are requireAuth) and
-- profile_id (the creator whose goods they are). The webhook's
-- expired branch now records the abandonment here; the automation
-- sweeper reads these rows exactly like the shop pending rows, the
-- buyer's address resolved through the auth rail at evaluation time.
--
-- Idempotency is the unique stripe_session_id: a replayed webhook
-- inserts nothing twice (ON CONFLICT DO NOTHING in the recorder),
-- and the send itself stays deduped by email_automation_sends'
-- (automation, trigger ref) unique index, as for every trigger.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  profile_id UUID NOT NULL,
  buyer_user_id UUID NOT NULL,
  item_ref TEXT,
  amount_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS abandoned_checkouts_session_ux ON abandoned_checkouts (stripe_session_id);
CREATE INDEX IF NOT EXISTS abandoned_checkouts_profile_idx ON abandoned_checkouts (profile_id, created_at);
