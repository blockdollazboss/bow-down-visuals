import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/* ── UGC Product Ads (owner order Oct 19, 2026 — "we need to add ugc
   product ads" + "this is for business too") ──────────────────────────
   One feature, two sides, docked in Promote:
   - ugc_ads: one row per ad a member makes — for their own shop
     product, an uploaded product, their own business product (with a
     generated creator persona), or a brand brief they claimed. The row
     is the record of the whole job: product snapshot (server truth —
     for a shop product the name/price/image are copied from the
     shop_products row, never trusted from the client), style, face,
     script, the brand-kit snapshot applied at generation time, the
     caption track, and the finished video's STABLE storage ref (the
     playable URL is minted fresh on every read, never stored).
   - ugc_briefs: the business side's board. A brand posts a brief
     (product, what they want, style, deadline); a creator claims it,
     makes the ad with the same tool, delivers it back through the
     board, and the brand approves/closes it. Status walks
     open → claimed → delivered → approved (brand may close an
     open/claimed brief; a claimer may release a claim back to open).
     THERE IS NO PAYMENT RAIL in v1 by law: the site pays nobody real
     money, so briefs carry no price, fee, escrow, or Visual Bucs —
     payment is arranged between brand and creator directly, and the
     API + UI say so plainly.
   Owner-scoping everywhere: a foreign ad/brief reads as 404, never
   as forbidden-but-real. The single read exception is deliberate: the
   brand that a brief was delivered to may READ the delivered ad
   (through the brief), so they can review what they are approving. */

export interface UgcScript {
  hook: string;
  lines: string[];
  cta: string;
}

export interface UgcBrandSnapshot {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  vibe: string | null;
}

export const ugcBriefsTable = pgTable("ugc_briefs", {
  id:               uuid("id").primaryKey().defaultRandom(),
  brandUserId:      uuid("brand_user_id").notNull(),
  productName:      text("product_name").notNull(),
  /** Stable storage ref of the product photo, when one was supplied. */
  productImageRef:  text("product_image_ref"),
  productUrl:       text("product_url"),
  /** What the brand wants — the brief itself. */
  details:          text("details").notNull(),
  style:            text("style").notNull(),
  deadline:         timestamp("deadline", { withTimezone: true }),
  /** open | claimed | delivered | approved | closed */
  status:           text("status").notNull().default("open"),
  claimedByUserId:  uuid("claimed_by_user_id"),
  deliveredAdId:    uuid("delivered_ad_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ugc_briefs_status_created_idx").on(t.status, t.createdAt),
  index("ugc_briefs_brand_created_idx").on(t.brandUserId, t.createdAt),
  index("ugc_briefs_claimer_created_idx").on(t.claimedByUserId, t.createdAt),
]);

export const ugcAdsTable = pgTable("ugc_ads", {
  id:               uuid("id").primaryKey().defaultRandom(),
  userId:           uuid("user_id").notNull(),
  /** The brief this ad answers, when made from the briefs board. */
  briefId:          uuid("brief_id"),
  /** shop | upload */
  productSource:    text("product_source").notNull(),
  shopProductId:    uuid("shop_product_id"),
  productName:      text("product_name").notNull(),
  productBlurb:     text("product_blurb"),
  productPriceCents: integer("product_price_cents"),
  /** Stable storage ref of the product photo (never a stored URL). */
  productImageRef:  text("product_image_ref"),
  /** unboxing | honest-review | problem-fix | grwm */
  style:            text("style").notNull(),
  /** Stable ref/URL of the face the video is anchored on; null = product-only. */
  faceImageRef:     text("face_image_ref"),
  /** persona (generated) | photo (member's own) | none */
  faceKind:         text("face_kind").notNull().default("none"),
  script:           jsonb("script").$type<UgcScript>(),
  /** The caption track: hook + spoken lines + CTA, derived server-side
      from the script at generation time. Burned into the video when the
      caption burn succeeds; always carried on the record either way. */
  captions:         jsonb("captions").$type<string[]>().notNull().default([]),
  /** True only when the caption burn actually landed on the video. */
  captionsBurned:   boolean("captions_burned").notNull().default(false),
  /** The caller's brand kit as read at generation time. */
  brandSnapshot:    jsonb("brand_snapshot").$type<UgcBrandSnapshot>(),
  /** Stable storage ref of the finished video; null until ready. */
  videoRef:         text("video_ref"),
  /** draft | generating | ready | failed */
  status:           text("status").notNull().default("draft"),
  creditsCharged:   integer("credits_charged").notNull().default(0),
  /** The charge idempotency key of the current/last generation attempt. */
  generationKey:    text("generation_key"),
  videoAttempts:    integer("video_attempts").notNull().default(0),
  lastError:        text("last_error"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("ugc_ads_user_created_idx").on(t.userId, t.createdAt),
  index("ugc_ads_brief_idx").on(t.briefId),
]);

export type UgcAd = typeof ugcAdsTable.$inferSelect;
export type UgcBrief = typeof ugcBriefsTable.$inferSelect;
