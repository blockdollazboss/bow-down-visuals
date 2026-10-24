# MIGRATION NEEDED — Stack-100 #3, item #14: Product Reviews & Ratings

**STATUS: HELD FOR OWNER APPROVAL — do NOT apply, do NOT rename into
`lib/db/migrations/` until approved.** Per house rule this lane stops
before writing any migration. The Drizzle schema source-of-truth in
`lib/db/src/schema/product-reviews.ts` is drafted to match this SQL
exactly and is flagged pending-migration there.

- **Proposed file:** `lib/db/migrations/0205_product_reviews.sql`
- **Number verification (2026-10-23, worktree at stack28/integration
  f96d7b72):** `ls lib/db/migrations/` shows the highest existing file
  is `0204_abandoned_checkouts.sql`. **0205 is free.**
- **Idempotent:** every statement uses `IF NOT EXISTS`; the CHECK
  constraints are added inside `DO $$ … IF NOT EXISTS (pg_constraint) …`
  guards so a retry is a no-op.
- **No explicit BEGIN/COMMIT. No CONCURRENTLY.** (The boot runner wraps
  each file in its own transaction.)

## Exact migration SQL (proposed `0205_product_reviews.sql`)

```sql
-- 0205: Product reviews & ratings (Stack-100 #3, item #14) — verified-
-- purchase social proof for the two product rails:
--   * store_products  (creator storefront, /storefront/product/:id,
--     orders in store_orders with status='completed')
--   * shop_products   (marketplace shops, /shop/:handle, sales in
--     shop_events with event_type='sale' — paid truth since 0144)
--
-- One review per buyer per product (unique index below), editable by
-- its author, and EVERY row is a verified purchase: purchase_source +
-- purchase_id record the exact completed order/sale row the API gate
-- found before it would insert. There is no unverified insert path.
--
-- Seller moderation follows the house pattern (0174 reports / 0175
-- content removal): moderation is a STATE, never a delete. A seller
-- can respond, and can flag a review for platform moderation with a
-- recorded reason category; flagging with hide=true moves the review
-- to 'hidden_pending_review' — it leaves the public list, it is
-- DISCLOSED in the public summary (hidden_pending_count), it stays
-- fully visible to its author and in the seller's own dashboard, and
-- unflagging restores it. A seller can never delete a review and can
-- never hide one without a recorded abusive-content reason, so an
-- honest negative review cannot be silently buried.
--
-- Prices/fees: none. Reviews are free; no credits, no charges.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_type TEXT NOT NULL,
  product_id UUID NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  seller_user_id UUID NOT NULL,
  profile_id UUID,
  shop_id UUID,
  buyer_user_id UUID NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  purchase_source TEXT NOT NULL,
  purchase_id UUID NOT NULL,
  seller_response TEXT,
  seller_responded_at TIMESTAMPTZ,
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  flag_reason TEXT,
  flag_note TEXT,
  flagged_by_user_id UUID,
  flagged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_product_type_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_product_type_check
      CHECK (product_type IN ('store_product','shop_product'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_rating_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_rating_check
      CHECK (rating BETWEEN 1 AND 5);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_purchase_source_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_purchase_source_check
      CHECK (purchase_source IN ('store_orders','shop_events'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_moderation_status_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_moderation_status_check
      CHECK (moderation_status IN ('visible','hidden_pending_review'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_flag_reason_check') THEN
    ALTER TABLE product_reviews ADD CONSTRAINT product_reviews_flag_reason_check
      CHECK (flag_reason IS NULL OR flag_reason IN ('spam','harassment','hate_speech','profanity','sexual_content','violence','fraud','other'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_buyer_product_ux
  ON product_reviews (product_type, product_id, buyer_user_id);
CREATE INDEX IF NOT EXISTS product_reviews_product_idx
  ON product_reviews (product_type, product_id, moderation_status, created_at);
CREATE INDEX IF NOT EXISTS product_reviews_seller_idx
  ON product_reviews (seller_user_id, created_at);
CREATE INDEX IF NOT EXISTS product_reviews_buyer_idx
  ON product_reviews (buyer_user_id, created_at);
```

## Notes for the approver

- `product_id` / `purchase_id` deliberately carry **no FK**: a review is
  polymorphic over two product tables and two purchase tables, exactly
  like `shop_events.product_id` and `digital_sales.item_id` in the
  existing schema. Referential truth is enforced at the API gate — a
  review can only be inserted after the product row and a completed
  purchase row for that buyer have both been read in the same request.
- `product_title`, `seller_user_id`, `profile_id`, `shop_id` are
  snapshots taken at insert time so a review (and the seller's
  dashboard queue) survives a product rename or soft-deactivation —
  the same snapshot discipline `store_orders.product_title` uses.
- Until this migration is approved and applied, the API routes will
  fail closed on a real database (the table does not exist). The lane's
  tests run on the codebase's pg-mem pattern with DDL mirroring this
  file word-for-word in the test, as the other store suites do.
