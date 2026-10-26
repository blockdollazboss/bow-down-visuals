import { pgTable, uuid, text, integer, timestamp, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Make-an-offer (migration 9999-wave4346 PROVISIONAL, Wave 4 #43) ────
   A buyer proposes a price below list on a storefront product
   (store_products) or a shop product (shop_products); the seller
   accepts, declines, or counters; the buyer can accept, decline, or
   counter a counter. An ACCEPTED offer carries one agreed price, and
   that price — never a client-supplied amount — is what the EXISTING
   checkout charges:

   - store_product → POST /api/storefront/checkout { offerId } prices
     the session at agreed_amount_cents; verify records the order from
     the session total exactly as before (fee split, refund and
     entitlement rules all ride the same store_orders rail), and the
     paid flip consumes the offer.
   - shop_product → POST /api/storefronts/checkout { offerId } prices
     the single line at agreed_amount_cents; the shared market-sale
     paid flip (verify + webhook) consumes the offer.

   Money law (standing): sales are real money via Stripe TEST mode;
   this table never moves Visual Bucs and never pays anyone out — the
   seller's net stays a pending balance on the existing order rows,
   settled by the existing payout path. The platform fee still comes
   out of the seller's cut at the EXISTING checkout's flat 5% split —
   an offer changes the gross, never the fee rule.

   Negotiation law:
   - an offer is 1..list-1 cents (a full-price "offer" is a purchase,
     a zero offer is a claim, neither is a negotiation);
   - a counter must sit strictly between the amount it answers and
     the list price — every round narrows toward a deal;
   - one OPEN offer per (buyer, product): open = pending, countered,
     or accepted-not-yet-consumed;
   - offers expire 7 days after the last move (expires_at); expiry is
     lazy — reads and checkout flip a stale open row to 'expired';
   - an accepted offer can be claimed by ONE checkout at a time
     (claimed_* + a 30-minute claim window, the gift-card hold
     pattern); the claim is released when session creation fails and
     consumed exactly once when the sale records. */

export const PRODUCT_OFFER_ITEM_KINDS = ["store_product", "shop_product"] as const;
export type ProductOfferItemKind = (typeof PRODUCT_OFFER_ITEM_KINDS)[number];

export const PRODUCT_OFFER_STATUSES = [
  "pending", "countered", "accepted", "declined", "withdrawn", "expired", "consumed",
] as const;
export type ProductOfferStatus = (typeof PRODUCT_OFFER_STATUSES)[number];

/** Statuses in which the negotiation (or its accepted price) is live. */
export const OPEN_PRODUCT_OFFER_STATUSES: ProductOfferStatus[] = ["pending", "countered", "accepted"];

export const productOffersTable = pgTable("product_offers", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  buyerUserId:        uuid("buyer_user_id").notNull(),
  sellerUserId:       uuid("seller_user_id").notNull(),
  itemKind:           text("item_kind").notNull().$type<ProductOfferItemKind>(),
  itemId:             uuid("item_id").notNull(),
  /** store_product only: the creator profile that owns the product. */
  profileId:          uuid("profile_id"),
  /** shop_product only: the shop that owns the product. */
  shopId:             uuid("shop_id"),
  /** The product's list price when the offer was made (snapshot). */
  listPriceCents:     integer("list_price_cents").notNull(),
  /** The buyer's current proposed price. */
  offerAmountCents:   integer("offer_amount_cents").notNull(),
  /** The seller's counter price while status='countered'. */
  counterAmountCents: integer("counter_amount_cents"),
  /** The final agreed price once status reaches 'accepted'. */
  agreedAmountCents:  integer("agreed_amount_cents"),
  status:             text("status").notNull().default("pending").$type<ProductOfferStatus>(),
  /** Optional buyer note that rides the first proposal. */
  message:            text("message").notNull().default(""),
  expiresAt:          timestamp("expires_at", { withTimezone: true }).notNull(),
  /* Checkout claim (one live checkout per accepted offer): the
     storefront session id or the shops checkout group id that holds
     the claim, stamped when the session opens; a claim older than
     30 minutes is stale and may be taken over (an abandoned
     checkout must not burn the offer). */
  claimedRef:         text("claimed_ref"),
  claimedAt:          timestamp("claimed_at", { withTimezone: true }),
  /** The session/group ref whose recorded sale consumed the offer. */
  consumedRef:        text("consumed_ref"),
  consumedAt:         timestamp("consumed_at", { withTimezone: true }),
  decidedAt:          timestamp("decided_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("product_offers_item_kind_check", sql`${t.itemKind} IN ('store_product', 'shop_product')`),
  check("product_offers_status_check", sql`${t.status} IN ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired', 'consumed')`),
  check("product_offers_list_nonneg", sql`${t.listPriceCents} > 0`),
  check("product_offers_amount_range", sql`${t.offerAmountCents} > 0 AND ${t.offerAmountCents} < ${t.listPriceCents}`),
  check("product_offers_counter_range", sql`${t.counterAmountCents} IS NULL OR (${t.counterAmountCents} > ${t.offerAmountCents} AND ${t.counterAmountCents} < ${t.listPriceCents})`),
  check("product_offers_agreed_range", sql`${t.agreedAmountCents} IS NULL OR (${t.agreedAmountCents} > 0 AND ${t.agreedAmountCents} < ${t.listPriceCents})`),
  index("product_offers_buyer_idx").on(t.buyerUserId),
  index("product_offers_seller_idx").on(t.sellerUserId),
  index("product_offers_item_idx").on(t.itemKind, t.itemId),
]);

export const insertProductOfferSchema = createInsertSchema(productOffersTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertProductOffer = z.infer<typeof insertProductOfferSchema>;
export type ProductOffer = typeof productOffersTable.$inferSelect;
