/**
 * product-reviews.ts — pure helpers for product reviews & ratings
 * (Stack-100 #3, item #14). The route (routes/product-reviews.ts) owns
 * all DB access with raw SQL (the storefront/shops convention, so the
 * pg-mem suites can drive it); everything decidable without a database
 * lives here and is unit-pinned on both sides of the wire (the frontend
 * mirrors the summary math in artifacts/bow-down-visuals/src/lib/
 * product-reviews.ts — same shapes, same rounding).
 *
 * The honesty rules baked in here:
 *  - A rating is an integer 1..5. Nothing else is a rating.
 *  - The public summary is computed over VISIBLE reviews only, and the
 *    number of reviews hidden pending moderation is always disclosed
 *    alongside it — a seller hiding a review can never make the
 *    summary quietly prettier without the count showing.
 *  - Flag reasons are a closed abusive-content vocabulary. A low
 *    score is not in it and can never become a hide reason.
 */

export const PRODUCT_REVIEW_PRODUCT_TYPES = ["store_product", "shop_product"] as const;
export type ProductReviewProductType = (typeof PRODUCT_REVIEW_PRODUCT_TYPES)[number];

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

export const PRODUCT_REVIEW_FLAG_REASON_LABELS: Record<ProductReviewFlagReason, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  profanity: "Abusive profanity",
  sexual_content: "Sexual content",
  violence: "Violence or threats",
  fraud: "Fraud or scam content",
  other: "Other abusive content",
};

export function isProductReviewProductType(v: unknown): v is ProductReviewProductType {
  return v === "store_product" || v === "shop_product";
}

export function isProductReviewFlagReason(v: unknown): v is ProductReviewFlagReason {
  return typeof v === "string" && (PRODUCT_REVIEW_FLAG_REASONS as readonly string[]).includes(v);
}

/** A rating is exactly an integer star count, 1..5. */
export function isValidRating(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

export interface ReviewRatingRow {
  rating: number;
  moderationStatus: string;
}

export interface ProductReviewSummary {
  /** Visible reviews only — the reviews a buyer can actually read. */
  count: number;
  /** Mean of visible ratings, one decimal; null when count is 0. */
  average: number | null;
  /** Visible counts per star, keys "1".."5" (all present, zero-filled). */
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  /** Reviews the seller flagged + hid, awaiting platform moderation.
   *  Always disclosed next to the summary — hiding is never silent. */
  hiddenPendingCount: number;
  /** Every review ever written for the product (visible + hidden). */
  totalCount: number;
}

export function summarizeReviews(rows: ReviewRatingRow[]): ProductReviewSummary {
  const distribution: ProductReviewSummary["distribution"] = {
    "1": 0, "2": 0, "3": 0, "4": 0, "5": 0,
  };
  let visible = 0;
  let sum = 0;
  let hidden = 0;
  for (const r of rows) {
    if (r.moderationStatus === "hidden_pending_review") {
      hidden += 1;
      continue;
    }
    if (!isValidRating(r.rating)) continue;
    visible += 1;
    sum += r.rating;
    distribution[String(r.rating) as keyof typeof distribution] += 1;
  }
  return {
    count: visible,
    average: visible === 0 ? null : Math.round((sum / visible) * 10) / 10,
    distribution,
    hiddenPendingCount: hidden,
    totalCount: rows.length,
  };
}
