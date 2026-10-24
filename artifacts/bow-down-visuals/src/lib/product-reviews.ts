/**
 * product-reviews.ts — pure helpers for product reviews & ratings
 * (Stack-100 #3, #14), shared by the public product surfaces and the
 * seller dashboards. Mirrors the API's summary math
 * (artifacts/api-server/src/lib/product-reviews.ts) exactly — same
 * shapes, same one-decimal rounding — so what a page computes from a
 * review list can never disagree with what the server reports.
 *
 * Every review these helpers ever see is a VERIFIED purchase: the API
 * only creates a review after a completed purchase on the product's
 * rail (store_orders 'completed' / shop_events 'sale'). There is no
 * unverified state to render.
 */

export type ProductReviewProductType = "store_product" | "shop_product";

export interface ProductReview {
  id: string;
  productType: ProductReviewProductType;
  productId: string;
  productTitle: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  purchaseSource: "store_orders" | "shop_events";
  buyer: { displayName: string };
  sellerResponse: string | null;
  sellerRespondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  moderation: {
    status: "visible" | "hidden_pending_review";
    flagged: boolean;
    flagReason?: string | null;
    flagNote?: string | null;
    flaggedAt?: string | null;
  };
}

export interface ProductReviewSummary {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  hiddenPendingCount: number;
  totalCount: number;
}

export const EMPTY_SUMMARY: ProductReviewSummary = {
  count: 0,
  average: null,
  distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  hiddenPendingCount: 0,
  totalCount: 0,
};

/** Star row for a rating: 5 slots, filled up to the rating. Accepts a
 *  fractional average (3.3) and rounds to the nearest half-step fill:
 *  slots are "full" | "half" | "empty". For an integer review rating
 *  every slot is full or empty. */
export type StarSlot = "full" | "half" | "empty";
export function starsFor(value: number | null): StarSlot[] {
  if (value == null || !Number.isFinite(value)) return ["empty", "empty", "empty", "empty", "empty"];
  const v = Math.min(5, Math.max(0, value));
  return [1, 2, 3, 4, 5].map((i) => {
    if (v >= i - 0.25) return "full" as const;
    if (v >= i - 0.75) return "half" as const;
    return "empty" as const;
  });
}

/** "4.7" for an average, "No reviews yet" copy is the caller's job —
 *  this returns null for the empty state so pages choose their words. */
export function averageLabel(summary: ProductReviewSummary): string | null {
  return summary.average == null ? null : summary.average.toFixed(1);
}

/** Share of visible reviews at each star, 0..100 (zero when empty). */
export function distributionPct(summary: ProductReviewSummary, star: 1 | 2 | 3 | 4 | 5): number {
  if (summary.count === 0) return 0;
  return Math.round((summary.distribution[String(star) as keyof ProductReviewSummary["distribution"]] / summary.count) * 100);
}

/** Client-side mirror of the server summary (visible rows only;
 *  hidden rows arrive pre-counted from the server and are never in
 *  the public list, so this is for seller-queue math). */
export function summarizeVisible(reviews: Pick<ProductReview, "rating">[]): ProductReviewSummary {
  const distribution: ProductReviewSummary["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let sum = 0;
  for (const r of reviews) {
    if (Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5) {
      distribution[String(r.rating) as keyof typeof distribution] += 1;
      sum += r.rating;
    }
  }
  const count = reviews.length;
  return {
    count,
    average: count === 0 ? null : Math.round((sum / count) * 10) / 10,
    distribution,
    hiddenPendingCount: 0,
    totalCount: count,
  };
}

/** The closed seller-flag vocabulary (mirrors the API + migration
 *  0205 check). A low rating is deliberately NOT here. */
export const FLAG_REASONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "profanity", label: "Abusive profanity" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "fraud", label: "Fraud or scam content" },
  { value: "other", label: "Other abusive content" },
] as const;

export function flagReasonLabel(value: string | null | undefined): string {
  return FLAG_REASONS.find((r) => r.value === value)?.label ?? "Flagged for moderation";
}
