<<<<<<< HEAD
# MIGRATION NEEDED — post-purchase upsell (Stack-100 #3, Wave 3, Lane 1)
||||||| d0539e1d
# MIGRATION NEEDED — held, NOT applied by this lane
=======
# MIGRATION NEEDED — held, NOT applied by this lane (Wave 3 co-release; supersedes the phase-1 note in git history on this branch)
>>>>>>> stack29/w3-co-release

<<<<<<< HEAD
⛔ This lane does NOT write migrations (house rule). The feature is
built, tested against the post-migration DDL, and inert-but-honest
before this lands (verify records orders exactly as today with
`upsell: null`; the upsell endpoints answer 500 `UPSELL_UNAVAILABLE`).
Land this in the same stack as the branch, AFTER 0205 (order bumps).
||||||| d0539e1d
**Next free number verified:** `lib/db/migrations/` in stack28/integration
@ f96d7b72 tops out at `0204_abandoned_checkouts.sql`. This is **0205**.
=======
**Numbering:** `lib/db/migrations/` in this branch tops out at
`0204_abandoned_checkouts.sql`. Phase 1 (stack29/coposts) already holds
**0205** for `post_co_authors` in ITS `.lane/MIGRATION-NEEDED.md` (kept
in this branch's history — the file at the parent commit). This lane
therefore claims **0206**. If the join applies the two lanes in a
different order, renumber this file — nothing in the code depends on
the number.
>>>>>>> stack29/w3-co-release

<<<<<<< HEAD
## Exact migration — `lib/db/migrations/0206_storefront_post_purchase_upsell.sql`
||||||| d0539e1d
**Why a migration is required at all:** a Feed post today has exactly one
author (`posts.profile_id`) and there is no table that can honestly hold a
second author's consent state (pending / accepted / declined / withdrawn +
accept timestamp). Encoding it in `posts.media_urls` or
`collab_requests` would corrupt both. One new table is the whole schema
change — no existing table is altered, no column is added to `posts`
(the post stays a single row, which is precisely why engagement can
never double-count).

**What the code does until this lands (already built + tested):**
- All co-post WRITE routes probe/attempt against `post_co_authors` and
  answer `503 { error: "co_post_not_ready", … }` on Postgres 42P01 —
  no post row is created, nobody is notified, nothing half-exists.
- All READ paths (Feed enrichment, single-post read) catch 42P01 and
  behave exactly as today (no co-posts exist yet).
- The Drizzle schema (`lib/db/src/schema/collab.ts`,
  `postCoAuthorsTable`) is already in sync with this file, per the
  house rule that schema and migration ship together — the integrator
  only has to drop this file into `lib/db/migrations/`.

## Exact migration — `0205_co_posts.sql`
=======
**Why a migration is required at all:** a co-release needs a consent
ledger over a MONEY-BEARING split between two creator accounts. No
existing table can honestly hold it:
- `distribution_royalty_splits` is owner-only and versioned by
  unilateral edit (a PUT supersedes) — payees are names/emails, and no
  row records a second creator account's consent. Reusing it would let
  the owner rewrite a "consented" split alone, breaking immutability.
- `wave8_royalty_splits.collaborators` is free-form JSON with no
  consent state at all.
- `distribution_releases` / `store_products` are single-owner rows.
Two new tables are the whole schema change; no existing table is
altered. The Drizzle schema (`coReleasesTable` + `coReleaseSidesTable`
in `lib/db/src/schema/collab.ts`) is already in sync with this file.

**What the code does until this lands (built + tested):**
- All co-release WRITE routes probe both tables first and answer
  `503 { error: "co_release_not_ready", … }` on Postgres 42P01 —
  nothing is created, nobody is notified.
- READ routes (`/mine`, `/by-profile/:id`) treat a missing table as
  "no co-releases yet". Attribution answers the same honest 503.
- Split immutability is enforced TWICE: the pure machine offers no
  post-publish mutation, and the migration's trigger (below) refuses
  any UPDATE that changes `agreed_share_pct`, `agreed_at`, or
  `published_at` once set — even a hand-written SQL edit cannot
  rewrite an agreed split.

## Exact migration — `0206_co_releases.sql`
>>>>>>> stack29/w3-co-release

