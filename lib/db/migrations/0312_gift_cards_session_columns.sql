-- Gift cards — reconcile 0215's tables with the schema/code shape.
--
-- WHY THIS FILE EXISTS (stack1200 gift-card reconcile, 2026-11-02): on
-- any database built by the migration sequence, the gift-card feature
-- fails closed — the endpoints answer 503 GIFT_CARDS_UNAVAILABLE and
-- the World gift surfaces honestly report the rails down. Balance reads
-- (SELECT *) can work; every WRITE path in lib/gift-cards.ts hits a
-- column, constraint, or arbiter that 0215_gift_cards.sql never created.
--
-- Root cause: 0215 created the three gift tables in their ORIGINAL
-- shape (source_order_id / source_session_id; ledger keyed by card_id +
-- entry_type; reservations keyed by card_id with an 'active'-first
-- status machine). The feature was then rebuilt on the session shape —
-- the drizzle schema (lib/db/src/schema/gift-cards.ts) is that shape
-- and the live code writes exactly it — but the reconcile migration
-- was held for join-time numbering and never landed. This file is that
-- migration. The drift, verified statement-by-statement against
-- lib/gift-cards.ts (2026-11-02):
--
--   gift_cards
--     * issueGiftCard INSERTs product_id and stripe_session_id and
--       arbitrates ON CONFLICT (stripe_session_id) — all three absent
--       (42703 / 42P10). [the join-prep census finding]
--     * clawbackUnspentBalance writes status = 'refunded' — 0215's
--       status CHECK ('active','depleted','void','expired') rejects
--       it (23514).
--   gift_card_ledger
--     * Every money movement INSERTs (gift_card_id, kind, ...,
--       idempotency_key) ON CONFLICT (idempotency_key) — 0215 has
--       card_id / entry_type instead, no idempotency_key, and no
--       arbiter index; worse, card_id and entry_type are NOT NULL
--       with no default, so the code's inserts would fail 23502 even
--       with the new columns present.
--   gift_card_reservations
--     * reserveGiftCard INSERTs gift_card_id and status 'reserved',
--       and redeem/release UPDATE updated_at — 0215 has card_id (NOT
--       NULL, no default), no updated_at, and a status CHECK without
--       'reserved'. Its rail CHECK ('storefront','shop') also rejects
--       the rails live callers actually pass ('shops' from
--       routes/generate/shops.ts, 'digital-store' from
--       routes/store.ts) — the schema declares rail as plain text.
--
-- Reconcile strategy — additive and data-safe throughout (these tables
-- may hold 0215-era rows on staging/production):
--   * New columns land NULLABLE; the two card_id columns are backfilled
--     from their legacy twins; legacy NOT NULLs the code cannot satisfy
--     are relaxed, never tightened. No column is renamed or dropped:
--     legacy columns (source_session_id, entry_type, settled_at, ...)
--     stay as history.
--   * Status CHECKs are widened to the UNION of 0215's values and
--     the schema's, so no existing row can fail the new constraint.
--     Two CHECKs are dropped instead: the reservations rail CHECK
--     (the schema declares rail as plain text) and the ledger's
--     entry_type CHECK (it guards the retired column; its vocabulary
--     predates the live kinds). Remaining DB-vs-schema check drift is
--     a documented superset/subset in the safe direction only.
--   * gift_cards_session_ux is a PLAIN unique index (the schema's
--     uniqueIndex() declares no WHERE, and the code's conflict target
--     carries no predicate). Postgres treats NULLs as distinct in a
--     unique index, so every existing row (NULL in the new columns)
--     passes both new unique indexes — creation cannot fail on
--     0215-era data, and each paid session can still only ever issue
--     one card / one ledger movement per key.
--   * Ledger kind backfill maps only the kinds with an exact new-shape
--     counterpart ('issue', 'redeem'); legacy-only kinds
--     ('reserve','release','refund','void','expire') keep kind NULL —
--     their truth stays in entry_type.
--
-- Baseline note: 0312 > BASELINE (55) in lib/db/migrate-boot.mjs, so
-- the boot runner applies this file normally on fresh AND existing
-- databases — the ≤55 blind spot that bit 0033/0307 does not apply.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no
-- CONCURRENTLY. (CHECK pairs are DROP IF EXISTS + ADD, which is
-- self-idempotent as a pair.)

-- ── gift_cards ──────────────────────────────────────────────────────

ALTER TABLE gift_cards
  ADD COLUMN IF NOT EXISTS product_id uuid
  REFERENCES store_products(id) ON DELETE SET NULL;

ALTER TABLE gift_cards
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_session_ux
  ON gift_cards (stripe_session_id);

ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check
  CHECK (status IN ('active','depleted','refunded','void','expired'));

-- ── gift_card_ledger ────────────────────────────────────────────────

ALTER TABLE gift_card_ledger
  ADD COLUMN IF NOT EXISTS gift_card_id uuid
  REFERENCES gift_cards(id) ON DELETE CASCADE;

ALTER TABLE gift_card_ledger
  ADD COLUMN IF NOT EXISTS kind text;

ALTER TABLE gift_card_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE gift_card_ledger SET gift_card_id = card_id
  WHERE gift_card_id IS NULL AND card_id IS NOT NULL;

UPDATE gift_card_ledger SET kind = entry_type
  WHERE kind IS NULL AND entry_type IN ('issue','redeem');

ALTER TABLE gift_card_ledger ALTER COLUMN card_id DROP NOT NULL;
ALTER TABLE gift_card_ledger ALTER COLUMN entry_type DROP NOT NULL;

-- The 0215 entry_type CHECK is dropped: it guards the retired column,
-- its vocabulary predates the live kinds ('refund_clawback'), and the
-- code's inserts leave entry_type NULL. The schema's kind CHECK is
-- deliberately NOT re-created at DB level (kind stays DB-unchecked —
-- permissive drift in the safe direction, like the ledger balance
-- check the schema declares but 0215 never had).
ALTER TABLE gift_card_ledger DROP CONSTRAINT IF EXISTS gift_card_ledger_type_check;

CREATE UNIQUE INDEX IF NOT EXISTS gift_card_ledger_idem_ux
  ON gift_card_ledger (idempotency_key);

-- ── gift_card_reservations ──────────────────────────────────────────

ALTER TABLE gift_card_reservations
  ADD COLUMN IF NOT EXISTS gift_card_id uuid
  REFERENCES gift_cards(id) ON DELETE CASCADE;

ALTER TABLE gift_card_reservations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE gift_card_reservations SET gift_card_id = card_id
  WHERE gift_card_id IS NULL AND card_id IS NOT NULL;

ALTER TABLE gift_card_reservations ALTER COLUMN card_id DROP NOT NULL;

ALTER TABLE gift_card_reservations DROP CONSTRAINT IF EXISTS gift_card_reservations_status_check;
ALTER TABLE gift_card_reservations ADD CONSTRAINT gift_card_reservations_status_check
  CHECK (status IN ('active','reserved','redeemed','released','expired'));

ALTER TABLE gift_card_reservations DROP CONSTRAINT IF EXISTS gift_card_reservations_rail_check;

ALTER TABLE gift_card_reservations ALTER COLUMN status SET DEFAULT 'reserved';
