/**
 * affiliates.ts — Creator Product Affiliates (#16, migration 0205).
 *
 * A creator enables affiliates on a store/storefront product and sets the
 * commission % themselves (affiliate_enabled / affiliate_commission_bps on
 * store_products and shop_products). A fan claims a per-product share code
 * (affiliate_codes) and shares a link carrying ?ref=CODE. When a sale lands
 * through that code, recordAffiliateSale below writes the commission owed
 * into the affiliate_sales ledger.
 *
 * Money discipline (standing, do not relax):
 *  - Commission = creator-set % of the SELLER'S NET (gross − platform fee),
 *    rounded to the cent. It comes out of the seller's cut only: the
 *    platform fee stays the flat 5% (lib/platform-fees PLATFORM_FEE_BPS /
 *    the shops rail's STOREFRONT_PLATFORM_FEE_BPS — neither is read or
 *    changed here) and the buyer's price never changes.
 *  - This module RECORDS a liability (status 'owed'). It never moves
 *    money and never marks anything 'paid' — settlement rides the existing
 *    creator-payout rails.
 *  - The platform referral program (schema/referrals.ts, referral_payouts)
 *    pays Visual Bucs on a referee's CREDIT purchases only. This ledger is
 *    written ONLY from product-sale funnels (storefront verify, shops paid
 *    flip / free-cart record), so the two programs can never pay twice
 *    for one sale.
 *
 * Fraud discipline (enforced in recordAffiliateSale, the single funnel):
 *  - self-referral: buyer == affiliate (user id, or email match on the
 *    guest shops rail) earns nothing;
 *  - self-dealing: affiliate == seller earns nothing;
 *  - the product must still be affiliate-enabled at sale time, the code
 *    must be active and must belong to that product;
 *  - exactly once: UNIQUE(surface, order_ref, product_id) +
 *    ON CONFLICT DO NOTHING — verify replays, webhook replays and
 *    verify+webhook races all land at most one row.
 *
 * Queries are raw SQL via db.execute(sql``) — the commerce surfaces' own
 * convention (pg-mem cannot run the drizzle query builder here).
 */
