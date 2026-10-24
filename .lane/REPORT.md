# Lane W3-4 — Bookings hardening (Stack-100 #3, wave 3)

Branch `stack29/w3-bookings-hardening` off `stack29/bookings` @ d8573d82.
Base input gap, stated plainly: the task pointed at
`~/workspace/bdv-wt-bookings/.lane/REPORT.md` for the exact SQL sketch —
**that file does not exist** (the v1 lane's DESIGN.md references it, but
only DESIGN.md + logs were ever committed). The design here is built
from DESIGN.md + the task scope directly; nothing was copied from a
missing sketch.

## What was built

**New lib `artifacts/api-server/src/lib/service-bookings.ts`** — the
hardened store, raw SQL like every store_orders access in the routes:
- `serviceBookingsAvailable()` — information_schema probe (portable:
  real Postgres AND pg-mem; `to_regclass` is NOT, probed), 5s
  single-slot cache + `__resetServiceBookingsProbe()` test seam.
- `placeServiceBooking()` — dual-write insert/upsert by order_id;
  lazily expires lapsed holds for the overlapping range first;
  translates DB guard violations into `BookingSlotConflictError`.
- `confirmServiceBooking()` — held/expired → confirmed; a violation
  returns `"conflict"` (hold lapsed, slot re-sold) instead of throwing.
- `cancelServiceBooking()` — frees the slot; idempotent.
- `fetchServiceBookingRanges()` / `fetchServiceBookingOrderIds()`.
- `reconcileServiceBookings()` — code-side backfill twin of the
  migration's step 4 (existence pre-check + ON CONFLICT race guard;
  conflicts counted, never silent).
- `isBookingConflictError()` — SQLSTATE 23P01 (incl. nested cause),
  `service_bookings`-named 23505; unrelated unique violations are NOT
  relabelled.
- The migration SQL lives here as constants
  (`SERVICE_BOOKINGS_EXTENSION_SQL` / `_TABLE_SQL` / `_EXCLUSION_SQL`)
  so code, tests, and MIGRATION-NEEDED.md cannot drift.

**Routes (`routes/storefront.ts`)** — dual-path writes, trailer kept in
sync everywhere:
- Checkout hold tx: order insert + `placeServiceBooking(held, +30m)`.
  On a DB-guard conflict the hold order is **explicitly DELETEd in the
  same transaction** and the buyer gets the existing 409 SLOT_TAKEN —
  no reliance on rollback (see probe finding below).
- Stripe-session-create failure: hold release now also cancels the
  hardened row.
- Verify: hold-flip also `confirmServiceBooking()` (best-effort, logged;
  a "conflict" outcome rides the existing honored-but-clash-notified
  path — a completed payment never fails on this). The hold-missing
  metadata path places a confirmed row best-effort.
- Claim ($0) tx: order insert + `placeServiceBooking(confirmed)`; on
  conflict the claim unwinds explicitly (order deleted, in-tx inventory
  claim restored) → 409 SLOT_TAKEN.
- Booking-cancel: after the order flip, `cancelServiceBooking()`
  best-effort.
- `fetchTakenRanges()` is now the **reconciliation union**: an order
  with a hardened row is represented by that row; trailer-only (v1
  legacy) orders count from their trailers; a trailer that says
  cancelled **vetoes** its hardened row. Slots endpoint, checkSlot, and
  verify's clash check all read through it. The bookings LIST stays
  trailer-driven by design — the trailer is the display record
  (timezones/refund state live only there), so legacy and hardened
  bookings list identically.

**No drizzle schema** for service_bookings (hard rule 2): all access is
raw SQL, and a schema entry pre-migration would make any future
full-row select crash the pre-migration tree. Noted for the join in
MIGRATION-NEEDED.md. **No file was written to `lib/db/migrations/`.**

## Pre-migration behavior (table absent)

Bookings work exactly on the v1 rails: probe says absent → every write
is a no-op, reads are trailer-only, confirm reports `"absent"`.
Proven by: the 42 pre-existing tests running in the unchanged harness
(no table) — 42/42 green — plus a dedicated lib test (absent-table
describe) asserting every helper degrades without throwing.

## Post-migration behavior (table present)

Holds/confirms/cancels write through the table in the same
transactions as their orders; the DB guards are the final word:
btree_gist exclusion constraint (any overlap) + partial unique index
on (product_id, slot_start) for active rows (same-slot tie-breaker —
same start + positive duration always overlaps, so it is sound alone).
Expired holds never block: range reads skip lapsed holds and the write
path flips them to `expired`. Legacy trailer-only bookings keep
blocking and listing, and reconcile/backfill gives them rows without
double-counting.

## pg-mem findings (probed, logs in .lane/logs/)

- pg-mem 3.0.14 **cannot parse** `CREATE EXTENSION btree_gist`,
  `tstzrange`, `EXCLUDE USING gist`, or plpgsql triggers
  (probe-excl.log, probe-trig.log). The harness therefore applies the
  migration's table DDL with the extension + exclusion statements
  elided (the codebase's own precedent — cf. the IS NOT DISTINCT FROM
  elision in storefront.ts), the partial unique index DOES execute and
  enforce in pg-mem, and the exclusion-violation translation is pinned
  against a runner raising the real 23P01 at the seam. The exclusion
  clause itself is executable only on real Postgres — stated, not
  papered over.
- pg-mem through this harness **does not roll back** `db.transaction`
  (probe-rollback.log: an insert survives a thrown transaction). The
  code therefore never relies on rollback for conflict cleanup — it
  voids explicitly. This is strictly safer on real Postgres too.

## Evidence (finished logs in .lane/logs/, --maxWorkers=1, sequential)

- Existing 42 (pre-migration harness): booking libs 18/18 +
  storefront-bookings 12/12 + storefront-bookings-cancel 12/12
  (test-final-libs.log, test-final-existing-routes.log). An earlier
  combined run showed 2 timeouts in the cancel file; root cause was
  the uncached information_schema probe under VM load — fixed with the
  5s probe cache; the cancel suite then passed 12/12 standalone
  (test-cancel-rerun.log) and in the final combined run.
- New lib suite `service-bookings.test.ts`: **9/9** (test-final-libs.log
  combined 27/27).
- New route suite `storefront-bookings-hardened.test.ts`: **7/7**
  (test-final-hardened.log) — dual-write lifecycle, concurrent holds
  (exactly one wins, loser 409 SLOT_TAKEN, one held order + one row;
  also green on a repeat run, test-concurrent-2.log), cancel frees at
  both layers, expired hold flips to `expired`, legacy blocks + lists
  + backfills, trailer-cancel veto, claim rail writes confirmed row.
- Typecheck: `tsc -p tsconfig.json --noEmit` exit 0, empty log
  (typecheck-final.log), after the final code change.
- Setup verified: @workspace/db + @workspace/api-zod readlink into
  THIS worktree at root, artifacts/api-server, artifacts/bow-down-
  visuals, lib/db, lib/api-zod; lib dists built in-worktree
  (build-db.log, build-zod.log); TMPDIR in-worktree.

## Migration hold (for the join)

`.lane/MIGRATION-NEEDED.md` — one idempotent file: btree_gist
extension, service_bookings table + order/product indexes + partial
unique slot_start index, the exclusion constraint, and a per-row
guarded backfill decoding live bk1 trailers (skips cancelled + lapsed
holds). Join numbers it, lands it, done — no code change needed after.

## Commits (no push)

0593739c lib · 507fa546 route dual-path · c2467259 closure fix ·
52d832b5 probe cache · 0322fa34 lib suite · 74e09140 hardened route
suite · final report commit (this file). Tip: see final message.
