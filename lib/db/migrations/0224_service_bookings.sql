-- 0224: service_bookings hardening (Stack-100 #3, wave 3, lane 4 —
-- numbered at the join). One row per calendar booking, keyed by
-- order_id (the store_orders row stays the money record; the trailer
-- stays the display/fallback record and is kept in sync by the code).
-- A btree_gist exclusion constraint is the final double-book guard:
-- no two ACTIVE (held/confirmed) rows for one product may overlap in
-- [slot_start, slot_end). A partial unique index on (product_id,
-- slot_start) for active rows is the same-slot tie-breaker.
-- The backfill copies every live v1 trailer booking into the table;
-- decode is per-row guarded so one malformed legacy note can never
-- fail the migration. Expired holds carry hold_expires_at and the
-- CODE lazily flips lapsed holds to 'expired' on the write path (an
-- exclusion predicate cannot call now()).
-- Idempotent throughout. No BEGIN/COMMIT, no CONCURRENTLY.

-- 1. btree_gist: equality on uuid (product_id) inside a GiST exclusion.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Table + indexes.
CREATE TABLE IF NOT EXISTS service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'held',
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_bookings_slot_sane CHECK (slot_end > slot_start),
  CONSTRAINT service_bookings_status_sane CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_order_ux ON service_bookings (order_id);
CREATE INDEX IF NOT EXISTS service_bookings_product_idx ON service_bookings (product_id, status, slot_start);
CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_slot_start_ux ON service_bookings (product_id, slot_start) WHERE status IN ('held', 'confirmed');

-- 3. The exclusion constraint.
ALTER TABLE service_bookings DROP CONSTRAINT IF EXISTS service_bookings_no_overlap;
ALTER TABLE service_bookings ADD CONSTRAINT service_bookings_no_overlap
  EXCLUDE USING gist (
    product_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('held', 'confirmed'));

-- 4. Backfill: live v1 trailer bookings gain hardened rows.
DO $$
DECLARE
  o record;
  payload text;
  rec jsonb;
BEGIN
  FOR o IN
    SELECT id, buyer_user_id, profile_id, product_id, status, fulfillment_note, created_at
    FROM store_orders
    WHERE product_kind = 'service'
      AND fulfillment_note LIKE '%⟦bk1:%'
      AND status IN ('booking_held', 'completed')
  LOOP
    BEGIN
      payload := substring(o.fulfillment_note from '⟦bk1:([A-Za-z0-9_-]+)⟧');
      IF payload IS NULL THEN CONTINUE; END IF;
      payload := replace(replace(payload, '-', '+'), '_', '/');
      payload := payload || repeat('=', (4 - length(payload) % 4) % 4);
      rec := convert_from(decode(payload, 'base64'), 'UTF8')::jsonb;
      IF rec->>'st' = 'cancelled' THEN CONTINUE; END IF;
      IF o.status = 'booking_held'
         AND o.created_at + interval '30 minutes' <= now() THEN CONTINUE; END IF;
      INSERT INTO service_bookings
        (order_id, product_id, profile_id, buyer_user_id, slot_start, slot_end, status, hold_expires_at)
      VALUES (
        o.id, o.product_id, o.profile_id, o.buyer_user_id,
        (rec->>'s')::timestamptz, (rec->>'e')::timestamptz,
        CASE WHEN o.status = 'booking_held' THEN 'held' ELSE 'confirmed' END,
        CASE WHEN o.status = 'booking_held' THEN o.created_at + interval '30 minutes' ELSE NULL END
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'service_bookings backfill skipped order %: %', o.id, SQLERRM;
    END;
  END LOOP;
END $$;
