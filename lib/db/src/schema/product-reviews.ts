import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Product reviews & ratings (Stack-100 #3, item #14) — verified-purchase
 * social proof. PENDING MIGRATION 0205 (held for owner approval — see
 * .lane/MIGRATION-NEEDED.md in the lane worktree; this file is the
 * schema source-of-truth drafted to match that SQL exactly).
 *
 * NOT the review_links system: review_links/review_comments are
 * creative feedback on shared work via a token link (no product, no
 * buyer, no rating). This table is the opposite shape — a review
 * exists ONLY because a completed purchase exists.
 *
 * The two product rails it covers:
 *   - 'store_product' → store_products (creator storefront); purchase
 *     proof is a store_orders row, buyer_user_id = reviewer,
 *     status = 'completed' (paid verify AND $0 claims both land
 *     'completed'; refunded/cancelled/held rows never count).
 *   - 'shop_product' → shop_products (marketplace shops); purchase
 *     proof is a shop_events row with event_type = 'sale' (paid truth
 *     since migration 0144) whose buyer_email matches the reviewer's
 *     account email — that rail records buyers by email, not user id.
 *
 * One review per buyer per product (unique index), editable by its
 * author. Seller moderation is a STATE, never a delete (the 0174/0175
 * house pattern): sellers respond, and flag with a recorded reason;
 * a flagged-with-hide review is 'hidden_pending_review' — disclosed
 * in the public summary count, still visible to author + seller.
 */

export const PRODUCT_REVIEW_PRODUCT_TYPES = ["store_product", "shop_product"] as const;
export type ProductReviewProductType = (typeof PRODUCT_REVIEW_PRODUCT_TYPES)[number];

export const PRODUCT_REVIEW_PURCHASE_SOURCES = ["store_orders", "shop_events"] as const;
export type ProductReviewPurchaseSource = (typeof PRODUCT_REVIEW_PURCHASE_SOURCES)[number];

export const PRODUCT_REVIEW_MODERATION_STATUSES = ["visible", "hidden_pending_review"] as const;
export type ProductReviewModerationStatus = (typeof PRODUCT_REVIEW_MODERATION_STATUSES)[number];

/** Why a seller may flag a review for platform moderation. Mirrors the
 *  reason-category vocabulary of content reports / post removals
 *  (0174/0175). A low rating is NEVER a reason — there is deliberately
 *  no 'negative'/'unfair' value here. */
export const PRODUCT_REVIEW_FLAG_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "profanity",
  "sexual_content",
  "violence",
  "fraud",
  "other",
] as const;
export type ProductReviewFlagReason = (typeof PRODUCT_REVIEW_FLAG_REASONS)[number];

export const productReviewsTable = pgTable("product_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  productType: text("product_type").notNull().$type<ProductReviewProductType>(),
  productId: uuid("product_id").notNull(),
  /** Snapshot at insert (store_orders.product_title discipline): the
   *  review and the seller queue survive a rename / deactivation. */
  productTitle: text("product_title").notNull().default(""),
  sellerUserId: uuid("seller_user_id").notNull(),
  /** Store rail: the creator profile that owns the product. */
  profileId: uuid("profile_id"),
  /** Shop rail: the shop that owns the product. */
  shopId: uuid("shop_id"),
  buyerUserId: uuid("buyer_user_id").notNull(),
  rating: integer("rating").notNull(),
  title: text("title"),
  body: text("body").notNull(),
  purchaseSource: text("purchase_source").notNull().$type<ProductReviewPurchaseSource>(),
  purchaseId: uuid("purchase_id").notNull(),
  sellerResponse: text("seller_response"),
  sellerRespondedAt: timestamp("seller_responded_at", { withTimezone: true }),
  moderationStatus: text("moderation_status")
    .notNull()
    .default("visible")
    .$type<ProductReviewModerationStatus>(),
  flagReason: text("flag_reason").$type<ProductReviewFlagReason>(),
  flagNote: text("flag_note"),
  flaggedByUserId: uuid("flagged_by_user_id"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("product_reviews_product_type_check", sql`${t.productType} IN ('store_product','shop_product')`),
  check("product_reviews_rating_check", sql`${t.rating} BETWEEN 1 AND 5`),
  check("product_reviews_purchase_source_check", sql`${t.purchaseSource} IN ('store_orders','shop_events')`),
  check("product_reviews_moderation_status_check", sql`${t.moderationStatus} IN ('visible','hidden_pending_review')`),
  check(
    "product_reviews_flag_reason_check",
    sql`${t.flagReason} IS NULL OR ${t.flagReason} IN ('spam','harassment','hate_speech','profanity','sexual_content','violence','fraud','other')`,
  ),
  uniqueIndex("product_reviews_buyer_product_ux").on(t.productType, t.productId, t.buyerUserId),
  index("product_reviews_product_idx").on(t.productType, t.productId, t.moderationStatus, t.createdAt),
  index("product_reviews_seller_idx").on(t.sellerUserId, t.createdAt),
  index("product_reviews_buyer_idx").on(t.buyerUserId, t.createdAt),
]);

export const insertProductReviewSchema = createInsertSchema(productReviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectProductReviewSchema = createSelectSchema(productReviewsTable);

export type ProductReview = typeof productReviewsTable.$inferSelect;
export type InsertProductReview = z.infer<typeof insertProductReviewSchema>;
