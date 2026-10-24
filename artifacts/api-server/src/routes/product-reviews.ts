/**
 * product-reviews.ts — Product reviews & ratings (Stack-100 #3, #14).
 *
 * Verified-purchase social proof for the two product rails:
 *   - store_product → store_products (creator storefront,
 *     /storefront/product/:id); proof = a store_orders row with
 *     buyer_user_id = caller and status = 'completed'.
 *   - shop_product → shop_products (marketplace shops, /shop/:handle);
 *     proof = a shop_events row with event_type = 'sale' (paid truth
 *     since migration 0144) whose buyer_email matches the caller's
 *     account email — that rail records buyers by email, not user id.
 *
 * NOT the review_links system: those are creative-feedback token links
 * (no product, no buyer, no rating) and stay untouched.
 *
 * Endpoints (mounted at /api):
 *   GET    /product-reviews?productType=&productId=   public: visible
 *          reviews + summary (summary discloses hidden-pending count)
 *   GET    /product-reviews/summary?productType=&productId=  public
 *   GET    /product-reviews/eligibility?productType=&productId=  auth:
 *          can this caller review it, and if not, honestly why
 *   POST   /product-reviews            auth: create (verified gate)
 *   PATCH  /product-reviews/:id        auth: author edits own review
 *   DELETE /product-reviews/:id        auth: AUTHOR only — a seller
 *          can never delete a review of their own product
 *   GET    /product-reviews/seller     auth: the seller's queue across
 *          their products, ALL moderation states visible
 *   POST   /product-reviews/:id/respond  auth: seller response
 *   POST   /product-reviews/:id/flag     auth: seller flags for
 *          platform moderation (recorded reason required; hiding is
 *          opt-in per flag and always disclosed — see below)
 *   POST   /product-reviews/:id/unflag   auth: seller undoes a flag
 *          (restores visibility, clears the flag record)
 *
 * Seller moderation follows the house pattern (0174 reports: filing
 * never silently acts; 0175 removal: moderation is a state with a
 * recorded reason category, never a delete):
 *   - There is NO seller delete, anywhere.
 *   - A flag REQUIRES a reason from the closed abusive-content
 *     vocabulary (lib/product-reviews) — a low rating can never be a
 *     reason, so an honest negative review cannot be flagged away
 *     as "negative".
 *   - Hiding is a separate explicit choice on the flag. A hidden
 *     review leaves the public list but is NOT silent: the public
 *     summary carries hiddenPendingCount, the review stays fully
 *     visible to its author and in the seller's own queue, and the
 *     row (rating, body, flag reason) is never altered or deleted.
 *
 * Money: reviews are free. No credits, no fees, no charges anywhere.
 *
 * PENDING MIGRATION 0205: the product_reviews table is held for owner
 * approval (.lane/MIGRATION-NEEDED.md). Queries use raw SQL via
 * db.execute (the storefront/shops convention) so the pg-mem suites
 * drive this router against DDL mirroring the held migration.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  PRODUCT_REVIEW_FLAG_REASONS,
  isProductReviewFlagReason,
  summarizeReviews,
  type ProductReviewProductType,
} from "../lib/product-reviews";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Row shapes + DTO ──────────────────────────────────────────────── */
interface ReviewRow extends Record<string, unknown> {
  id: string;
  product_type: string;
  product_id: string;
  product_title: string;
  seller_user_id: string;
  profile_id: string | null;
  shop_id: string | null;
  buyer_user_id: string;
  buyer_name: string | null;
  rating: number;
  title: string | null;
  body: string;
  purchase_source: string;
  purchase_id: string;
  seller_response: string | null;
  seller_responded_at: string | null;
  moderation_status: string;
  flag_reason: string | null;
  flag_note: string | null;
  flagged_by_user_id: string | null;
  flagged_at: string | null;
  created_at: string;
  updated_at: string;
}

