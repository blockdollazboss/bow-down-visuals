# Lane report — Stack-100 #3, item #14: Product Reviews & Ratings

Branch: `stack29/reviews` (base `stack28/integration` f96d7b72). No push.

## Gap verified first (in source, at base tip)

- Grep for `product.review` / `product-review` / `product_review` /
  `verified.purchase` / `star.rating` / `productRating` across API +
  schema + frontend: **zero hits**. No product review model existed
  under any name.
- The in-tree `review_links` / `review_comments` system is creative
  feedback on shared work via token links (no product, no buyer, no
  rating) — left completely untouched, as briefed.

## What was built

**Model** (`lib/db/src/schema/product-reviews.ts`, pending migration):
`product_reviews` — rating (int 1–5, CHECK) + optional title + body,
tied to a product (`product_type` = `store_product` | `shop_product`,
`product_id`) and a buyer (`buyer_user_id`), with the verification
proof recorded on the row (`purchase_source` + `purchase_id`).
Snapshot columns (`product_title`, `seller_user_id`, `profile_id`,
`shop_id`) follow the `store_orders.product_title` discipline.
UNIQUE(product_type, product_id, buyer_user_id) — one review per
buyer per product. **Migration 0205 is HELD in
`.lane/MIGRATION-NEEDED.md`** (exact idempotent SQL; 0205 verified
free — highest existing file at base is `0204_abandoned_checkouts.sql`).

**Verified-purchase gate** (`artifacts/api-server/src/routes/product-reviews.ts`):
- Store rail: a `store_orders` row with `buyer_user_id` = caller and
  `status='completed'` (paid verify and $0 claims both land
  'completed'; refunded / cancelled / booking_held never count).
- Shop/marketplace rail: a `shop_events` row with
  `event_type='sale'` (paid truth since 0144; `pending_sale` never
  counts) whose `buyer_email` matches the caller's account email —
  that rail's only buyer identity, stated honestly in the 403 copy.
- Seller reviewing their own product: 400. No purchase: 403
  `NOT_VERIFIED_PURCHASE`. Duplicate: 409 pointing at the edit path.

**API** (mounted in routes/index.ts): public list + summary for a
product, eligibility (own_product / no_completed_purchase /
already_reviewed / eligible, with the caller's own review attached),
create, author PATCH edit, author-only DELETE, seller queue, seller
respond, seller flag, seller unflag. Raw SQL via `db.execute`, the
storefront/shops convention. Free — no credits/fees anywhere.

**Seller moderation — the house pattern (0174 reports / 0175
removal): state + recorded reason, never a delete.**
- No seller delete exists. `DELETE` is author-only; a seller attempt
  gets 403 `SELLER_CANNOT_DELETE` naming the flag path instead.
- Flagging REQUIRES a reason from the closed abusive-content
  vocabulary (spam, harassment, hate_speech, profanity,
  sexual_content, violence, fraud, other — mirrored in the schema
  CHECK, the API lib, and the frontend). `reason:"negative"` /
  `"unfair"` are 400s — an honest low rating can never be a reason.
- Hiding is a separate explicit choice on the flag. A hidden review
  (`hidden_pending_review`) leaves the public list, but the public
  summary always discloses `hiddenPendingCount`, the row stays fully
  visible to its author (eligibility) and in the seller's queue with
  its flag record, and unflagging restores it. Nothing is ever
  silently buried or deleted.

**Display (docked in the MONEY workflow, no standalone page):**
- `ProductReviews` component (summary: average, stars, distribution
  bars, hidden-pending disclosure; list with Verified-purchase badge
  + seller responses; write/edit form driven by eligibility) docked
  on `/storefront/product/:id` and inside the `/shop/:handle`
  product-detail modal (modal made scrollable).
- `SellerReviewsPanel` (respond / flag+hide / unflag, counts, the
  no-delete contract stated in copy) docked as the **Reviews tab in
  Store Dashboard** (`?tab=reviews`, store_product) and in **My
  Shop** under the active shop's products (shop_product).
- Pure helpers in `src/lib/product-reviews.ts` mirror the API summary
  math exactly.

## Test evidence (finished logs in this directory, runs sequential, --maxWorkers=1, TMPDIR in-worktree)

- `api-reviews-3.log` — new API suite: **23/23 passed** (gate on both
  rails incl. refunded/held/pending_sale/other-email refusals,
  one-per-buyer, author edit, summary math, respond, flag validation,
  flag-without-hide stays public, flag+hide disclosed + restored,
  seller-delete refusal, seller-queue scoping).
- `api-regression-1.log` — neighboring suites after the index.ts
  mount: storefront-lead-magnet + content-reports, **32/32 passed**.
- `fe-reviews-1.log` — new FE lib suite: **6/6 passed**.
- `fe-regression-1.log` — FE lib + storefront-product +
  public-routes: **137/137 passed**.
- `api-typecheck-2.log` — API `tsc --noEmit`: clean (empty log,
  exit 0).
- `fe-typecheck-5.log` — FE `tsc --noEmit`: `FE_TYPECHECK_EXIT=0`.
- `fe-typecheck-6.log` — FE clean re-run with `--incremental false`:
  `FE_TYPECHECK_CLEAN_EXIT=0`.
- `build-libs-1.log` — `tsc -b lib/db lib/api-zod` in-worktree: clean;
  `@workspace/db` dist contains `product-reviews.d.ts`.
- Node-modules farm: from the healthy MAIN checkout (per hazard
  correction, NOT bdv-wt-integration); `readlink -f` of
  `@workspace/db` and `@workspace/api-zod` resolves into THIS worktree
  at all five node_modules roots (`.lane/node-modules-verify.txt`).

Environment note: full FE typecheck OOM-killed twice (exit 137)
while two sibling lanes ran their own FE typechecks concurrently on
this 8 GB VM; it passed cleanly (incremental, then non-incremental)
once memory freed. Not a code signal.

## Parked / held

1. **Migration 0205 — HELD for owner approval** (exact SQL in
   MIGRATION-NEEDED.md). Until applied, the API fails closed on a
   real DB (table missing); pg-mem suites use DDL mirroring the held
   SQL statement-for-statement.
2. **Platform/admin moderation bench for flagged reviews**: the flag
   record + hidden-pending state are complete and auditable, and the
   seller can unflag, but there is no admin UI to adjudicate flags —
   the natural dock is the existing admin reports bench
   (routes/admin.ts). Follow-up, not built here.
3. **Digital-sales rail (store.ts / digital_sales)**: reviews cover
   the two product catalogs the brief named (storefront +
   marketplace). Music/video items sold via digital_sales have no
   product page of their own in this build and were left out rather
   than inventing a surface.
4. The shop-rail gate depends on the buyer-email match (the rail
   records no buyer user id). A buyer who checked out with a
   different email than their account email cannot review — the 403
   and eligibility copy say exactly that instead of pretending.
