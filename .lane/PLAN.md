# Lane par-seller-stand — PLAN + ground truth (Oct 27, 2026)

Brief: Marketplace seller-side stand management in-world (audit row: MISSING).

## GROUND TRUTH AT BASE ecc63098 (audit row is STALE — same trap as P1/P2)
The surface the brief asks for ALREADY STANDS at base, built by Stack-4 #7 +
Stack-4 wave-2 #6 and test-pinned (shop-stands.test.ts 64/64 green pre-lane):
- Ownership gate: GET /api/shops/mine + isOwnStand (fail-closed) in
  components/world/native/ShopStands.tsx (MarketplaceStand -> StandManager).
- Stand overview: settings bench (PATCH /api/shops/:id name/tagline/description,
  handle shown, DomainsDesk, two-step close-shop).
- Product list state: products bench — POST/PATCH/DELETE
  /api/shops/:id/products[/:productId] with the My Shop page's exact payloads,
  two-step delete, AI description/image helpers on the confirmed-spend seam.
- Orders view: sales bench — GET /api/storefronts/:id/analytics (owner-scoped):
  totals (views/sales/gross/fee/net/pending), 30-day views strip, recent sales
  with payment state, pending checkouts kept visibly apart.
- Shop create at the square (POST /api/shops). Both themes (isLight threaded).

## THE ONE BRIEF-NAMED CONSUMPTION NOT AT THE STAND
The brief names consuming the seller-earnings aggregation. The stand reads
only its own shop's analytics rail; the seller's CROSS-RAIL picture never
renders at the stand. Base rail available: GET /api/earnings (routes/
earnings.ts, Stack 8 #5) — totalCents (store sales + memberships + brand
deals, cents), totalTipsVb (stream tips, VB kept apart by contract),
per-source {status,totalCents,count}, partial flag on source failure.
payfix's lib/seller-earnings.ts (stack200/payfix-store-dashboards @ 1e137700)
is NOT at base; at Join #2 the endpoint's aggregation upgrades to it
(readPendingPayoutForSeller contract) and this stand read upgrades with it —
no stand-side change beyond this read. NO new money rails; display-only;
every number exactly as the endpoint computes it.

## BUILD (one rung + tests)
1. lib/world/shop-stands.ts: parseSellerEarnings (tolerant; null when the
   headline doesn't honestly exist; errored sources keep null totals, never
   fake zeros; VB kept apart) + SellerEarnings types + join-upgrade comment.
2. ShopStands.tsx StandManager: "Your earnings" overview strip under the
   intro, above the benches — lazy load on mount, honest loading/failed
   (+retry)/partial states, per-source chips, tips-in-VB line, tip-jar
   pending note. Owner-only by construction (renders inside StandManager).
3. Tests: parser unit tests + source pins (fetch "/api/earnings" inside the
   manager; strip testid; parse used). World suite slice + FE typecheck.