```sql
<<<<<<< HEAD
-- 0206: Post-purchase one-click upsell for the storefront rail
-- (Stack-100 #3, Wave 3). After a purchase completes, the buyer is
-- offered the product's designated add-on (the SAME seller attachment
-- as the checkout bump: store_products.bump_product_id /
-- bump_percent_off) once, and can accept in one click — charged
-- off-session to the payment method saved by the completed checkout
-- through a PaymentIntent with a deterministic idempotency key.
||||||| d0539e1d
-- 0205_co_posts.sql
-- Co-posts & collab releases, Feed half (Stack-100 #3, #24): ONE post,
-- TWO author sides. The post row in `posts` stays single (its like /
-- reply / repost counts exist exactly once — engagement never
-- double-counts); this table records each creator's side + consent.
=======
-- 0206_co_releases.sql
-- Co-releases (Stack-100 #3 Wave 3, co-posts phase 2): ONE existing
-- release (distribution_releases) or store product (store_products)
-- published to BOTH creators' profiles, with a royalty split BOTH
-- creators approve before anything publishes.
>>>>>>> stack29/w3-co-release
--
<<<<<<< HEAD
-- The offer state lives in store_upsell_offers: ONE row per parent
-- order (UNIQUE parent_order_id), carrying the price/fee snapshot the
-- buyer saw, the saved Stripe customer + payment method, and the
-- decision. An accepted upsell records as its OWN store_orders row,
-- linked back by parent_order_id and pinned exactly-once by the
-- UNIQUE stripe_payment_intent_id.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.
||||||| d0539e1d
-- Status machine (api-server src/lib/co-posts.ts is the source):
--   author side starts 'accepted', co-author side starts 'pending';
--   published <=> every side has accepted_at set (kept after withdraw);
--   'declined' is pre-live only and ends the co-post;
--   'withdrawn' removes ONLY that side — the post leaves that creator's
--   profile and the other creator keeps theirs.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house migration rules).
=======
-- Consent machine (api-server src/lib/co-releases.ts is the source):
--   author side starts 'accepted' with the proposed share_pct;
--   co-author side starts 'pending'; published <=> head.published_at
--   is set, which happens exactly when the second side accepts — at
--   that same moment each side's agreed_share_pct is frozen from the
--   proposed share it approved. 'declined' is pre-live only;
--   'withdrawn' removes ONLY that side's profile copy and never
--   touches the agreed columns.
-- Shares are creator-entered percentages; the per-row CHECK guards
-- range only — the sum-to-100 rule spans rows, so it is enforced in
-- the API machine, exactly like distribution_royalty_splits.
-- The platform fee is NOT in these tables: store rails take their
-- flat 5% first; splits divide creator amounts only.
-- Idempotent, no BEGIN/COMMIT, no CONCURRENTLY (house rules).
>>>>>>> stack29/w3-co-release

<<<<<<< HEAD
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid;
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text UNIQUE;

CREATE TABLE IF NOT EXISTS store_upsell_offers (
||||||| d0539e1d
CREATE TABLE IF NOT EXISTS post_co_authors (
=======
CREATE TABLE IF NOT EXISTS co_releases (
>>>>>>> stack29/w3-co-release
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
<<<<<<< HEAD
  parent_order_id uuid NOT NULL UNIQUE,
  buyer_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  product_id uuid NOT NULL,
  upsell_product_id uuid NOT NULL,
  upsell_title text NOT NULL,
  upsell_kind text NOT NULL,
  list_price_cents integer NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL,
  creator_amount_cents integer NOT NULL,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_method_brand text,
  payment_method_last4 text,
||||||| d0539e1d
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_author',
=======
  item_kind text NOT NULL DEFAULT 'release',
  item_id uuid NOT NULL,
  item_title text NOT NULL DEFAULT '',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT co_releases_item_kind_check
    CHECK (item_kind IN ('release','product'))
);

CREATE TABLE IF NOT EXISTS co_release_sides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  co_release_id uuid NOT NULL REFERENCES co_releases(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_author',
>>>>>>> stack29/w3-co-release
  status text NOT NULL DEFAULT 'pending',
<<<<<<< HEAD
  failure_reason text,
  stripe_payment_intent_id text,
  upsell_order_id uuid,
  shown_at timestamptz,
  decided_at timestamptz,
||||||| d0539e1d
  accepted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  collab_request_id uuid REFERENCES collab_requests(id) ON DELETE SET NULL,
=======
  share_pct numeric(5,2) NOT NULL,
  agreed_share_pct numeric(5,2),
  accepted_at timestamptz,
  responded_at timestamptz,
  withdrawn_at timestamptz,
  agreed_at timestamptz,
>>>>>>> stack29/w3-co-release
  created_at timestamptz NOT NULL DEFAULT now(),
<<<<<<< HEAD
  updated_at timestamptz NOT NULL DEFAULT now()
||||||| d0539e1d
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_co_authors_role_check
    CHECK (role IN ('author','co_author')),
  CONSTRAINT post_co_authors_status_check
    CHECK (status IN ('pending','accepted','declined','withdrawn'))
=======
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT co_release_sides_role_check
    CHECK (role IN ('author','co_author')),
  CONSTRAINT co_release_sides_status_check
    CHECK (status IN ('pending','accepted','declined','withdrawn')),
  CONSTRAINT co_release_sides_share_range_check
    CHECK (share_pct > 0 AND share_pct < 100),
  CONSTRAINT co_release_sides_agreed_range_check
    CHECK (agreed_share_pct IS NULL OR (agreed_share_pct > 0 AND agreed_share_pct < 100))
>>>>>>> stack29/w3-co-release
);

<<<<<<< HEAD
ALTER TABLE store_upsell_offers
  DROP CONSTRAINT IF EXISTS store_upsell_offers_status_range;
ALTER TABLE store_upsell_offers
  ADD CONSTRAINT store_upsell_offers_status_range
  CHECK (status IN ('pending', 'accepted', 'declined', 'failed'));
||||||| d0539e1d
CREATE UNIQUE INDEX IF NOT EXISTS post_co_authors_post_profile_uidx
  ON post_co_authors (post_id, profile_id);
CREATE INDEX IF NOT EXISTS post_co_authors_post_idx
  ON post_co_authors (post_id);
CREATE INDEX IF NOT EXISTS post_co_authors_profile_status_idx
  ON post_co_authors (profile_id, status);
CREATE INDEX IF NOT EXISTS post_co_authors_user_status_idx
  ON post_co_authors (user_id, status);
=======
CREATE UNIQUE INDEX IF NOT EXISTS co_release_sides_release_profile_uidx
  ON co_release_sides (co_release_id, profile_id);
CREATE INDEX IF NOT EXISTS co_releases_item_idx
  ON co_releases (item_kind, item_id);
CREATE INDEX IF NOT EXISTS co_releases_published_idx
  ON co_releases (published_at);
CREATE INDEX IF NOT EXISTS co_release_sides_release_idx
  ON co_release_sides (co_release_id);
CREATE INDEX IF NOT EXISTS co_release_sides_profile_status_idx
  ON co_release_sides (profile_id, status);
CREATE INDEX IF NOT EXISTS co_release_sides_user_status_idx
  ON co_release_sides (user_id, status);

-- Immutability: once frozen at publish, the agreed split and the
-- publish moment can never be rewritten — by the API or by hand.
CREATE OR REPLACE FUNCTION co_release_freeze_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.agreed_share_pct IS NOT NULL AND NEW.agreed_share_pct IS DISTINCT FROM OLD.agreed_share_pct THEN
    RAISE EXCEPTION 'co_release agreed_share_pct is immutable once agreed';
  END IF;
  IF OLD.agreed_at IS NOT NULL AND NEW.agreed_at IS DISTINCT FROM OLD.agreed_at THEN
    RAISE EXCEPTION 'co_release agreed_at is immutable once agreed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS co_release_sides_freeze ON co_release_sides;
CREATE TRIGGER co_release_sides_freeze
  BEFORE UPDATE ON co_release_sides
  FOR EACH ROW EXECUTE FUNCTION co_release_freeze_guard();

CREATE OR REPLACE FUNCTION co_release_head_freeze_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'co_release published_at is immutable once published';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS co_releases_freeze ON co_releases;
CREATE TRIGGER co_releases_freeze
  BEFORE UPDATE ON co_releases
  FOR EACH ROW EXECUTE FUNCTION co_release_head_freeze_guard();
>>>>>>> stack29/w3-co-release
```