function reviewDto(r: ReviewRow, opts: { forSeller?: boolean; forAuthor?: boolean } = {}) {
  const flagged = r.flagged_at != null;
  return {
    id: r.id,
    productType: r.product_type,
    productId: r.product_id,
    productTitle: r.product_title,
    rating: Number(r.rating),
    title: r.title ?? null,
    body: r.body,
    /* Every review on this system is a verified purchase by
       construction — the gate is the insert path, not a badge a
       reviewer can claim. */
    verifiedPurchase: true,
    purchaseSource: r.purchase_source,
    buyer: { displayName: r.buyer_name?.trim() ? r.buyer_name : "Verified buyer" },
    sellerResponse: r.seller_response ?? null,
    sellerRespondedAt: r.seller_responded_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    /* Moderation state is public knowledge, not a secret: buyers see
       that a review is flagged (never its seller-only note), sellers
       and the author see the full record. */
    moderation: {
      status: r.moderation_status,
      flagged,
      ...(opts.forSeller || opts.forAuthor
        ? {
            flagReason: r.flag_reason ?? null,
            flagNote: opts.forSeller ? (r.flag_note ?? null) : undefined,
            flaggedAt: r.flagged_at ?? null,
          }
        : {}),
    },
  };
}

const REVIEW_COLS = sql`
  r.id, r.product_type, r.product_id, r.product_title, r.seller_user_id,
  r.profile_id, r.shop_id, r.buyer_user_id, r.rating, r.title, r.body,
  r.purchase_source, r.purchase_id, r.seller_response, r.seller_responded_at,
  r.moderation_status, r.flag_reason, r.flag_note, r.flagged_by_user_id,
  r.flagged_at, r.created_at, r.updated_at,
  pr.display_name AS buyer_name
`;

async function fetchReview(id: string): Promise<ReviewRow | null> {
  const r = await db.execute(sql`
    SELECT ${REVIEW_COLS}
    FROM product_reviews r
    LEFT JOIN profiles pr ON pr.id = r.buyer_user_id
    WHERE r.id = ${id}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as ReviewRow | undefined) ?? null;
}

async function fetchProductReviews(productType: string, productId: string): Promise<ReviewRow[]> {
  const r = await db.execute(sql`
    SELECT ${REVIEW_COLS}
    FROM product_reviews r
    LEFT JOIN profiles pr ON pr.id = r.buyer_user_id
    WHERE r.product_type = ${productType} AND r.product_id = ${productId}
    ORDER BY r.created_at DESC
    LIMIT 200
  `);
  return r.rows as unknown as ReviewRow[];
}

/* ── Product + purchase resolution (the verified gate) ─────────────── */
interface ProductInfo {
  id: string;
  title: string;
  sellerUserId: string;
  profileId: string | null;
  shopId: string | null;
}

async function resolveProduct(
  productType: ProductReviewProductType,
  productId: string,
): Promise<ProductInfo | null> {
  if (productType === "store_product") {
    const r = await db.execute(sql`
      SELECT sp.id, sp.title, sp.profile_id, cp.user_id AS seller_user_id
      FROM store_products sp
      JOIN creator_profiles cp ON cp.id = sp.profile_id
      WHERE sp.id = ${productId}
      LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row["id"]),
      title: String(row["title"] ?? ""),
      sellerUserId: String(row["seller_user_id"]),
      profileId: String(row["profile_id"]),
      shopId: null,
    };
  }
  const r = await db.execute(sql`
    SELECT shp.id, shp.name AS title, shp.shop_id, s.user_id AS seller_user_id
    FROM shop_products shp
    JOIN shops s ON s.id = shp.shop_id
    WHERE shp.id = ${productId}
    LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    title: String(row["title"] ?? ""),
    sellerUserId: String(row["seller_user_id"]),
    profileId: null,
    shopId: String(row["shop_id"]),
  };
}

/** The completed purchase that makes a review verified, or null.
 *  Store rail: store_orders status='completed' for THIS buyer user id
 *  (refunded / cancelled / booking_held rows are not purchases of
 *  record). Shop rail: a shop_events 'sale' row for this product whose
 *  buyer_email matches the caller's account email (the rail's only
 *  buyer identity); 'pending_sale' rows are never a sale. */
async function findCompletedPurchase(
  productType: ProductReviewProductType,
  productId: string,
  buyerUserId: string,
  buyerEmail: string | null,
): Promise<{ source: "store_orders" | "shop_events"; id: string } | null> {
  if (productType === "store_product") {
    const r = await db.execute(sql`
      SELECT id FROM store_orders
      WHERE buyer_user_id = ${buyerUserId} AND product_id = ${productId}
        AND status = 'completed'
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? { source: "store_orders", id: String(row["id"]) } : null;
  }
  const email = (buyerEmail ?? "").trim().toLowerCase();
  if (!email) return null;
  const r = await db.execute(sql`
    SELECT id FROM shop_events
    WHERE product_id = ${productId} AND event_type = 'sale'
      AND buyer_email IS NOT NULL AND LOWER(buyer_email) = ${email}
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? { source: "shop_events", id: String(row["id"]) } : null;
}

async function findExistingReview(
  productType: string,
  productId: string,
  buyerUserId: string,
): Promise<ReviewRow | null> {
  const r = await db.execute(sql`
    SELECT ${REVIEW_COLS}
    FROM product_reviews r
    LEFT JOIN profiles pr ON pr.id = r.buyer_user_id
    WHERE r.product_type = ${productType} AND r.product_id = ${productId}
      AND r.buyer_user_id = ${buyerUserId}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as ReviewRow | undefined) ?? null;
}

