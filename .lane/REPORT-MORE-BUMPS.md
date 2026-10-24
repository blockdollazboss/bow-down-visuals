# Lane MORE-BUMPS — order bumps on the shops-cart + digital-store rails — REPORT

Branch `stack29/more-bumps` off `stack29/order-bumps` @ d3a4d33d
(feature #13's storefront rail). Design: `.lane/DESIGN-MORE-BUMPS.md`.
The pure module `lib/order-bumps.ts` is reused unchanged.

## ⛔ MIGRATION HELD — 1 migration, written by the join

Exact idempotent SQL + matching drizzle additions are in
`.lane/MIGRATION-NEEDED.md` (0206 family; touches tables disjoint from
0205). **Hold count: 1.** Its four parts unlock, in order:

1. `shop_products.bump_product_id / bump_percent_off` — shops seller
   attachment → shops attach endpoint + buyer offers + cart ticks.
2. `shop_events.bump_for_product_id` — labels a shop_events order row
   as a bump line (receipts' `isBump` flag). Rows record + reconcile
   without it; they just can't be labelled.
3. `digital_bump_offers` table — digital-store attachment (items span
   three catalog tables) → digital attach endpoint + drop-page offers
   + checkout ticks.
4. `digital_sales.bump_*` columns — the purchased bump as its own line
   on the sale row → `lines[]` on digital verify / purchases / sales.

Everything below is built, tested, and safe to land BEFORE the
migration: all reads are defensive (absent column/table → no offer,
legacy totals byte-identical), and order inserts only name bump
columns when a session actually carries a bump — impossible until the
attachment can be read. The two seller PUT endpoints are the only
surfaces that need the persistence outright (pre-migration they answer
an honest 500 "Could not update the add-on offer"). The moment 0206
lands, both rails light up with no code change. No files were written
under lib/db/migrations/ and no drizzle schema was edited.

## What works end-to-end (proven by the route suites, post-migration DDL)

### Shops cart rail (routes/generate/shops.ts + lib/market-sale.ts)
- **Seller attach/detach** — `PUT /api/shops/:id/products/:productId/bump`
  `{ bumpProductId | null, percentOff 0..90 }`. Own shop only (another
  owner's shop → 404), target must be the same shop's product
  (`BUMP_NOT_YOURS`), never itself (`BUMP_SELF`), never a $0 product
  (`BUMP_FREE`). A paused add-on may be attached; the response's
  `offerLive` says whether buyers can see it. Owner product reads and
  create/patch responses carry the raw `bumpConfig`.
- **Buyer offer** — BOTH public storefront reads (handle + slug, the
  slug read is the one /shop/:handle renders) carry `bump`: the
  resolved live offer (same shop, active, priced — else null) at the
  seller-set price / % off.
- **Checkout** — `includeBumps: string[]` = cart product ids whose
  add-on the buyer ticked. Each tick is re-resolved and re-priced
  server-side; a tick with no live offer — or for a product not in
  the cart (`BUMP_NOT_IN_CART`) — refuses the WHOLE checkout: no rows,
  no session, no charge. A live tick rides the same Stripe session as
  its own line and its own shop_events row (marked
  `bump_for_product_id`). Same add-on ticked via two cart products
  collapses to one line. The shop discount code discounts cart lines
  only, never the bump. A free cart with a ticked bump takes the card
  path (the bump is priced ≥ 1¢).
- **Money math** — the rail's own sequence per line: fee =
  round(line gross × 5%) (`STOREFRONT_PLATFORM_FEE_BPS`), bump line
  included; totals are the line sums, reconciling to the cent.
  Pinned: A 2000¢×2 + B 1000¢ + bump C 3000¢ @10% off = 7700¢ gross,
  fee 385 (200+50+135), net 7315. Unchecked totals byte-identical.
- **Double-charge impossibility** — the order records pending first;
  the guarded pending→sale flip in lib/market-sale (shared with the
  central webhook) flips the bump row with its group exactly once.
  Duplicate verify returns `duplicate: true` with zero side effects;
  the discount use is counted exactly once even across verify +
  direct flip calls. Verify's session-total check sums every row,
  bump included.
- **Receipts** — checkout response lines, verify and status receipts
  all carry the bump as its own line flagged `isBump` (+
  `bumpForProductId`); totals stay whole-order.
- **FE** — shop page: per-cart-line add-on tick card with struck list
  price at % off, an Add-ons total row, honest "code applies to the
  items" note, `includeBumps` on checkout. My Shop product editor:
  add-on picker (own priced products) + % off + live/not-live status.

### Digital store rail (routes/store.ts)
- **Seller attach/detach** — `PUT /api/store/item/:kind/:id/bump`
  `{ bumpKind, bumpItemId | null, percentOff 0..90 }`. Caller's
  creator profile must own the item (else 404); target must be the
  same seller's item (`BUMP_NOT_YOURS`), never itself (`BUMP_SELF`),
  never a series (`BUMP_KIND` — a series is an access unlock, and one
  sale row cannot honestly unlock a second series), never a
  name-your-price item (`BUMP_FREE` — no seller-set price to charge).
  Unpublished targets may be attached; `offerLive` reports liveness.
  `/api/store/products` carries each product's raw `bumpConfig`.
- **Buyer offer** — GET /api/store/item gains `bump` (live offer or
  null). Drop page (store-buy) renders the tick card with the combined
  total, mirroring the storefront product page.
- **Checkout** — `includeBump` re-resolved + re-priced server-side; a
  tick with no live offer refuses the whole checkout
  (`BUMP_NOT_OFFERED` etc.), no session. One Stripe session, two line
  items; metadata carries only bump kind/id/amount. A series main can
  carry a track/video bump. PWYW mains combine with a fixed-price bump.
- **Money math** (`lib/order-bumps.splitOrderAmounts` at the rail's
  flat 5%) — session fee computed once on the total; the bump's fee is
  its own split; the main line absorbs the remainder; lines sum to
  the cent. Pinned: main 2000¢ + bump 3000¢ @10% off = 4700¢, fee 235
  = bump 135 + main 100, creators 2565 + 1900. No-bump totals
  byte-identical to the pre-feature rail.
- **Double-charge impossibility** — the checkout idempotency intent
  includes the bump (same tick double-submit derives the SAME key;
  ticked vs unticked differ; historic no-bump keys unchanged). Verify
  is idempotent on the unique `stripe_session_id`: duplicate verify
  returns the recorded sale, reuses BOTH download links, mints
  nothing, sends nothing twice.
- **Verify / fulfillment** — ONE sale row; bump_* columns written from
  splits re-derived from the session total. The bump's own download
  link is minted under the same sale id (series mains still unlock;
  the bump still delivers its file). If the add-on vanishes between
  payment and verify, the sale still records and the response states
  the exact refund owed ("$27.00 refund for the add-on"). Receipt
  email + "You just got paid" ping name the add-on.
- **Receipts** — verify response, purchases and sales all carry
  `lines[]` (main + bump: title, gross, fee, net per line); the store
  dashboard sales list renders the add-on line under its sale; sale
  totals stay whole-session so tracker/payout readers reconcile
  untouched.
- **FE** — drop page tick card (store-buy); store dashboard product
  cards gain an add-on editor (own priced tracks/videos + % off).

### Incidental fix inside this lane's verify edit
pg-mem returns a row for `INSERT … ON CONFLICT DO NOTHING … RETURNING`
even when the insert was skipped (real Postgres returns none), which
made the pre-existing duplicate detection depend on that row count.
Verify now selects the existing sale FIRST — the storefront rail's
order — with the ON CONFLICT insert kept as the race backstop.
Semantics on real Postgres are unchanged (proven: the whole existing
store suite set still passes).

### Operator KB
`order-bumps` entry extended to all three rails (description +
endpoints); KB regenerated: still 238 features, diff is the one entry.

## Suite numbers (from finished logs in `.lane/logs/`)

| Suite | Log | Result |
|---|---|---|
| route — shops-order-bumps (new, 16 tests) | shops-bumps-2.log / final-api-sweep.log | 16/16 pass |
| route — store-order-bumps (new, 15 tests) | store-bumps-2.log / final-api-sweep.log | 15/15 pass |
| regression sweep (9 files: base bumps route+unit, shops-pinned-ad, slug, catalog, pwyw, paid-series, download-token) | final-api-sweep.log | 96/96 pass |
| regression — storefront batch (base bumps, unit, lead-magnet, slug) | regression-batch1.log | 53/53 pass |
| regression — shops/store batch (pinned-ad ×2, pwyw, token, refresh-links, paid-series, catalog) | regression-batch2.log | 52/52 pass |
| regression — money/webhook batch (webhook-abandoned, checkout-idempotency, webhook-reversals, payment-reversals, live-shopping) | regression-batch3.log | 45/45 pass |
| operator KB (knowledge + door-mapping + chat-doors) | kb-suites.log | 88/88 pass |
| FE affected (my-shop wiring, sibling-dashboards, earned-rank, shop-stands) | fe-affected.log | 120/120 pass |
| API typecheck (`tsc --noEmit`) | api-typecheck-final.log | exit 0 |
| FE typecheck (`tsc --noEmit`) | fe-typecheck-1.log | exit 0 |

Both new suites pin, per rail: attach/detach + all refusals; offer
resolution; ticked totals + fee split; unchecked totals
byte-identical; refused ticks creating ZERO Stripe sessions/rows;
discount-code-excludes-bump (shops); idempotency-key equality on
double-submit + ticked≠unticked (digital); duplicate verify as a pure
no-op; receipt lines reconciling to the cent; the vanished-add-on
refund note (digital); and a full pre-migration block per rail (no
offers, honest 500 on attach, legacy checkout/verify untouched).

## NOT built (stated follow-ups, not silent gaps)
- **Series as a bump TARGET** on the digital rail — refused by design
  (BUMP_KIND): an access unlock can't ride as a line on another
  item's sale row. Would need its own entitlement row.
- **Post-purchase one-click upsell** — the base lane's named
  follow-up; unchanged here.
- **Stacking order for the join**: land 0205 + 0206 (either order —
  disjoint tables) with the drizzle additions listed in
  MIGRATION-NEEDED.md, in the same stack as this branch. Without 0206
  the branch is inert-but-safe on both rails.