<<<<<<< HEAD
Notes: deliberately NO foreign keys — an offer/order is a historical
record and must survive product deactivation/deletion, mirroring
`store_orders.product_id` (plain uuid, no FK). `stripe_payment_intent_id`
UNIQUE allows any number of NULLs (every non-upsell order), so legacy
rows are untouched. No extra indexes: lookups are always by
parent_order_id (unique) or order id.

## Matching drizzle additions (same commit as the migration, NOT in this lane)

`lib/db/src/schema/storefront.ts` — deliberately NOT edited by this
lane (same reasoning as the bumps lane: full-row selects elsewhere
would break before the migration lands). The API rail speaks raw SQL
for all of this, so the additions are for schema completeness:

```ts
// storeOrdersTable:
parentOrderId:        uuid("parent_order_id"),
stripePaymentIntentId: text("stripe_payment_intent_id").unique(),

// new table:
export const storeUpsellOffersTable = pgTable("store_upsell_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentOrderId: uuid("parent_order_id").notNull().unique(),
  buyerUserId: uuid("buyer_user_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  productId: uuid("product_id").notNull(),
  upsellProductId: uuid("upsell_product_id").notNull(),
  upsellTitle: text("upsell_title").notNull(),
  upsellKind: text("upsell_kind").notNull(),
  listPriceCents: integer("list_price_cents").notNull(),
  percentOff: integer("percent_off").notNull().default(0),
  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  creatorAmountCents: integer("creator_amount_cents").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  paymentMethodBrand: text("payment_method_brand"),
  paymentMethodLast4: text("payment_method_last4"),
  status: text("status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  upsellOrderId: uuid("upsell_order_id"),
  shownAt: timestamp("shown_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("store_upsell_offers_status_range",
    sql`${t.status} IN ('pending', 'accepted', 'declined', 'failed')`),
]);
```