/* ── Shared query validation ───────────────────────────────────────── */
const ProductQuerySchema = z.object({
  productType: z.enum(["store_product", "shop_product"]),
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
});

function parseProductQuery(req: { query: Record<string, unknown> }) {
  const parsed = ProductQuerySchema.safeParse({
    productType: req.query["productType"],
    productId: req.query["productId"],
  });
  return parsed.success ? parsed.data : null;
}

/* ═══════════════ PUBLIC: list + summary for a product ══════════════ */
router.get("/product-reviews", publicApiLimiter, async (req, res) => {
  const q = parseProductQuery(req as never);
  if (!q) {
    res.status(400).json({ error: "Send productType (store_product or shop_product) and a productId." });
    return;
  }
  try {
    const rows = await fetchProductReviews(q.productType, q.productId);
    const summary = summarizeReviews(
      rows.map((r) => ({ rating: Number(r.rating), moderationStatus: String(r.moderation_status) })),
    );
    const visible = rows.filter((r) => r.moderation_status === "visible");
    res.json({
      productType: q.productType,
      productId: q.productId,
      summary,
      reviews: visible.map((r) => reviewDto(r)),
    });
  } catch (err) {
    logger.error({ err }, "[product-reviews] list failed");
    res.status(500).json({ error: "Reviews couldn't load just now." });
  }
});

router.get("/product-reviews/summary", publicApiLimiter, async (req, res) => {
  const q = parseProductQuery(req as never);
  if (!q) {
    res.status(400).json({ error: "Send productType (store_product or shop_product) and a productId." });
    return;
  }
  try {
    const r = await db.execute(sql`
      SELECT rating, moderation_status FROM product_reviews
      WHERE product_type = ${q.productType} AND product_id = ${q.productId}
      LIMIT 500
    `);
    const summary = summarizeReviews(
      (r.rows as Array<Record<string, unknown>>).map((row) => ({
        rating: Number(row["rating"]),
        moderationStatus: String(row["moderation_status"]),
      })),
    );
    res.json({ productType: q.productType, productId: q.productId, summary });
  } catch (err) {
    logger.error({ err }, "[product-reviews] summary failed");
    res.status(500).json({ error: "The rating summary couldn't load just now." });
  }
});

