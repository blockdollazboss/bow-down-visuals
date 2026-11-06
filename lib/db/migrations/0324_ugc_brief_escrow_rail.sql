-- 0324: UGC Briefs Board — the on-site escrow rail (owner ruling
-- C-25, Nov 5, 2026: "Build it — safe on-site payments for briefs").
--
-- WHY: the Briefs Board (Promote) was the last creator-services
-- marketplace whose money deliberately moved off-site — ugc_briefs
-- had no price, fee, or escrow columns at all, and every brief told
-- both sides "payment is arranged between the brand and the creator
-- directly": 0% fee captured, no escrow protection for either side,
-- no Earnings record. This migration gives a brief an OPTIONAL
-- agreed price and the money columns of the escrow rail cloned from
-- sponsor deals (fund at claim through embedded checkout → held →
-- approval releases at the ruled 5% → close-on-funded refunds):
--
--   price_cents             the agreed price set at post time;
--                           NULL = a free brief, byte-identical to
--                           before (no rail, off-site note intact).
--   escrow_status           unfunded | funding | funded | released |
--                           refunded — the sponsor vocabulary.
--   stripe_session_id /     the funding Checkout session + its
--   stripe_payment_intent_id  payment intent (settlement is always
--                           cross-checked against these records).
--   platform_fee_cents /    the split stamps: the NOMINAL 5% split at
--   creator_payout_cents    funding, overwritten at release with the
--                           split of what was actually held.
--   released_amount_cents / the release itself: the held gross that
--   released_at             was split, and when.
--
-- The same migration widens pending_payout_ledger.source_kind with
-- the 'ugc_brief' kind (0323 is the exact precedent) so a released
-- brief accrues into the creator's existing payout pot through
-- lib/seller-earnings' reconciliation.
--
-- Idempotent: safe to re-run. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS price_cents integer;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS escrow_status text NOT NULL DEFAULT 'unfunded';
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS stripe_session_id text;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS platform_fee_cents integer;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS creator_payout_cents integer;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS released_amount_cents integer;
ALTER TABLE ugc_briefs ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE pending_payout_ledger
  DROP CONSTRAINT IF EXISTS pending_payout_ledger_source_kind_check;

ALTER TABLE pending_payout_ledger
  ADD CONSTRAINT pending_payout_ledger_source_kind_check
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip','ugc_brief'));