import { randomBytes, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export type AffiliateSurface = "store_product" | "shop_product";

/** Commission owed on a sale: the creator-set % of the SELLER'S NET.
 *  Pure — the one place this math lives. Never touches the platform fee. */
export function affiliateCommissionCents(sellerNetCents: number, commissionBps: number): number {
  const net = Math.max(0, Math.round(sellerNetCents));
  const bps = Math.max(0, Math.min(10_000, Math.round(commissionBps)));
  return Math.round((net * bps) / 10_000);
}

/** A creator-set commission is valid only as whole bps in 1..10000
 *  (0.01%..100% of the seller's net). 100% is allowed: a creator may give
 *  away their whole net on a product if they choose. */
export function isValidCommissionBps(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10_000;
}

export interface AffiliateCodeRow {
  id: string;
  code: string;
  affiliate_user_id: string;
  seller_user_id: string;
  surface: AffiliateSurface;
  product_id: string;
  is_active: boolean;
  created_at: string;
}

export interface AffiliateProductSetting {
  enabled: boolean;
  commissionBps: number | null;
  sellerUserId: string;
  title: string;
  priceCents: number;
  /** Public path of the product (no ?ref=) — set for shop products. */
  shopHandle: string | null;
  profileSlug: string | null;
}

/** The product's current affiliate setting, read at sale/claim time —
 *  a setting changed after a code was claimed governs the sale. */
export async function fetchAffiliateProductSetting(
  surface: AffiliateSurface,
  productId: string,
): Promise<AffiliateProductSetting | null> {
  if (surface === "store_product") {
    const r = await db.execute(sql`
      SELECT sp.title, sp.price_cents, sp.affiliate_enabled, sp.affiliate_commission_bps,
             cp.user_id AS seller_user_id, cp.slug AS profile_slug
      FROM store_products sp
      JOIN creator_profiles cp ON cp.id = sp.profile_id
      WHERE sp.id = ${productId}
      LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      enabled: row["affiliate_enabled"] === true,
      commissionBps: row["affiliate_commission_bps"] == null ? null : Number(row["affiliate_commission_bps"]),
      sellerUserId: String(row["seller_user_id"]),
      title: String(row["title"] ?? ""),
      priceCents: Number(row["price_cents"] ?? 0),
      shopHandle: null,
      profileSlug: row["profile_slug"] ? String(row["profile_slug"]) : null,
    };
  }
  const r = await db.execute(sql`
    SELECT p.name AS title, p.price_cents, p.affiliate_enabled, p.affiliate_commission_bps,
           p.user_id AS seller_user_id, s.handle AS shop_handle
    FROM shop_products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.id = ${productId}
    LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    enabled: row["affiliate_enabled"] === true,
    commissionBps: row["affiliate_commission_bps"] == null ? null : Number(row["affiliate_commission_bps"]),
    sellerUserId: String(row["seller_user_id"]),
    title: String(row["title"] ?? ""),
    priceCents: Number(row["price_cents"] ?? 0),
    shopHandle: row["shop_handle"] ? String(row["shop_handle"]) : null,
    profileSlug: null,
  };
}

export async function fetchAffiliateCode(code: string): Promise<AffiliateCodeRow | null> {
  const clean = String(code ?? "").trim().toUpperCase();
  if (!clean) return null;
  const r = await db.execute(sql`
    SELECT id, code, affiliate_user_id, seller_user_id, surface, product_id, is_active, created_at
    FROM affiliate_codes
    WHERE UPPER(code) = ${clean}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as AffiliateCodeRow | undefined) ?? null;
}

export type AffiliateValidation =
  | { ok: true; code: AffiliateCodeRow; commissionBps: number; setting: AffiliateProductSetting }
  | { ok: false; reason: string };

/** Validate a presented code against a product at checkout time: the code
 *  must exist, be active, belong to THIS product, and the product must
 *  still have affiliates enabled with a creator-set rate. */
export async function validateAffiliateCodeForProduct(args: {
  code: string;
  surface: AffiliateSurface;
  productId: string;
}): Promise<AffiliateValidation> {
  const row = await fetchAffiliateCode(args.code);
  if (!row) return { ok: false, reason: "That affiliate code doesn't exist." };
  if (!row.is_active) return { ok: false, reason: "That affiliate code is no longer active." };
  if (row.surface !== args.surface || String(row.product_id) !== String(args.productId)) {
    return { ok: false, reason: "That affiliate code isn't for this product." };
  }
  const setting = await fetchAffiliateProductSetting(args.surface, args.productId);
  if (!setting) return { ok: false, reason: "That product isn't for sale right now." };
  if (!setting.enabled || !isValidCommissionBps(setting.commissionBps)) {
    return { ok: false, reason: "This product isn't open to affiliates right now." };
  }
  if (String(setting.sellerUserId) !== String(row.seller_user_id)) {
    return { ok: false, reason: "That affiliate code isn't for this product." };
  }
  return { ok: true, code: row, commissionBps: setting.commissionBps, setting };
}

/** Mint a share code for a fan + product. Idempotent per
 *  (affiliate, surface, product): re-claiming returns the existing code
 *  (reactivating it if the fan had turned it off). The seller can never
 *  be their own affiliate. */
export async function claimAffiliateCode(args: {
  affiliateUserId: string;
  surface: AffiliateSurface;
  productId: string;
}): Promise<
  | { ok: true; code: AffiliateCodeRow; created: boolean }
  | { ok: false; reason: string }
> {
  const setting = await fetchAffiliateProductSetting(args.surface, args.productId);
  if (!setting) return { ok: false, reason: "That product doesn't exist." };
  if (!setting.enabled || !isValidCommissionBps(setting.commissionBps)) {
    return { ok: false, reason: "This product isn't open to affiliates right now." };
  }
  if (String(setting.sellerUserId) === String(args.affiliateUserId)) {
    return { ok: false, reason: "You can't be an affiliate for your own product — share it as the creator instead." };
  }
  const existing = await db.execute(sql`
    SELECT id, code, affiliate_user_id, seller_user_id, surface, product_id, is_active, created_at
    FROM affiliate_codes
    WHERE affiliate_user_id = ${args.affiliateUserId}
      AND surface = ${args.surface} AND product_id = ${args.productId}
    LIMIT 1
  `);
  const found = existing.rows[0] as unknown as AffiliateCodeRow | undefined;
  if (found) {
    if (!found.is_active) {
      await db.execute(sql`UPDATE affiliate_codes SET is_active = true WHERE id = ${found.id}`);
      found.is_active = true;
    }
    return { ok: true, code: found, created: false };
  }
  /* Human-shareable code: AFF- + 10 unambiguous chars. The id is minted
     here in JS (the shops rail's pattern), not left to a DB default.
     Collision retries are bounded and ONLY for a code collision; the
     UNIQUE index is the real guard. */
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `AFF-${randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 10).toUpperCase()}`;
    try {
      const inserted = await db.execute(sql`
        INSERT INTO affiliate_codes (id, code, affiliate_user_id, seller_user_id, surface, product_id)
        VALUES (${randomUUID()}, ${code}, ${args.affiliateUserId}, ${setting.sellerUserId}, ${args.surface}, ${args.productId})
        RETURNING id, code, affiliate_user_id, seller_user_id, surface, product_id, is_active, created_at
      `);
      const row = inserted.rows[0] as unknown as AffiliateCodeRow;
      return { ok: true, code: row, created: true };
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? err);
      if (attempt === 4 || !msg.includes("affiliate_codes_code_ux")) throw err;
    }
  }
  return { ok: false, reason: "Could not create a code — try again." };
}

/** The public product path a share link points at (before ?ref=). */
export function affiliateSharePath(surface: AffiliateSurface, setting: AffiliateProductSetting, productId: string): string {
  if (surface === "shop_product" && setting.shopHandle) return `/shop/${setting.shopHandle}`;
  return `/storefront/product/${productId}`;
}

export type RecordAffiliateSaleResult =
  | { recorded: true; commissionCents: number; saleId: string }
  | { recorded: false; reason: "no_code" | "inactive_code" | "product_mismatch" | "affiliates_disabled" | "self_referral" | "self_dealing" | "zero_commission" | "duplicate" };

/**
 * THE funnel: record the commission owed for one attributed product-sale
 * line. Called ONLY from places a sale is recorded exactly once (the
 * storefront verify's fresh-order block, the shops paid flip's flipped
 * rows, the shops free-cart record for paid-value lines). Never throws on
 * a fraud/validity refusal — it returns the reason; callers wrap DB
 * errors so a ledger failure can never break a buyer's checkout.
 */
export async function recordAffiliateSale(args: {
  code: string | null | undefined;
  surface: AffiliateSurface;
  productId: string;
  productTitle?: string;
  orderRef: string;
  buyerUserId?: string | null;
  buyerEmail?: string | null;
  grossCents: number;
  platformFeeCents: number;
}): Promise<RecordAffiliateSaleResult> {
  if (!args.code || !String(args.code).trim()) return { recorded: false, reason: "no_code" };
  const v = await validateAffiliateCodeForProduct({ code: args.code, surface: args.surface, productId: args.productId });
  if (!v.ok) {
    /* Map the human reason onto the machine reason for logs/tests. */
    const reason: RecordAffiliateSaleResult & { recorded: false } = { recorded: false, reason: "inactive_code" };
    if (v.reason.includes("isn't for this product")) reason.reason = "product_mismatch";
    else if (v.reason.includes("isn't open to affiliates")) reason.reason = "affiliates_disabled";
    else if (v.reason.includes("doesn't exist")) reason.reason = "no_code";
    return reason;
  }
  const { code, commissionBps, setting } = v;

  if (String(code.affiliate_user_id) === String(code.seller_user_id)) {
    return { recorded: false, reason: "self_dealing" };
  }
  /* Self-referral: the buyer IS the affiliate. By user id where the rail
     knows it (storefront), by account email where it doesn't (the guest
     shops rail carries only an email — matched against profiles.email). */
  if (args.buyerUserId && String(args.buyerUserId) === String(code.affiliate_user_id)) {
    return { recorded: false, reason: "self_referral" };
  }
  const buyerEmail = (args.buyerEmail ?? "").trim().toLowerCase();
  if (buyerEmail) {
    const r = await db.execute(sql`
      SELECT email FROM profiles WHERE id = ${code.affiliate_user_id} LIMIT 1
    `);
    const affiliateEmail = String(((r.rows[0] as Record<string, unknown> | undefined)?.["email"] ?? "")).trim().toLowerCase();
    if (affiliateEmail && affiliateEmail === buyerEmail) {
      return { recorded: false, reason: "self_referral" };
    }
  }

  const gross = Math.max(0, Math.round(args.grossCents));
  const fee = Math.max(0, Math.round(args.platformFeeCents));
  const sellerNet = Math.max(0, gross - fee);
  const commissionCents = affiliateCommissionCents(sellerNet, commissionBps);
  if (commissionCents <= 0) return { recorded: false, reason: "zero_commission" };

  /* Exactly-once, belt and suspenders: the pre-check answers replays;
     the UNIQUE(surface, order_ref, product_id) index + ON CONFLICT
     below closes the race between two doors landing at the same
     instant (the loser inserts 0 rows and reads as a duplicate). */
  const prior = await db.execute(sql`
    SELECT id FROM affiliate_sales
    WHERE surface = ${args.surface} AND order_ref = ${args.orderRef} AND product_id = ${args.productId}
    LIMIT 1
  `);
  if (prior.rows.length > 0) return { recorded: false, reason: "duplicate" };

  const inserted = await db.execute(sql`
    INSERT INTO affiliate_sales
      (id, affiliate_code_id, affiliate_user_id, seller_user_id, surface, product_id,
       product_title, order_ref, buyer_user_id, buyer_email, gross_cents,
       platform_fee_cents, seller_net_cents, commission_bps, commission_cents, status)
    VALUES (${randomUUID()}, ${code.id}, ${code.affiliate_user_id}, ${code.seller_user_id}, ${args.surface}, ${args.productId},
            ${args.productTitle ?? setting.title}, ${args.orderRef}, ${args.buyerUserId ?? null},
            ${buyerEmail || null}, ${gross}, ${fee}, ${sellerNet}, ${commissionBps}, ${commissionCents}, 'owed')
    ON CONFLICT (surface, order_ref, product_id) DO NOTHING
    RETURNING id
  `);
  if (inserted.rows.length === 0) return { recorded: false, reason: "duplicate" };
  const saleId = String((inserted.rows[0] as Record<string, unknown>)["id"]);
  logger.info(
    { saleId, surface: args.surface, productId: args.productId, orderRef: args.orderRef, commissionCents, commissionBps },
    "[affiliates] commission recorded (owed)",
  );
  return { recorded: true, commissionCents, saleId };
}

/** Best-effort wrapper for checkout call sites: a ledger failure (e.g.
 *  migration 0205 not yet applied) must never break a paid checkout —
 *  the sale itself is already recorded on its own rail. */
export async function recordAffiliateSaleSafely(
  args: Parameters<typeof recordAffiliateSale>[0],
): Promise<RecordAffiliateSaleResult | { recorded: false; reason: "error" }> {
  try {
    return await recordAffiliateSale(args);
  } catch (err) {
    logger.error({ err, surface: args.surface, orderRef: args.orderRef }, "[affiliates] commission record failed — sale stands, commission not recorded");
    return { recorded: false, reason: "error" };
  }
}
