# MIGRATION NEEDED — service_bookings hardening (Stack-100 #3, wave 3, lane 4)

**For the join to number and land** (next free number at join time; the
numbering was 0205+ when this lane ran — the join owns the final number).
**Nothing in this lane wrote to `lib/db/migrations/`** — this file is the
deliverable. Idempotent throughout: safe to re-run as a no-op. No
BEGIN/COMMIT, no CONCURRENTLY (house rules for `migrate-boot.mjs`).

The code side already ships inert-without-this-migration: every hardened
path probes `information_schema` for the table and degrades to the v1
trailer rails while it is absent (see
`artifacts/api-server/src/lib/service-bookings.ts`). The moment this
migration lands, dual-writing lights up with no code change.

## What it creates

- `service_bookings` — one row per calendar booking, keyed by
  `order_id` (the store_orders row stays the money record; the trailer
  stays the display/fallback record and is kept in sync by the code).
- A **btree_gist exclusion constraint** — the final double-book guard:
  no two ACTIVE (`held`/`confirmed`) rows for one product may overlap
  in `[slot_start, slot_end)`.
- A partial **unique index on (product_id, slot_start)** for active
  rows — the same-slot tie-breaker (same start + positive duration
  always overlaps, so it is sound on its own).
- A **backfill** copying every live v1 trailer booking into the table.

Note on expired holds: an exclusion predicate cannot call `now()`
(predicates must be immutable), so `held` rows carry `hold_expires_at`
and the CODE lazily flips lapsed holds to `expired` (leaving the
predicate) on the write path; the backfill likewise skips lapsed holds.

## Exact SQL (verbatim from lib/service-bookings.ts constants)

```sql
-- 1. btree_gist: equality on uuid (product_id) inside a GiST exclusion.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Table + indexes (SERVICE_BOOKINGS_TABLE_SQL).
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
-- Same-slot tie-breaker: two ACTIVE bookings for one product can never
-- share a slot_start (same start + positive duration always overlaps),
-- so this partial unique index is sound on its own and — unlike the
-- exclusion clause below — is enforceable by every Postgres-compatible
-- engine, including the pg-mem test harness. The exclusion constraint
-- remains the general guard for different-duration overlaps.
CREATE UNIQUE INDEX IF NOT EXISTS service_bookings_slot_start_ux ON service_bookings (product_id, slot_start) WHERE status IN ('held', 'confirmed');

-- 3. The exclusion constraint (SERVICE_BOOKINGS_EXCLUSION_SQL).
ALTER TABLE service_bookings DROP CONSTRAINT IF EXISTS service_bookings_no_overlap;
ALTER TABLE service_bookings ADD CONSTRAINT service_bookings_no_overlap
  EXCLUDE USING gist (
    product_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&
  ) WHERE (status IN ('held', 'confirmed'));

-- 4. Backfill: live v1 trailer bookings gain hardened rows.
--    The bk1 payload is base64url JSON between the trailer markers;
--    decode is per-row guarded so one malformed legacy note can never
--    fail the migration. Lapsed holds and cancelled records are
--    skipped — they block nothing.
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
```

## Join checklist

1. Number the file, land it under `lib/db/migrations/`.
2. No drizzle schema change is required by the code (all access is raw
   SQL, like store_orders in routes/storefront.ts). If the join wants
   a schema entry for completeness, add it in the same commit — the
   code does not import one, deliberately (a schema entry pre-migration
   would make any future full-row select crash the pre-migration tree).
3. After deploy, `reconcileServiceBookings` (lib) is an optional
   code-side twin of step 4 for any stragglers; the slots/bookings
   reads are correct either way because they union trailer-only rows.
