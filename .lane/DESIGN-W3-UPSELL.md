# Lane W3-1 — Post-purchase one-click upsell — DESIGN

Branch `stack29/w3-post-purchase-upsell` off `stack29/order-bumps` @ d3a4d33d.
Dock: MONEY — the Sell Everything storefront rail (`routes/storefront.ts`).
Named follow-up of feature #13 (order bumps): the bump lane's REPORT.md
deferred exactly this — "its own payment-intent flow (charge the saved
payment method after the main order completes)".

## The flow

1. **Designation (seller)** — REUSED, no new surface: the seller's
   existing bump attachment (`PUT /storefront/products/:id/bump`,
   `store_products.bump_product_id / bump_percent_off`) is the
   post-purchase upsell designation too. One add-on per product, own
   products only, seller-set price or seller-set % off — the same
   validated setting drives (a) the at-checkout tick and (b) the
   post-purchase one-click offer. A buyer who already took the add-on
   at checkout is never re-offered it after purchase.
2. **Saving the card (checkout)** — the storefront Checkout Session now
   asks Stripe to save the payment method for off-session reuse:
   `customer_creation: "always"` +
   `payment_intent_data.setup_future_usage: "off_session"`. Amounts,
   line items, metadata and the idempotency-key derivation are
   byte-identical to before — only the session's card-saving behaviour
   changes. Without this the rail genuinely cannot reuse a card
   (Checkout Sessions discard the method), so this seam is the feature.
3. **Offer (verify)** — after the order records, verify resolves the
   attachment live (same `validateBumpTarget` rules), snapshots the
   price (seller price / % off, via `bumpUnitCents`) and the flat-5%
   split (`feeSplit`), reads the completed session's PaymentIntent to
   capture `customer` + `payment_method` (+ card brand/last4 for the
   honest "charged to your Visa •••• 4242" line), and stores ONE offer
   row per order (`store_upsell_offers`, UNIQUE parent_order_id,
   insert ON CONFLICT DO NOTHING — a duplicate verify can never mint a
   second offer). The verify response carries `upsell` ONLY while the
   offer is pending AND a reusable payment method exists — an offer
   that cannot be one-clicked is never dangled in front of the buyer.
4. **Accept (one click)** — `POST /storefront/orders/:id/upsell/accept`:
   - buyer-only (order's buyer; anyone else 404);
   - terminal states replay honestly: accepted → the recorded upsell
     order (duplicate:true, zero Stripe calls); declined → 409;
     failed → 409 (one attempt per order, see exactly-once);
   - no saved customer/payment method → 409 `UPSELL_NO_PAYMENT_METHOD`,
     zero Stripe calls — the refusal the brief requires;
   - the add-on is re-validated live (active, in stock) and its single
     unit is claimed BEFORE charging; a failed charge releases it;
   - the charge is the SNAPSHOT the buyer saw (price + fee split frozen
     on the offer row at verify) — display always equals charge;
   - `stripe.paymentIntents.create({ amount, customer, payment_method,
     off_session: true, confirm: true }, { idempotencyKey })`.
   - PI succeeded → the upsell records as its OWN `store_orders` row
     (quantity 1, snapshot gross/fee/creator, `parent_order_id`,
     `stripe_payment_intent_id`, per-kind fulfillment + delivery token
     exactly like the bump line) and the offer flips to accepted with
     the order id. Receipt treatment = bump-style `lines[]`
     (role "upsell" on the accept response; the order also lists in
     sales/purchases with `parentOrderId` / `isUpsell`).
   - PI declined (Stripe throws) → offer `failed`, 402
     `UPSELL_CARD_DECLINED`, no order, inventory released.
   - PI `requires_action` (bank wants the buyer present) → offer
     `failed`, 402 `UPSELL_REQUIRES_ACTION` — a one-click flow must
     never pretend that charge went through; the buyer can still buy
     the add-on normally from its product page.
5. **Decline/close** — `POST /storefront/orders/:id/upsell/decline`
   flips pending → declined (idempotent). A decided offer never
   appears again: verify replays and `GET /storefront/orders/:id/upsell`
   return `upsell: null` forever after. Pending offers re-present on a
   duplicate verify (the same showing — e.g. a success-page reload
   before the buyer decides — not a nag loop).

## Exactly-once (the pinned property)

Four independent belts, each test-pinned:
1. ONE offer row per order (UNIQUE parent_order_id + ON CONFLICT DO
   NOTHING at creation).
2. The Stripe idempotency key is a pure function of the parent order
   id (`storefront-upsell:<orderId>`, lib/post-purchase-upsell.ts) —
   double-click, duplicate accept calls and retry-after-timeout all
   derive the SAME key, so even if two accepts race past the status
   check Stripe returns the ONE PaymentIntent.
3. `store_orders.stripe_payment_intent_id` is UNIQUE and the record
   insert is ON CONFLICT DO NOTHING — the loser of a race re-reads and
   returns the winner's order as a duplicate.
4. The accepted status short-circuits before any Stripe call, and a
   failed attempt is terminal (no silent re-charge path exists).

## Money law

- Price = seller-set product price or seller-set % off it
  (`bumpUnitCents`, floored at 1¢). Nothing invented, ever.
- Fee = flat 5% via `feeSplit` / `PLATFORM_FEE_BPS` from
  lib/platform-fees.ts — the same story as every rail display.
- Snapshot at offer time; accept charges the snapshot to the cent.
  Offer payload, accept response and the recorded order all carry
  gross / fee / creator figures that reconcile exactly.

## Persistence — MIGRATION REQUIRED (see MIGRATION-NEEDED.md)

New table `store_upsell_offers` + two `store_orders` columns
(`parent_order_id`, `stripe_payment_intent_id`). NOT written into
lib/db/migrations by this lane (house rule). Pre-migration the feature
is honest/inert: checkout's card-saving is Stripe-side only; verify
wraps offer creation in a fail-soft try/catch (orders record exactly
as today, `upsell: null`); the upsell endpoints answer an honest 500
`UPSELL_UNAVAILABLE` ("aren't switched on yet"). The moment migration
0206 lands, the feature lights up with no code change.

## Surfaces

- API: checkout (card-saving), verify (`upsell` payload), GET offer,
  POST accept, POST decline, sales/purchases (`parentOrderId`,
  `isUpsell` via triple-fallback selects: full → bump-era → legacy).
- FE: `lib/storefront-api.ts` DTOs + helpers; `/store/success` gains
  the MOUNT.md-prescribed fallback to `/api/storefront/verify` and the
  one-click offer card (price + fee math + card hint shown; accept →
  receipt + delivery; decline → gone). Dashboard add-on editor copy
  notes the add-on is also offered once after purchase.
- Operator KB: `post-purchase-upsell` docked feature (money).