/* ═══════════════ AUTH: can I review this product? ══════════════════ */
router.get("/product-reviews/eligibility", requireAuth, publicApiLimiter, async (req, res) => {
  const q = parseProductQuery(req as never);
  if (!q) {
    res.status(400).json({ error: "Send productType (store_product or shop_product) and a productId." });
    return;
  }
  try {
    const product = await resolveProduct(q.productType, q.productId);
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    if (product.sellerUserId === req.userId!) {
      res.json({
        eligible: false,
        reason: "own_product",
        message: "You can't review your own product — reviews come from verified buyers.",
        review: null,
      });
      return;
    }
    const existing = await findExistingReview(q.productType, q.productId, req.userId!);
    if (existing) {
      res.json({
        eligible: false,
        reason: "already_reviewed",
        message: "You've already reviewed this product — you can edit your review.",
        review: reviewDto(existing, { forAuthor: true }),
      });
      return;
    }
    const purchase = await findCompletedPurchase(
      q.productType, q.productId, req.userId!, req.userEmail ?? null,
    );
    if (!purchase) {
      res.json({
        eligible: false,
        reason: "no_completed_purchase",
        message:
          q.productType === "shop_product"
            ? "Only verified buyers can review this product. If you bought it, the email on that order has to match your account email."
            : "Only verified buyers can review this product — reviews open after a completed purchase.",
        review: null,
      });
      return;
    }
    res.json({ eligible: true, reason: null, message: null, purchaseSource: purchase.source, review: null });
  } catch (err) {
    logger.error({ err }, "[product-reviews] eligibility failed");
    res.status(500).json({ error: "Couldn't check review eligibility just now." });
  }
});

/* ═══════════════ AUTH: create (the verified-purchase gate) ═════════ */
const CreateReviewSchema = z.object({
  productType: z.enum(["store_product", "shop_product"]),
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1, "Write a few words about the product.").max(2000),
});

router.post("/product-reviews", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CreateReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid review.", details: parsed.error.issues });
    return;
  }
  const { productType, productId, rating, title, body } = parsed.data;
  try {
    const product = await resolveProduct(productType, productId);
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    if (product.sellerUserId === req.userId!) {
      res.status(400).json({
        error: "CANNOT_REVIEW_OWN_PRODUCT",
        message: "You can't review your own product — reviews come from verified buyers.",
      });
      return;
    }
    const purchase = await findCompletedPurchase(
      productType, productId, req.userId!, req.userEmail ?? null,
    );
    if (!purchase) {
      res.status(403).json({
        error: "NOT_VERIFIED_PURCHASE",
        message:
          productType === "shop_product"
            ? "Only verified buyers can review this product. If you bought it, the email on that order has to match your account email."
            : "Only verified buyers can review this product — reviews open after a completed purchase.",
      });
      return;
    }
    const existing = await findExistingReview(productType, productId, req.userId!);
    if (existing) {
      res.status(409).json({
        error: "ALREADY_REVIEWED",
        message: "You've already reviewed this product — edit your review instead.",
        reviewId: existing.id,
      });
      return;
    }
    /* The id is minted app-side (the column default would also work
       on real Postgres; an explicit id keeps the insert a single
       deterministic statement on every engine). */
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO product_reviews
        (id, product_type, product_id, product_title, seller_user_id, profile_id,
         shop_id, buyer_user_id, rating, title, body, purchase_source, purchase_id)
      VALUES (${id}, ${productType}, ${productId}, ${product.title}, ${product.sellerUserId},
              ${product.profileId}, ${product.shopId}, ${req.userId!}, ${rating},
              ${title ?? null}, ${body}, ${purchase.source}, ${purchase.id})
    `);
    const review = await fetchReview(id);
    logger.info(
      { userId: req.userId, productType, productId, reviewId: id, purchaseSource: purchase.source },
      "[product-reviews] verified review created",
    );
    res.status(201).json({ review: review ? reviewDto(review, { forAuthor: true }) : { id } });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[product-reviews] create failed");
    res.status(500).json({ error: "Your review couldn't be saved just now." });
  }
});

/* ═══════════════ AUTH: author edits (and only the author) ══════════ */
const UpdateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  body: z.string().trim().min(1).max(2000).optional(),
});

router.patch("/product-reviews/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid review id." });
    return;
  }
  const parsed = UpdateReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update.", details: parsed.error.issues });
    return;
  }
  try {
    const review = await fetchReview(id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    if (review.buyer_user_id !== req.userId!) {
      res.status(403).json({ error: "NOT_YOUR_REVIEW", message: "You can only edit your own review." });
      return;
    }
    const d = parsed.data;
    const sets: ReturnType<typeof sql>[] = [];
    if (d.rating !== undefined) sets.push(sql`rating = ${d.rating}`);
    if (d.title !== undefined) sets.push(sql`title = ${d.title}`);
    if (d.body !== undefined) sets.push(sql`body = ${d.body}`);
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    /* Editing never touches moderation state: an author cannot edit
       their way out of a moderation hold, and a seller's flag record
       survives an edit (it is platform record, not review content). */
    await db.execute(sql`
      UPDATE product_reviews
      SET ${sql.join(sets, sql`, `)}, updated_at = now()
      WHERE id = ${id} AND buyer_user_id = ${req.userId!}
    `);
    const updated = await fetchReview(id);
    res.json({ review: updated ? reviewDto(updated, { forAuthor: true }) : { id } });
  } catch (err) {
    logger.error({ err, id }, "[product-reviews] edit failed");
    res.status(500).json({ error: "Your edit couldn't be saved just now." });
  }
});

/* Author-only delete. There is deliberately no seller path here: when
   the caller is the product's seller, the refusal says so by name. */
router.delete("/product-reviews/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid review id." });
    return;
  }
  try {
    const review = await fetchReview(id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    if (review.buyer_user_id !== req.userId!) {
      if (review.seller_user_id === req.userId!) {
        res.status(403).json({
          error: "SELLER_CANNOT_DELETE",
          message:
            "Sellers can't delete reviews of their products. If a review is abusive, flag it for platform moderation — the flag and its reason stay on record.",
        });
        return;
      }
      res.status(403).json({ error: "NOT_YOUR_REVIEW", message: "You can only delete your own review." });
      return;
    }
    await db.execute(sql`DELETE FROM product_reviews WHERE id = ${id} AND buyer_user_id = ${req.userId!}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "[product-reviews] author delete failed");
    res.status(500).json({ error: "That review couldn't be deleted just now." });
  }
});

