# Storefront — Mount Instructions (Worker 11 → Worker 4 + Coordinator)

Worker 11 built the "Sell Everything" storefront. Nothing here edits another
worker's files — mount only.

## 1. Server route (Coordinator — Worker 11 may not touch `routes/index.ts`)

In `artifacts/api-server/src/routes/index.ts`, add:

```ts
import storefrontRouter from "./storefront";
```

and in the `router.use(...)` block:

```ts
router.use(storefrontRouter);
```

All endpoints live under `/api/storefront/*` (see the header comment in
`artifacts/api-server/src/routes/storefront.ts` for the full list).

## 2. Storefront section on `/artist/:slug` (Worker 4)

The component is fully self-contained — drop it into the public artist page:

```tsx
import StorefrontSection from "@/components/storefront/StorefrontSection";

// inside the artist page render, where the store section belongs:
<StorefrontSection slug={profile.slug} manageMode={isOwner} />
```

- `slug`: the creator's public slug (required).
- `manageMode`: true when the viewer owns the profile — shows inventory
  state, the "Manage store" link, and the Promote chain on every product.
- Empty stores render `null` for fans (invisible); owners see an empty-state
  with a "list your first product" CTA.
- A failed fetch also renders `null` — a broken store never blocks the profile.

Files (all new, all owned by Worker 11):

- `artifacts/bow-down-visuals/src/components/storefront/StorefrontSection.tsx`
- `artifacts/bow-down-visuals/src/components/storefront/PromoteButton.tsx`
- `artifacts/bow-down-visuals/src/lib/storefront-api.ts` (typed API client)

## 3. Seller dashboard route (Coordinator)

`/store/dashboard` — the Get Paid finale. One route in `App.tsx`, no sidebar
items (per standing rules):

```tsx
const StoreDashboard = lazyWithRetry(() => import("@/pages/store-dashboard"));
…
<Route path="/store/dashboard"><ProtectedRoute><StoreDashboard /></ProtectedRoute></Route>
```

File: `artifacts/bow-down-visuals/src/pages/store-dashboard.tsx`.
Tabs are internal (`?tab=products|orders|discounts`): overview (earnings +
money checklist + next-money-move), products, orders, discounts.

## 4. Post-purchase success page (whoever owns `/store/success`)

Stripe `success_url` for storefront checkouts is
`/store/success?session_id={CHECKOUT_SESSION_ID}` (same page as the digital
store). After the existing `/api/store/verify` call fails for a storefront
session, fall back to:

```
POST /api/storefront/verify   { sessionId }
```

It returns the same shape (`{ success, order, delivery, links }`) and is
idempotent. ~5 lines in `store-success.tsx`.

## 5. Prefill contracts used by the Promote chain

`PromoteButton` deep-links into existing tools with query-string prefills.
If the target pages don't read these params yet, they're harmless no-ops —
owners of those pages can wire them up:

- `/scheduler?text=<encoded share text>` — prefill the scheduled post
- `/promote?product=<productId>` — promo visuals for the product
- `/email-list` — the email broadcast itself drafts via the existing
  `POST /api/email-list/lists/:id/campaigns` (nothing rebuilt)
- Share links append the creator's `?ref=CODE` from `GET /api/referrals/me`

## 6. Difficulty ladder (Creator Level) — how it's gated

- Viewing earnings: **never gated** (standing rule).
- Product creation: 1★ = title + price only (+ "✨ Price it" starting-price
  helper); 2★+ adds kind/description/discount-code input; 4★+ unlocks
  inventory steppers, compare-at pricing, media/related links, service
  details, event links, full discount controls.
- Gating uses `data-min-stars="N"` (pure CSS, site-wide) — no imports needed.

## 7. Boundaries (do not cross)

- **Merch fulfillment**: the existing merch system (`merch_designs` +
  print/dropship) owns fulfillment. Storefront merch orders only record the
  sale and hand off (`fulfillment_note`).
- **Digital delivery**: signed-link pattern (48h, 5 uses) via
  `GET /api/storefront/deliver/:token` — separate table, never touches
  Worker 5's `digital_sales` rows.
- **Tickets**: `store_products.event_id → events.id`; a ticket purchase
  inserts into `event_rsvps` and bumps `events.rsvp_count`. Worker 9 owns
  the events themselves.
- **Money**: all copy says "real money via Stripe, not Visual Bucs".
  Payouts need Stripe Connect (not built) — the dashboard labels the net
  as a pending balance, honestly.
- **Fees**: Worker 12's `artifacts/api-server/src/lib/platform-fees.ts`
  (`PLATFORM_FEE_BPS`, default 10%) is the single source of truth. The
  per-tier rates in that module are PROPOSED — the storefront uses the
  base rate only until the user approves.
