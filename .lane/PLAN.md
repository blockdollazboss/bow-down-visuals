# PLAN — upg-bookings (Run 7 replacement worker, Oct 27 ~00:17 EDT)

Branch: stack200/upg-bookings @ base ecc63098 (verified clean, 0 commits ahead).
(Relocated prior .lane content was a stale editor-priority plan from a recycled
worktree — preserved at .lane/PRIOR-PLAN-editor-priority.md.)
Home feature: Paid Bookings (lib/service-bookings.ts).

## #167 Office Hours — UPGRADE of Paid Bookings
Audit scope (stack200-board.md, DEDUPE AUDIT #167): wave #5 built storefront service
products + lib/service-bookings.ts hardened slots + lib/booking-reminders.ts; also
World Office Hours (UPGRADE-PROGRAM 3.7). DELTA ONLY: VB-priced 1:1 slots sold under
Office Hours and held on the Messages video-call rails (List 2 #181). Existing
bookings run on the storefront/Stripe rail with NO VB price and NO Messages call.
Build: Office Hours slot type on the booking rails — VB price field + charge/refund
via the VB ledger (idempotent), booking surface marks the session as a Messages
video call (link to the existing video-call rails, do not rebuild calls), both themes.
Covered-check first: grep base for office-hours / VB price on bookings / call link.

## #158 Book the Artist — UPGRADE of Paid Bookings + Sponsors escrow
Audit scope (#158): wave #5 built lib/service-bookings.ts + storefront services;
routes/generate/sponsors.ts has the full escrow state machine. DELTA ONLY: a
promoter/venue-facing booking surface (dates, fee, venue facts) for performances,
fee held in ESCROW until the show completes, plain-words deal (#164) auto-attached.
Existing bookings are fan-bought storefront services — no escrow, no promoter door.
Build: performance booking type + escrow state on the sponsors escrow pattern,
promoter-facing surface (form + list), plain-words terms summary auto-generated
from the booking terms and attached to the record. Both themes.
Covered-check first: grep base for performance/venue/escrow on bookings.

## Rules
- Build ONLY the deltas above; dock into Paid Bookings workflow (MONEY step).
- Commit-ladder: bank each rung. Migrations: provisional 9999-*.sql only.
- Suites + typechecks green on this lane before done. NO pushes/merges.
- If a delta proves already covered by a joined lane: prove it, mark
  covered-with-evidence in the manifest, do not rebuild.