/* ═══════════════ AUTH: the seller's queue (all states) ═════════════ */
router.get("/product-reviews/seller", requireAuth, publicApiLimiter, async (req, res) => {
  const productType = req.query["productType"] ? String(req.query["productType"]) : null;
  if (productType && productType !== "store_product" && productType !== "shop_product") {
    res.status(400).json({ error: "productType must be store_product or shop_product." });
    return;
  }
  try {
    const r = productType
      ? await db.execute(sql`
          SELECT ${REVIEW_COLS}
          FROM product_reviews r
          LEFT JOIN profiles pr ON pr.id = r.buyer_user_id
          WHERE r.seller_user_id = ${req.userId!} AND r.product_type = ${productType}
          ORDER BY r.created_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT ${REVIEW_COLS}
          FROM product_reviews r
          LEFT JOIN profiles pr ON pr.id = r.buyer_user_id
          WHERE r.seller_user_id = ${req.userId!}
          ORDER BY r.created_at DESC
          LIMIT 200
        `);
    const rows = r.rows as unknown as ReviewRow[];
    res.json({
      reviews: rows.map((row) => reviewDto(row, { forSeller: true })),
      /* The seller sees their whole queue — hidden and flagged rows
         included, by design. Nothing a seller does here is invisible
         to the seller, the author, or the platform record. */
      counts: {
        total: rows.length,
        visible: rows.filter((row) => row.moderation_status === "visible").length,
        hiddenPendingReview: rows.filter((row) => row.moderation_status === "hidden_pending_review").length,
        flagged: rows.filter((row) => row.flagged_at != null).length,
      },
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[product-reviews] seller queue failed");
    res.status(500).json({ error: "Your reviews couldn't load just now." });
  }
});

/* ═══════════════ AUTH (seller): respond ════════════════════════════ */
const RespondSchema = z.object({
  /* null (or an empty string) clears the response — the seller's own
     words are theirs to withdraw; the review itself is untouched. */
  response: z.string().trim().max(2000).nullable(),
});

router.post("/product-reviews/:id/respond", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid review id." });
    return;
  }
  const parsed = RespondSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Send a response of at most 2000 characters (or null to clear it)." });
    return;
  }
  try {
    const review = await fetchReview(id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    if (review.seller_user_id !== req.userId!) {
      res.status(403).json({ error: "NOT_THE_SELLER", message: "Only the seller can respond to a review of their product." });
      return;
    }
    const response = parsed.data.response && parsed.data.response.length > 0 ? parsed.data.response : null;
    const respondedAt = response ? new Date() : null;
    await db.execute(sql`
      UPDATE product_reviews
      SET seller_response = ${response},
          seller_responded_at = ${respondedAt},
          updated_at = now()
      WHERE id = ${id} AND seller_user_id = ${req.userId!}
    `);
    const updated = await fetchReview(id);
    res.json({ review: updated ? reviewDto(updated, { forSeller: true }) : { id } });
  } catch (err) {
    logger.error({ err, id }, "[product-reviews] respond failed");
    res.status(500).json({ error: "Your response couldn't be saved just now." });
  }
});

