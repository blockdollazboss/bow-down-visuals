# Lane MORE-BUMPS — order bumps on the shops-cart + digital-store rails

Branch `stack29/more-bumps` off `stack29/order-bumps` @ d3a4d33d (feature
#13's storefront rail; its own design is in DESIGN.md). The pure module
`lib/order-bumps.ts` is reused unchanged: `readBumpConfig`,
`validateBumpTarget`, `bumpUnitCents`, `splitOrderAmounts`. Money law
mirrors the base lane exactly: bump price is ALWAYS the seller-set
product price or the seller-set % off it, never invented, floored at
1¢; platform fee is each rail's existing flat 5%; totals reconcile to
the cent; the bump is its OWN line on receipts/order records;
double-charge is impossible (idempotency intent includes the bump;
duplicate verify/confirm is a no-op).

## Persistence verdict: NEW columns/tables needed on both rails → HELD

Per the brief's hard migration rule, NO files under lib/db/migrations/
and NO drizzle schema edits. The exact idempotent SQL + matching drizzle
additions live in `.lane/MIGRATION-NEEDED.md` (one migration, 0206
family, written by the join alongside 0205). Everything below is built
inert-but-safe before it: all bump reads are defensive (absent
column/table → no offer anywhere, legacy totals byte-identical), and
order writes only name bump columns when a session actually carries a
bump — which cannot happen until the attachment can be read, i.e. until
the migration lands. The seller PUT endpoints are the one surface that
needs the columns outright (pre-migration they answer an honest 500).

## Shops cart rail (routes/generate/shops.ts + lib/market-sale.ts)

Seller identity for a bump = the SHOP (one owner per shop). Attachment
lives on shop_products (bump_product_id / bump_percent_off, the
storefront's exact shape). The order record is shop_events: a bump is
its OWN row (product_id = add-on), marked by a new
`bump_for_product_id` column naming the cart product it was attached
through — written best-effort (fallback insert without the marker if
the column is absent; unreachable pre-migration anyway).

- Seller: `PUT /shops/:id/products/:productId/bump` — own shop only
  (the rail's 404 discipline), target = own shop's product, never self,
  never a $0 product. Paused targets may be attached (offer stays
  hidden until active — the storefront's inactive-attach rule; shops
  have no inventory, so stock never gates).
- Buyer payloads: public handle read gains `bump` (live offer) +
  owner product reads gain `bumpConfig` (raw setting), both resolved
  defensively from the same result set.
- Checkout: `includeBumps: string[]` = cart product ids whose add-on
  the buyer ticked. Each tick is re-resolved + re-priced server-side;
  a tick with no live offer (or for a product not in the cart) refuses
  the WHOLE checkout — no rows, no session, no charge. The shop
  discount code discounts cart lines only, never the bump (the bump
  carries its own seller-set % off — the storefront rule). Bump line:
  qty 1, fee = the rail's per-line round(gross × 5%). Same target
  ticked via two cart products collapses to ONE bump line.
- Verify/status: the guarded pending→sale flip (lib/market-sale) flips
  bump rows with their group; the receipt's `lines[]` flags the bump
  line `isBump` (+ `bumpForProductId`). Duplicate verify stays a pure
  no-op. The verify session-total check already sums every row, bump
  included, so a paid total can never drift from the recorded order.

## Digital store rail (routes/store.ts)

Items are heterogeneous (tracks/videos in profile tables, series in
playlists), so the attachment lives in ONE new table,
`digital_bump_offers` (PK item_kind+item_id), instead of columns on
three catalog tables. The purchased line rides ON the digital_sales
row as bump_* columns (the storefront's store_orders pattern);
amount_cents stays the SESSION TOTAL so every existing reader
(purchases, sales, tracker, payout sums) reconciles untouched.

- Seller: `PUT /store/item/:kind/:id/bump` — caller's creator profile
  must own the item; target must be the same seller's item, never the
  item itself. Target kinds: track/video only — a series is an access
  unlock, not a deliverable file, and a bump line on one sale row
  cannot honestly unlock a second series (refused BUMP_KIND). PWYW
  targets are refused (BUMP_FREE): a name-your-price item has no
  seller-set price for a bump to charge. Inactive/unpublished targets
  may be attached; the offer simply isn't live.
- Buyer: GET /store/item gains `bump` (live offer or null).
- Checkout: `includeBump` re-resolved server-side exactly like the
  storefront rail; session carries TWO line items; the idempotency key
  intent gains the bump (ticked ≠ unticked; double-submit of the same
  tick derives the SAME key). Metadata carries only bump kind/id/
  amount — verify re-derives every split from the session total.
- Verify: splits via splitOrderAmounts(total, bumpGross, rail bps);
  ONE sale row with the bump line columns; the bump's download link is
  minted/reused under the same sale id (duplicate verify reuses both
  links, mints nothing new); if the add-on vanished after payment the
  sale still records and the response states the exact add-on refund
  owed (the storefront honesty pattern). Receipts: verify response,
  purchases and sales all carry `lines[]` (main + bump).
