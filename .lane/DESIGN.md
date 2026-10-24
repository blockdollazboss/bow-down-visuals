# Lane F5 — Paid bookings with a real calendar (stack29/bookings)

## Verdict on schema: NO migration needed for v1
- Availability fits the anticipated jsonb: `store_products.service_details`
  gains `booking_enabled` + `availability` (app-level shape, zero DDL).
- A booking IS a `store_orders` row (kind='service') — the money record and
  the booking record are the same row, created as a HOLD at checkout and
  flipped to confirmed at verify. The slot payload rides in
  `fulfillment_note` behind a single codec module (lib/booking-note.ts):
  human-readable line + `⟦bk1:<base64url-json>⟧` trailer. Every writer of a
  service order's note lives in routes/storefront.ts and goes through the
  codec, so the format has exactly one owner.
- Reported as the hardening follow-up (NOT built): a real `service_bookings`
  table + btree_gist exclusion constraint — see REPORT.md for the exact SQL.

## Availability shape (service_details.availability)
```ts
{
  timezone: string;                       // creator IANA tz, e.g. "America/New_York"
  weekly: [{ weekday: 0..6, start: "HH:MM", end: "HH:MM" }];
  overrides: [{ date: "YYYY-MM-DD", windows: [{start,end}] | null }]; // null = day off
  slot_step_min?: number;                 // default: duration + buffer
  buffer_min?: number;                    // default 0 — breather blocked around bookings
  min_notice_min?: number;                // default 0
  max_advance_days?: number;              // default 60
}
```
Weekly windows are wall-clock in the creator's timezone. Overrides are keyed
by creator-local calendar date and replace that date's weekly windows.

## Slot engine (lib/booking-slots.ts, pure)
- All instants UTC; local wall time ⇄ UTC via Intl offset resolution.
- Candidates step from each window start; a candidate is valid when its
  [start,end) fits the window, clears min-notice / max-advance, and does not
  intersect a taken booking's [start-buffer, end+buffer).
- Taken = store_orders for the product with status 'booking_held'
  (hold not expired: created_at + 30 min) or 'completed', with a live
  (non-cancelled) booking trailer.

## Flow
1. Seller sets availability on a service product (dashboard form → PATCH/POST
   serviceDetails). booking_enabled=true turns on native booking.
2. Buyer opens the product page → GET /storefront/product/:id/slots (public)
   → picks a slot (rendered in the BUYER's timezone by the client).
3. POST /storefront/checkout { bookingStartUtc } — inside a transaction with
   the product row locked (SELECT … FOR UPDATE), the slot is re-validated
   against the engine + taken set, a HOLD order (status 'booking_held',
   30-min TTL) is inserted, then the Stripe session is created (expires_at
   matches the hold) and its id attached to the hold. A second buyer racing
   the same slot sees it taken → 409 SLOT_TAKEN.
4. POST /storefront/verify — finds the hold by stripe_session_id and flips
   it to 'completed' / trailer st='confirmed' (+ discount use, inventory
   claim, creator notification — the same side effects as any order).
   Duplicate verify returns the same order. If the hold expired but the
   payment completed and the slot now conflicts with another confirmed
   booking, the order is still honored (money was taken) and the creator
   gets a conflict notification — never a silent double-book.
5. $0 bookable services ride the claim rail: slot validated under the same
   product lock, order lands directly 'completed'/confirmed.
6. GET /storefront/bookings (auth) — both sides' bookings with derived
   status: held / upcoming / done / cancelled.
7. POST /storefront/orders/:id/booking-cancel (buyer or seller) — frees the
   slot and refunds through Stripe exactly like the store rail
   (stripe.refunds.create, idempotency key `refund:<sessionId>`, store.ts
   pattern). Refund success → order status 'refunded'; refund failure →
   'cancelled' with rf='refund_failed' in the trailer + honest message;
   free booking → 'cancelled', rf='not_required'. The other party is
   notified via job_notifications.
8. Legacy services (no availability) keep the old request/confirm flow;
   service-confirm refuses booked orders (400 USE_BOOKING_CANCEL) so it can
   never clobber a booking trailer.

## Honest limits
- No Google/Apple calendar sync (out of scope; noted as follow-up).
- No reminder emails (the job_notifications ping to the creator fires on
  booking + cancellation; buyer reminders are a follow-up).
- DST gap wall-times resolve to the first valid instant after the gap.
- Double-book safety = product-row lock + hold TTL + verify re-check;
  a DB exclusion constraint is the hardening migration (in REPORT.md).