/* ═══════════════ AUTH (seller): flag / unflag ══════════════════════ */
const FlagSchema = z.object({
  reason: z.string(),
  note: z.string().trim().max(500).optional(),
  /* Hiding is an explicit second choice on top of flagging. A flag
     without hide leaves the review fully public while platform
     moderation looks — the default, and the only choice that can
     never bury anything. */
  hide: z.boolean().optional().default(false),
});

router.post("/product-reviews/:id/flag", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid review id." });
    return;
  }
  const parsed = FlagSchema.safeParse(req.body ?? {});
  if (!parsed.success || !isProductReviewFlagReason(parsed.success ? parsed.data.reason : null)) {
    res.status(400).json({
      error: "INVALID_FLAG_REASON",
      message: `Flagging needs a reason from the abusive-content list: ${PRODUCT_REVIEW_FLAG_REASONS.join(", ")}. A low rating is not a flag reason — honest negative reviews stay up.`,
    });
    return;
  }
  const { reason, note, hide } = parsed.data;
  try {
    const review = await fetchReview(id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    if (review.seller_user_id !== req.userId!) {
      res.status(403).json({ error: "NOT_THE_SELLER", message: "Only the seller can flag a review of their product." });
      return;
    }
    await db.execute(sql`
      UPDATE product_reviews
      SET flag_reason = ${reason},
          flag_note = ${note ?? null},
          flagged_by_user_id = ${req.userId!},
          flagged_at = now(),
          moderation_status = ${hide ? "hidden_pending_review" : String(review.moderation_status)},
          updated_at = now()
      WHERE id = ${id} AND seller_user_id = ${req.userId!}
    `);
    logger.info(
      { userId: req.userId, reviewId: id, reason, hide },
      "[product-reviews] seller flagged review for platform moderation",
    );
    const updated = await fetchReview(id);
    res.json({
      review: updated ? reviewDto(updated, { forSeller: true }) : { id },
      /* Stated back to the seller in plain words: what hiding does
         and does not do, so the record is never a surprise. */
      moderationNote: hide
        ? "This review is hidden from buyers while platform moderation reviews your flag. It is NOT deleted: it stays visible to its author and in your dashboard, and the public rating summary shows how many reviews are hidden pending review."
        : "Flag recorded for platform moderation. The review stays public while it is reviewed.",
    });
  } catch (err) {
    logger.error({ err, id }, "[product-reviews] flag failed");
    res.status(500).json({ error: "That flag couldn't be recorded just now." });
  }
});

router.post("/product-reviews/:id/unflag", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid review id." });
    return;
  }
  try {
    const review = await fetchReview(id);
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    if (review.seller_user_id !== req.userId!) {
      res.status(403).json({ error: "NOT_THE_SELLER", message: "Only the seller can undo their flag on a review." });
      return;
    }
    await db.execute(sql`
      UPDATE product_reviews
      SET flag_reason = NULL, flag_note = NULL, flagged_by_user_id = NULL,
          flagged_at = NULL, moderation_status = 'visible', updated_at = now()
      WHERE id = ${id} AND seller_user_id = ${req.userId!}
    `);
    const updated = await fetchReview(id);
    res.json({ review: updated ? reviewDto(updated, { forSeller: true }) : { id } });
  } catch (err) {
    logger.error({ err, id }, "[product-reviews] unflag failed");
    res.status(500).json({ error: "That flag couldn't be undone just now." });
  }
});

export default router;
