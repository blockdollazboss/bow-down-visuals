# Lane W3-1 — Post-purchase one-click upsell — REPORT

Branch `stack29/w3-post-purchase-upsell` off `stack29/order-bumps` @ d3a4d33d.
The exact follow-up the order-bumps lane named: after a storefront
purchase completes, the buyer is offered ONE relevant add-on (the
seller's designated bump attachment) and can accept in one click —
charged through its OWN PaymentIntent off the payment method the
just-completed checkout saved. Design: `.lane/DESIGN-W3-UPSELL.md`.

## ⛔ ONE BLOCKER — migration 0206 required (reported, NOT written, per brief)

Full SQL + matching drizzle additions: `.lane/MIGRATION-NEEDED.md`.
New table `store_upsell_offers` (one row per parent order) +
`store_orders.parent_order_id` + `store_orders.stripe_payment_intent_id`
(UNIQUE). **Everything is built, tested against the post-migration
DDL, and safe to land BEFORE the migration**: verify wraps offer
creation fail-soft (proven by the bumps regression suite, whose DDL
has neither the table nor the columns — orders record exactly as
today, `upsell: null`); sales/purchases use triple-fallback selects
(full → bump-era → legacy); the upsell endpoints answer an honest
500 `UPSELL_UNAVAILABLE` ("aren't switched on yet — no charge was
made"). Checkout's card-saving is Stripe-side only. The moment 0206
lands (after 0205), the feature lights up with no code change.

## What works end-to-end (proven by the route suite, post-migration DDL)

- **Designation** — REUSED: the seller's bump attachment
  (`PUT /products/:id/bump`, seller-set price or % off, own products
  only) is the post-purchase designation. Dashboard editor copy now
  says so. A buyer who already took the add-on at checkout is never
  re-offered it (eligibility pin).
- **Card saving** — storefront Checkout Sessions now send
  `customer_creation: "always"` +
  `payment_intent_data.setup_future_usage: "off_session"`; amounts,
  lines, metadata and idempotency keys byte-identical (pin: totals +
  metadata + the two new params asserted together).
- **Offer** — verify mints ONE offer row per order (UNIQUE
  parent_order_id + ON CONFLICT DO NOTHING; duplicate verify pin:
  still one row) with the price/fee SNAPSHOT frozen from the
  seller-set price (3000 @10% off → 2700¢, fee 135, creator 2565 —
  flat 5% via `feeSplit`) and the saved customer + payment method
  (+ brand/last4) read off the completed session's PaymentIntent.
  The response presents the offer only while pending AND a reusable
  method exists. `GET /storefront/orders/:id/upsell` is the same
  presentation; decided offers present as null forever (no nagging).
- **Accept (one click)** — `POST /storefront/orders/:id/upsell/accept`:
  live revalidation (active/in stock, unit claimed pre-charge and
  released on failure), then ONE `paymentIntents.create` —
  `off_session: true, confirm: true`, saved customer + method,
  snapshot amount, metadata tying it to the parent order — under
  idempotency key `storefront-upsell:<parentOrderId>`. Success
  records the upsell as its OWN `store_orders` row (parent_order_id,
  stripe_payment_intent_id, snapshot split, per-kind fulfillment:
  delivery token for digital/download, RSVP for tickets, booking
  note + creator ping for services, merch handoff) and returns the
  bump-style receipt (`lines[]`, role "upsell"). Sales/purchases list
  it linked (`isUpsell`, `parentOrderId`); seller totals reconcile
  (4700/235/4465 across main + upsell).
- **Decline/close** — `POST .../upsell/decline`, idempotent; after
  decline, GET/verify replays show nothing and accept answers 409.

## Exactly-once (the pinned property)

1. One offer row per order (UNIQUE + ON CONFLICT DO NOTHING).
2. Stripe idempotency key is a pure function of the parent order id
   (lib pins: deterministic, order-distinct, empty-id refused) —
   double-click / duplicate accept / retry-after-timeout derive the
   SAME key, so Stripe can only create one PaymentIntent.
3. `store_orders.stripe_payment_intent_id` UNIQUE + ON CONFLICT DO
   NOTHING on the record insert; a race loser returns the winner's
   order as the duplicate.
4. Accepted offers short-circuit before any Stripe call (route pin:
   second accept → duplicate:true, PI creates stay 1, rows stay 2,
   inventory stays claimed-once); a failed attempt is TERMINAL
   (declined-card pin: retry → 409 `UPSELL_FAILED`, PI creates stay
   1) — no silent re-charge path exists.

## Refusals (all pinned, all zero-charge)

- **No reusable payment method** (checkout saved nothing reusable):
  verify presents nothing; accept → 409 `UPSELL_NO_PAYMENT_METHOD`
  BEFORE Stripe is touched (PI creates = 0).
- **Sold out / inactive at accept** → 409, no charge, offer stays
  pending (the buyer isn't punished for the seller's stock race).
- **Card declined** → 402 `UPSELL_CARD_DECLINED`, offer failed,
  inventory released, no order.
- **Bank wants the buyer present** (`requires_action`) → 402
  `UPSELL_REQUIRES_ACTION`, nothing recorded as charged — the flow
  never fakes a completed charge; the buyer can buy normally from
  the product page.
- **Not your order** → 404 on GET/accept/decline (no existence leak).
- **No offer on the order** → 404 `UPSELL_NOT_OFFERED`.

## Money honesty

Price is always the seller-set product price or seller-set % off it
(`bumpUnitCents`, 1¢ floor) — snapshot at offer time, accept charges
the snapshot to the cent (odd-cent pin: 1999¢ → fee 100 / creator
1899, PI amount exactly 1999). Fee is the flat 5% from
lib/platform-fees everywhere; offer payload, accept response and the
recorded order reconcile exactly. No price or fee invented.

## FE

- `lib/storefront-api.ts`: `UpsellOfferDTO` / `UpsellOrderDTO` /
  receipt-line DTOs + `getUpsellOffer` / `acceptUpsell` /
  `declineUpsell`; `OrderLineDTO.role` gains "upsell";
  `StoreOrderDTO` gains `parentOrderId` / `isUpsell`.
- `/store/success`: gains the MOUNT.md §4 fallback (a storefront
  session that /api/store/verify rejects now verifies on
  /api/storefront/verify — previously it dead-ended on the error
  card) and renders the order + deliveries + the one-click offer
  card (price, % off strike-through, creator-keeps fee math, saved
  card hint, busy-guarded accept, decline closes for good; accepted
  state shows the charged receipt + add-on delivery).
- Dashboard add-on editor copy notes the post-purchase offer.

## Operator KB

`post-purchase-upsell` registered as a docked feature (stage: money,
host /store/dashboard); KB regenerated 238 → 239 features, diff
limited to the new entry + counts.

## Suite numbers (from finished logs in `.lane/logs/`)

| Suite | Log | Result |
|---|---|---|
| lib unit — post-purchase-upsell (new) | lib-upsell.log | 16/16 pass |
| route — storefront-post-purchase-upsell (new) | route-upsell-1.log | 17/17 pass |
| final combined — lib upsell + route upsell + lib order-bumps | upsell-suites-final.log | 52/52 pass (3 files) |
| regression — bumps route + lead-magnet + profile-slug | regression-storefront.log | 34/34 pass (3 files) |
| regression — operator-knowledge + door-mapping + chat-doors + stripe-checkout-idempotency ×2 | regression-operator.log | 103/103 pass (5 files) |
| FE affected — storefront-product + sibling-dashboards + earned-rank + public-routes | fe-affected-w3.log | 170/170 pass (4 files) |
| API typecheck (`tsc --noEmit`) | api-typecheck-final.log | exit 0 |
| FE typecheck (`tsc --noEmit`) | fe-typecheck-w3.log | exit 0 |

Route pins include: session card-saving params with untouched
totals/metadata; offer snapshot + one-row-per-order under duplicate
verify; accept PI params (amount/customer/method/off_session/confirm
+ exact idempotency key) and the recorded order's columns; the
double-accept replay; odd-cent math; ticket RSVP fulfillment;
no-PM refusal with zero PI creates; sold-out-at-accept; terminal
card-decline (inventory restored, retry refused); requires_action;
cross-account 404s; decline idempotence + never-shown-again across
GET and verify replays.

## Parked / not built

- **Pre-migration endpoint behaviour** is code-path-verified (the
  load throws are caught into the honest 500) but not suite-pinned —
  the pg-mem suite runs the post-migration DDL by design, same as
  the bumps lane; verify's pre-migration inertness IS proven by the
  bumps regression suite passing on 0205-era DDL.
- **Shops cart rail / digital store rail** upsells — separate
  checkout rails, same pattern as the bumps lane left them; the pure
  module is rail-agnostic and ready.
- **Refund path for a charged upsell** — rides the rail's existing
  story (creator refunds via Stripe, as the order notes state);
  no new refund automation was in scope.
- Stacking order for the join: migration 0206 lands after 0205 in
  the same stack as this branch. Without 0206 the branch is
  inert-but-safe (no offers anywhere; checkout merely saves cards).

## Files

- `artifacts/api-server/src/lib/post-purchase-upsell.ts` (new) +
  `src/lib/__tests__/post-purchase-upsell.test.ts` (new, 16)
- `artifacts/api-server/src/routes/storefront.ts` (checkout
  card-saving, verify offer, GET/accept/decline endpoints, orderShape
  parent links, sales/purchases triple-fallback selects)
- `artifacts/api-server/src/routes/__tests__/storefront-post-purchase-upsell.test.ts` (new, 17)
- `artifacts/api-server/scripts/generate-operator-knowledge.mjs` +
  `src/lib/operator-knowledge.json` (KB: post-purchase-upsell, 239 features)
- `artifacts/bow-down-visuals/src/lib/storefront-api.ts` (DTOs + helpers)
- `artifacts/bow-down-visuals/src/pages/store-success.tsx` (storefront
  verify fallback + upsell card)
- `artifacts/bow-down-visuals/src/pages/store-dashboard.tsx` (add-on copy)