After editing the schema, rebuild the dist (`tsc -b .` from `lib/db`)
before typechecking the api-server, per house rule.
||||||| d0539e1d
Notes for whoever applies it:
- `gen_random_uuid()` is already used by every neighbouring table
  (pgcrypto / PG13+ built-in) — no extension statement needed.
- Table name, column names, check values and index names match
  `postCoAuthorsTable` in `lib/db/src/schema/collab.ts` exactly.
- No backfill: there are no co-posts before this feature exists.
- Rollback (if ever wanted) is `DROP TABLE post_co_authors;` — `posts`
  rows created as co-posts remain ordinary posts of their initiator.
=======
Notes for whoever applies it:
- `item_id` carries no FK on purpose: it points at one of two tables
  (`distribution_releases` or `store_products`); the route validates
  ownership against the correct table at draft time, and
  `item_title` is snapshotted so lists survive item deletion.
- No backfill: there are no co-releases before this feature exists.
- Rollback is `DROP TABLE co_release_sides; DROP TABLE co_releases;`
  (plus the two guard functions) — the underlying releases/products
  remain ordinary solo items of their owners.

## Money-rail hold (reported, not faked)
- **Releases:** attribution IS built in the read layer —
  `GET /api/co-releases/:id/attribution` applies the frozen split to
  the author's logged income (`money_entries` linked to the release,
  on/after the publish date) — the same accounting model as
  `GET /api/splits/overview`. It is NOT mirrored into
  `distribution_royalty_splits`, deliberately: that ledger's owner-only
  PUT supersedes versions unilaterally, so mirroring would let one
  side silently supersede a split the other side consented to.
  Integrator decision if the two views should ever merge: the PUT
  must refuse to supersede a version that came from a published
  co-release.
- **Products:** attribution IS built — the same endpoint splits
  completed `store_orders.creator_amount_cents` (post-fee creator
  amount) for orders on/after publish. The checkout rail itself is
  untouched: it still records one creator amount to the item's owner;
  splitting AT the rail (per-side order rows / balances) would need
  its own migration + money review and is NOT claimed here. No payout
  exists anywhere in this lane — the site pays nobody real money.
>>>>>>> stack29/w3-co-release
