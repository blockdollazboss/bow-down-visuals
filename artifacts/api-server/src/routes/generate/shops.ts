/**
 * shops.ts — Customer Shops: every customer gets their OWN storefront.
 *
 * Bow Down Visuals becomes the platform: AI design tools + storefronts.
 * v1 shops live at /shop/:handle. Custom domains are a marked coming-soon
 * in the UI — this API never fakes them.
 *
 * Shop/product CRUD is FREE (pure UI/data — costs nothing to run).
 * The AI layer costs credits (it burns compute):
 *   POST /api/shops/ai/shop-description     1 credit (GPT-6)
 *   POST /api/shops/ai/product-description  1 credit (GPT-6)
 *   POST /api/shops/ai/product-image        1 credit standard / 2 credits premium
 *                                            (OpenAI image model, synchronous)
 *
 * Money rules (standing): charge BEFORE the provider call, 402 on
 * insufficient credits, automatic refund when the provider fails.
 * Queries use raw SQL via db.execute(sql``) — pg-mem (vitest) cannot
 * handle the drizzle query builder's rowMode:'array'.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID, createHash } from "crypto";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { isUniqueViolation, pgErrorText } from "../../lib/pg-errors";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  getCheckoutStripe,
  retrieveCheckoutSession,
  checkoutBaseUrl,
  isCheckoutTestMode,
} from "../../lib/stripe-checkout";
import {
  fetchMarketSaleBySession,
  markMarketSalePaid,
  marketSaleIsPaid,
  marketSaleReceipt,
} from "../../lib/market-sale";
import {
  recordShopEventSplitsSafely,
  validateProductSplits,
  assertCoSellersResolvable,
  normalizeSplits,
  SaleSplitError,
  type ProductSplit,
} from "../../lib/sale-splits";
import {
  readBumpConfig,
  validateBumpTarget,
  bumpUnitCents,
  MAX_BUMP_PERCENT_OFF,
  type BumpConfig,
} from "../../lib/order-bumps";
import { SHOP_PRODUCTS_BUCKET, refreshSupabaseStorageUrl, refreshSupabaseStorageUrlsDeep, isStorageRef } from "../../lib/objectStorage";
import {
  GiftCardsUnavailable,
  findCardByCode,
  findReservation,
  isGiftCardCodeShape,
  releaseExpiredReservations,
  reserveGiftCard,
  redeemReservation,
  releaseReservation,
  tenderFor,
} from "../../lib/gift-cards";
import { mirrorExternalMediaUrl } from "../../lib/mirrorMedia";
import { validateAffiliateCodeForProduct, recordAffiliateSaleSafely } from "../../lib/affiliates";
import { ALT_TEXT_MAX_CHARS, sanitizeAltText } from "../../lib/alt-text";

/* #29: shop_products.image_alt_text (accessibility description of the
   product shot) lands via a held migration — numbering is assigned at
   join. Probe once and cache (publish.ts season precedent): every
   product query/write below includes the column only when it exists,
   so the shops door works exactly as before until the column lands. */
let shopAltColKnown: boolean | null = null;
async function shopProductsHasImageAlt(): Promise<boolean> {
  if (shopAltColKnown !== null) return shopAltColKnown;
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'shop_products' AND column_name = 'image_alt_text'
    `);
    shopAltColKnown = ((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 1;
  } catch {
    shopAltColKnown = false;
  }
  return shopAltColKnown;
}

/* Co-seller splits (#36, migration 0235): same probe discipline as the
   alt-text column — reads/writes work exactly as before until the
   column lands; a splits WRITE before then answers 503 instead of
   silently dropping a money setting. */
let shopSplitsColKnown: boolean | null = null;
async function shopProductsHasSplits(): Promise<boolean> {
  if (shopSplitsColKnown !== null) return shopSplitsColKnown;
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'shop_products' AND column_name = 'splits'
    `);
    shopSplitsColKnown = ((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 1;
  } catch {
    shopSplitsColKnown = false;
  }
  return shopSplitsColKnown;
}

/** Co-seller splits (#36) on product writes: validate the whole list
 *  (sum-to-100 machine + owner share + co-seller resolution) and hand
 *  back the JSON to store, or throw a tagged refusal the handler maps
 *  to a status. Returns undefined when the write carries no splits. */
async function prepareSplitsWrite(
  ownerUserId: string,
  input: unknown,
): Promise<{ json: string | null } | { errorStatus: number; error: string; message: string } | undefined> {
  if (input === undefined) return undefined;
  if (!(await shopProductsHasSplits())) {
    return {
      errorStatus: 503,
      error: "SPLITS_NOT_READY",
      message: "Co-seller splits aren't switched on yet — save the product without splits for now; nothing was saved.",
    };
  }
  try {
    const valid = validateProductSplits(ownerUserId, input);
    if (valid) await assertCoSellersResolvable(ownerUserId, valid);
    return { json: valid ? JSON.stringify(valid) : null };
  } catch (err) {
    if (err instanceof SaleSplitError) {
      return { errorStatus: 400, error: err.code, message: err.message };
    }
    throw err;
  }
}

/* Mirror-on-save (2026-10-13 law): shop banners + product images are
   re-hosted into permanent storage at save time; presenters mint fresh
   signed URLs from the stored refs on every read. */
async function presentShopRow<T extends { banner_image_url: string | null }>(row: T): Promise<T> {
  return {
    ...row,
    banner_image_url: row.banner_image_url ? await refreshSupabaseStorageUrl(row.banner_image_url) : row.banner_image_url,
  };
}

async function presentShopProductRow<T extends { image_url: string | null; image_path: string | null }>(row: T): Promise<T> {
  const source = row.image_path ?? row.image_url;
  const presented: T & { splits?: ProductSplit[] | null } = {
    ...row,
    image_url: source ? await refreshSupabaseStorageUrl(source) : row.image_url,
  };
  /* Co-seller splits (#36): surfaces that select the column present
     the normalized list (or null) — never a malformed stored value. */
  if ("splits" in presented) {
    presented.splits = normalizeSplits((presented as { splits?: unknown }).splits);
  }
  return presented;
}

/* ── Pinned UGC ads (migration 0178) ─────────────────────────────────────
   shop_products.pinned_ugc_ad_id points at the ugc_ads row the seller
   pinned to the product (the pin verb lives on the ad record, in
   routes/ugc-ads.ts). Every product surface resolves it through here,
   so the render rule is identical everywhere: the ad shows only while
   it is still 'ready' with a video — a not-ready or deleted ad renders
   as NO pin, never as a broken player — and its playable URL is minted
   fresh on the read, never stored. Keyed by ad id. Buyer payloads get
   the resolved `pinned_ad` only; the raw pin id is owner state and is
   stripped before a buyer DTO leaves (the 0176 discipline: buyer
   reads carry no management state). */
async function pinnedAdVideosById(
  rows: Array<{ pinned_ugc_ad_id?: string | null }>,
): Promise<Map<string, { id: string; video_url: string }>> {
  const ids = [
    ...new Set(
      rows
        .map((r) => r.pinned_ugc_ad_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  const out = new Map<string, { id: string; video_url: string }>();
  if (ids.length === 0) return out;
  const result = await db.execute(sql`
    SELECT id, status, video_ref
    FROM ugc_ads
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  for (const a of result.rows as unknown as Array<{ id: string; status: string; video_ref: string | null }>) {
    if (a.status === "ready" && a.video_ref) {
      out.set(a.id, { id: a.id, video_url: await refreshSupabaseStorageUrl(a.video_ref) });
    }
  }
  return out;
}
import { r2Upload, r2PublicUrl, isR2Configured } from "../../lib/r2-client";
import { promises as dns } from "dns";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

/* ── Pricing — env-overridable without a deploy ─────────────────────────── */
export const SHOP_AI_CREDIT_COST = Number(process.env["SHOP_AI_CREDIT_COST"]) || 100;
export const SHOP_IMAGE_STANDARD_CREDITS =
  Number(process.env["SHOP_IMAGE_STANDARD_CREDITS"]) || 100;
export const SHOP_IMAGE_PREMIUM_CREDITS =
  Number(process.env["SHOP_IMAGE_PREMIUM_CREDITS"]) || 200;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const SHOP_IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/* (SHOP_PRODUCTS_BUCKET imported from lib/objectStorage) */

/* ── Handle rules ──────────────────────────────────────────────────────────
   URL-safe storefront slugs: lowercase letters, digits, hyphens; 3–30 chars;
   globally unique. Reserved words can never be shop handles (they'd shadow
   real site routes). */
const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED_HANDLES = new Set([
  "api", "admin", "login", "signup", "dashboard", "settings",
  "shop", "shops", "my-shop", "pricing", "hooks", "coach",
  "checkout", "cart", "support", "help", "about", "contact",
]);

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function handleError(raw: string): string | null {
  const handle = normalizeHandle(raw);
  if (!HANDLE_RE.test(handle)) {
    return "Handle must be 3–30 characters: lowercase letters, numbers, and hyphens only (no leading/trailing hyphen).";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved — pick another one.";
  }
  return null;
}

/** Format integer cents as a display price, e.g. 1999 → "$19.99". */
export function formatPriceCents(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  return `$${(safe / 100).toFixed(2)}`;
}

/* ── Schemas ─────────────────────────────────────────────────────────────── */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const createShopSchema = z.object({
  name: z.string().trim().min(1, "Shop name is required.").max(80),
  handle: z.string().trim().min(3).max(30),
  tagline: z.string().trim().max(140).optional().default(""),
});

const updateShopSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().max(140).optional(),
  description: z.string().trim().max(2000).optional(),
  banner_color: z.string().regex(HEX_COLOR, "Must be a hex color like #0a0a0a.").optional(),
  accent_color: z.string().regex(HEX_COLOR, "Must be a hex color like #d4af37.").optional(),
  banner_image_url: z.string().trim().max(2000).optional(),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required.").max(120),
  price_cents: z.number().int().min(0).max(100_000_000),
  description: z.string().trim().max(2000).optional().default(""),
  image_url: z.string().trim().max(2000).optional().default(""),
  /* Creator Product Affiliates (#16): creator-set, never defaulted to a
     rate by the platform. Enabling REQUIRES the rate (handler checks). */
  affiliate_enabled: z.boolean().optional().default(false),
  affiliate_commission_bps: z.number().int().min(1).max(10_000).nullable().optional(),
  /* Co-seller revenue splits (Wave 4 #36): [{ userId, sharePct }]
     summing to exactly 100, owner included — the sum/owner/resolution
     rules run server-side in lib/sale-splits. */
  splits: z
    .array(z.object({ userId: z.string().uuid(), sharePct: z.number() }))
    .max(20)
    .nullable()
    .optional(),
  /* #29: accessibility description of the product shot — creator-written
     or AI-suggested, editable before it ships. */
  image_alt_text: z.string().max(ALT_TEXT_MAX_CHARS).optional().default(""),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price_cents: z.number().int().min(0).max(100_000_000).optional(),
  description: z.string().trim().max(2000).optional(),
  image_url: z.string().trim().max(2000).optional(),
  image_alt_text: z.string().max(ALT_TEXT_MAX_CHARS).optional(),
  /* Pause/unlist (migration 0176): the seller flips listing state on
     the same edit rail — 'active' is live in the storefront, 'paused'
     is seller-only and refused at checkout. */
  status: z.enum(["active", "paused"]).optional(),
  /* Creator Product Affiliates (#16) — see createProductSchema. */
  affiliate_enabled: z.boolean().optional(),
  affiliate_commission_bps: z.number().int().min(1).max(10_000).nullable().optional(),
  /* Co-seller revenue splits (#36) — see createProductSchema.
     Absent = keep; null = clear the co-sellers. */
  splits: z
    .array(z.object({ userId: z.string().uuid(), sharePct: z.number() }))
    .max(20)
    .nullable()
    .optional(),
});

const shopDescriptionSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required.").max(80),
  tagline: z.string().trim().max(140).optional().default(""),
  niche: z.string().trim().max(120).optional().default(""),
  products: z.string().trim().max(500).optional().default(""),
});

const productDescriptionSchema = z.object({
  productName: z.string().trim().min(1, "Product name is required.").max(120),
  details: z.string().trim().max(500).optional().default(""),
  price: z.string().trim().max(40).optional().default(""),
  tone: z.enum(["luxury", "playful", "minimal", "bold"]).default("luxury"),
});

const productImageSchema = z.object({
  productName: z.string().trim().min(1, "Product name is required.").max(120),
  styleHint: z.string().trim().max(300).optional().default(""),
  tier: z.enum(["standard", "premium"]).default("standard"),
});

/* ── Row types ───────────────────────────────────────────────────────────── */
interface ShopRow {
  id: string;
  user_id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  banner_color: string;
  accent_color: string;
  banner_image_url: string | null;
  custom_domain: string | null;
  domain_verified: boolean;
  domain_verification_token: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  shop_id: string;
  user_id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
  image_path: string | null;
  /** #29 accessibility description of the product shot; absent on
      pre-migration rows/selects. Buyer DTOs DO carry it — it is the
      public alt text their surfaces render. */
  image_alt_text?: string | null;
  /** 'active' | 'paused' (migration 0176) — owner DTOs only; buyer
      reads select explicit columns and never carry it. */
  status: string;
  /** The pinned UGC ad's id (migration 0178) — owner state like
      status: owner DTOs carry it, buyer payloads never do (they get
      the resolved `pinned_ad` video instead). */
  pinned_ugc_ad_id: string | null;
  /** Creator Product Affiliates (#16, migration 0205) — owner DTOs only,
      like status: buyer reads select explicit columns without them. */
  affiliate_enabled?: boolean;
  affiliate_commission_bps?: number | null;
  /* Co-seller revenue splits (Wave 4 #36, migration 0235). Optional:
     selects include the column only once the migration lands. */
  splits?: ProductSplit[] | null;
  /* Order-bump attachment (feature #13, more-bumps lane). Optional:
     the columns arrive with the lane's reported migration (see
     .lane/MIGRATION-NEEDED.md); rows without them simply have no bump
     (readBumpConfig treats absent keys as "no offer"). */
  bump_product_id?: string | null;
  bump_percent_off?: number | null;
  created_at: string;
  updated_at: string;
}

async function getOwnedShop(shopId: string, userId: string): Promise<ShopRow | null> {
  const result = await db.execute(sql`
    SELECT id, user_id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url,
           custom_domain, domain_verified, domain_verification_token,
           created_at, updated_at
    FROM shops
    WHERE id = ${shopId} AND user_id = ${userId}
    LIMIT 1
  `);
  const rows = result.rows as unknown as ShopRow[];
  return rows[0] ? await presentShopRow(rows[0]) : null;
}

async function productCount(shopId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM shop_products WHERE shop_id = ${shopId}
  `);
  return (result.rows as unknown as Array<{ count: number }>)[0]?.count ?? 0;
}

/* ── Shop discount codes (migration 0190) ────────────────────────────────
   Parity with the profile storefront's discount_codes (routes/
   storefront.ts): same fields, same validation, same redemption
   discipline — keyed by shop instead of creator profile, on
   shop_discount_codes. A code is validated server-side at checkout; a
   use is counted only when the sale is RECORDED (the paid flip in
   lib/market-sale.ts, or the free-cart record in the checkout route
   below) — never at validate time. Money math is the storefront's
   exact sequence: percent off the UNIT price (rounded to the cent),
   line gross from the discounted unit, then the ruled 5% marketplace
   fee (STOREFRONT_PLATFORM_FEE_BPS) out of the discounted gross. A
   code is scoped to its shop by the table's key: the same code name
   at another shop is a different code and never applies here. */

interface ShopDiscountRow {
  id: string;
  shop_id: string;
  code: string;
  percent_off: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

async function findShopDiscount(shopId: string, code: string): Promise<ShopDiscountRow | null> {
  const r = await db.execute(sql`
    SELECT id, shop_id, code, percent_off, max_uses, used_count, expires_at, is_active, created_at
    FROM shop_discount_codes
    WHERE shop_id = ${shopId} AND UPPER(code) = ${code.trim().toUpperCase()}
    LIMIT 1
  `);
  return (r.rows as unknown as ShopDiscountRow[])[0] ?? null;
}

function shopDiscountUsable(d: ShopDiscountRow): { ok: boolean; reason?: string } {
  if (!d.is_active) return { ok: false, reason: "This code is no longer active." };
  if (d.expires_at && new Date(d.expires_at).getTime() < Date.now()) return { ok: false, reason: "This code has expired." };
  if (d.max_uses !== -1 && d.used_count >= d.max_uses) return { ok: false, reason: "This code has hit its usage limit." };
  return { ok: true };
}

/** The storefront's discount step, verbatim: percent off the unit
    price, rounded to the cent. Line gross and fee derive from this. */
export function discountedUnitCents(unitCents: number, percentOff: number): number {
  return Math.round((unitCents * (100 - percentOff)) / 100);
}

/** Count one redemption of a code — called ONLY where a sale is
    recorded (paid flip / free-cart record), never at validate. */
async function countShopDiscountUse(shopId: string, code: string): Promise<void> {
  await db.execute(sql`
    UPDATE shop_discount_codes
    SET used_count = used_count + 1
    WHERE shop_id = ${shopId} AND UPPER(code) = ${code.toUpperCase()}
  `);
}

function presentShopDiscount(c: ShopDiscountRow) {
  return {
    id: String(c.id),
    shopId: String(c.shop_id),
    code: String(c.code),
    percentOff: Number(c.percent_off),
    maxUses: Number(c.max_uses),
    usedCount: Number(c.used_count),
    expiresAt: c.expires_at ? String(c.expires_at) : null,
    isActive: Boolean(c.is_active),
    createdAt: String(c.created_at),
  };
}

/* ── Order bumps (Stack-100 #3, feature #13 — shops cart rail) ──────────
   The storefront rail's pattern (routes/storefront.ts) carried to the
   cart checkout: a seller attaches ONE add-on product (same shop,
   seller-set price or seller-set % off) to a product; at cart checkout
   the buyer can tick it for each cart product that offers one, and the
   add-on rides the same Stripe session as its own line (its own
   shop_events row, marked with bump_for_product_id). All bump money
   math lives in lib/order-bumps.ts; the fee is this rail's flat 5%
   per-line split, exactly like every other cart line.
   Persistence is the lane's REPORTED migration (.lane/
   MIGRATION-NEEDED.md): every read below is defensive — absent columns
   mean "no offer", so the rail behaves byte-identically until the
   migration lands, then lights up with no code change. */

export interface ShopBumpOfferPayload {
  productId: string;
  title: string;
  listPriceCents: number;
  listPrice: string;
  percentOff: number;
  priceCents: number;
  price: string;
}

interface ShopProductLite {
  id: string;
  shop_id: string;
  name: string;
  price_cents: number;
  status: string;
}

async function fetchShopProductLite(productId: string): Promise<ShopProductLite | null> {
  const r = await db.execute(sql`
    SELECT id, shop_id, name, price_cents, status
    FROM shop_products
    WHERE id = ${productId}
    LIMIT 1
  `);
  return (r.rows as unknown as ShopProductLite[])[0] ?? null;
}

/** One product's bump attachment, read defensively: the bump columns
    are selected on their own so a pre-migration database (or a row
    that predates them) simply yields "no offer". */
async function fetchShopBumpConfig(productId: string): Promise<BumpConfig | null> {
  try {
    const r = await db.execute(sql`
      SELECT bump_product_id, bump_percent_off
      FROM shop_products
      WHERE id = ${productId}
      LIMIT 1
    `);
    return readBumpConfig(r.rows[0] as Record<string, unknown> | undefined);
  } catch {
    return null;
  }
}

/** Every product's bump attachment in a shop, keyed by product id —
    one defensive query for list payloads. Empty pre-migration. */
async function fetchShopBumpConfigs(shopId: string): Promise<Map<string, BumpConfig>> {
  const out = new Map<string, BumpConfig>();
  try {
    const r = await db.execute(sql`
      SELECT id, bump_product_id, bump_percent_off
      FROM shop_products
      WHERE shop_id = ${shopId}
      LIMIT 500
    `);
    for (const row of r.rows as Array<Record<string, unknown>>) {
      const cfg = readBumpConfig(row);
      if (cfg) out.set(String(row["id"]), cfg);
    }
  } catch {
    /* Pre-migration: no offers anywhere. */
  }
  return out;
}

/** The buyer-facing offer for one product, or null when any part of it
    isn't live (no attachment, target gone / other shop / paused /
    free). A stale setting must never break the main sale. */
function shopBumpOfferFromRows(
  main: { id: string; shop_id: string },
  cfg: BumpConfig | null,
  target: ShopProductLite | null,
): ShopBumpOfferPayload | null {
  if (!cfg || !target) return null;
  const verdict = validateBumpTarget(
    { id: main.id, profileId: main.shop_id },
    {
      id: target.id,
      profileId: target.shop_id,
      priceCents: Number(target.price_cents),
      isActive: target.status === "active",
      /* Shops carry no inventory — an active product is in stock. */
      inventory: -1,
    },
  );
  if (!verdict.ok) return null;
  const unit = bumpUnitCents(Number(target.price_cents), cfg.percentOff);
  return {
    productId: target.id,
    title: target.name,
    listPriceCents: Number(target.price_cents),
    listPrice: formatPriceCents(Number(target.price_cents)),
    percentOff: cfg.percentOff,
    priceCents: unit,
    price: formatPriceCents(unit),
  };
}

type ShopBumpResolution =
  | { ok: true; target: ShopProductLite; unitCents: number; percentOff: number }
  | { ok: false; code: string; message: string };

/** Checkout-time resolution: the tick is re-resolved and re-priced
    HERE — a ticked box with no live offer refuses the whole checkout
    rather than quietly charging for the cart alone or inventing a
    price (the storefront rail's rule). */
async function resolveShopBumpForCheckout(
  mainProductId: string,
  shopId: string,
): Promise<ShopBumpResolution> {
  const cfg = await fetchShopBumpConfig(mainProductId);
  if (!cfg) {
    return { ok: false, code: "BUMP_NOT_OFFERED", message: "That product doesn't have an add-on offer." };
  }
  const target = await fetchShopProductLite(cfg.bumpProductId);
  if (!target || target.shop_id !== shopId) {
    return { ok: false, code: "BUMP_NOT_OFFERED", message: "That add-on isn't for sale right now." };
  }
  if (target.id === mainProductId) {
    return { ok: false, code: "BUMP_SELF", message: "A product can't be its own add-on." };
  }
  if (target.status !== "active") {
    return { ok: false, code: "BUMP_INACTIVE", message: "That add-on isn't for sale right now." };
  }
  if (Math.round(Number(target.price_cents)) <= 0) {
    return { ok: false, code: "BUMP_FREE", message: "A free product can't be a paid add-on." };
  }
  return {
    ok: true,
    target,
    unitCents: bumpUnitCents(Number(target.price_cents), cfg.percentOff),
    percentOff: cfg.percentOff,
  };
}

/** First value of a route param (Express 5 types params as string | string[]). */
function param(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* ── GET /api/shops/mine — my shops (free) ───────────────────────────────── */
router.get("/shops/mine", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const result = await db.execute(sql`
    SELECT s.id, s.user_id, s.name, s.handle, s.tagline, s.description,
           s.banner_color, s.accent_color, s.banner_image_url,
           s.custom_domain, s.domain_verified,
           s.created_at, s.updated_at
    FROM shops s
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC
    LIMIT 50
  `);
  /* Product counts in a separate grouped query (kept pg-mem friendly). */
  const counts = await db.execute(sql`
    SELECT shop_id, COUNT(*)::int AS n
    FROM shop_products
    WHERE user_id = ${userId}
    GROUP BY shop_id
  `);
  const byShop = new Map<string, number>();
  for (const row of counts.rows as unknown as Array<{ shop_id: string; n: number }>) {
    byShop.set(row.shop_id, row.n);
  }
  res.json({
    shops: await Promise.all(
      (result.rows as unknown as Array<{ id: string; banner_image_url: string | null }>).map(async (s) => ({
        ...(await presentShopRow(s)),
        product_count: byShop.get(s.id) ?? 0,
      })),
    ),
  });
});

/* ── POST /api/shops — create a shop (Pro tier or higher) ─────────────────
   Storefronts are a platform feature: opening a shop requires a paid plan.
   Everything after creation (products, AI, analytics) follows its own rules. */
router.post("/shops", publicApiLimiter, requireAuth, requireProTier, async (req, res) => {
  const parsed = createShopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid shop.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const handle = normalizeHandle(parsed.data.handle);
  const problem = handleError(handle);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const taken = await db.execute(sql`SELECT id FROM shops WHERE handle = ${handle} LIMIT 1`);
  if ((taken.rows as unknown[]).length > 0) {
    res.status(409).json({ error: "That handle is already taken — try another one." });
    return;
  }
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle, tagline)
    VALUES (${id}, ${req.userId!}, ${parsed.data.name.trim()}, ${handle}, ${parsed.data.tagline})
  `);
  const shop = await getOwnedShop(id, req.userId!);
  res.status(201).json({ shop });
});

/* ── PATCH /api/shops/:id — update my shop (free) ────────────────────────── */
router.patch("/shops/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = updateShopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid shop update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const d = parsed.data;
  const bannerImageUrl = d.banner_image_url
    ? ((await mirrorExternalMediaUrl(d.banner_image_url, { kind: "image", ownerKey: req.userId! })) ?? d.banner_image_url)
    : null;
  await db.execute(sql`
    UPDATE shops SET
      name = COALESCE(${d.name ?? null}, name),
      tagline = COALESCE(${d.tagline ?? null}, tagline),
      description = COALESCE(${d.description ?? null}, description),
      banner_color = COALESCE(${d.banner_color ?? null}, banner_color),
      accent_color = COALESCE(${d.accent_color ?? null}, accent_color),
      banner_image_url = COALESCE(${bannerImageUrl}, banner_image_url),
      updated_at = NOW()
    WHERE id = ${shop.id}
  `);
  res.json({ shop: await getOwnedShop(shop.id, req.userId!) });
});

/* ── DELETE /api/shops/:id — delete my shop (free) ───────────────────────── */
router.delete("/shops/:id", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  /* Products cascade via FK. Storage objects are NEVER deleted (PR #27). */
  await db.execute(sql`DELETE FROM shops WHERE id = ${shop.id}`);
  res.json({ deleted: true });
});

/* ── GET /api/shops/handle/:handle — PUBLIC storefront data ────────────────
   No auth: anyone can view a storefront. Never leaks the owner's user_id. */
router.get("/shops/handle/:handle", async (req, res) => {
  const handle = normalizeHandle(req.params.handle);
  const shopResult = await db.execute(sql`
    SELECT id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url, created_at
    FROM shops
    WHERE handle = ${handle}
    LIMIT 1
  `);
  const shops = shopResult.rows as unknown as Array<Omit<ShopRow, "user_id" | "updated_at">>;
  const shop = shops[0];
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  /* Buyers see live products only: a paused product (migration 0176)
     is unlisted — filtered here, and its status is never selected, so
     the buyer DTO carries no trace of it. The pinned-ad id (0178) is
     selected only to resolve the pin; it is stripped from the payload
     and replaced by the resolved `pinned_ad` video. */
  const productsResult = await db.execute(sql`
    SELECT id, name, price_cents, description, image_url${await shopProductsHasImageAlt() ? sql`, image_alt_text` : sql``}, created_at, pinned_ugc_ad_id, affiliate_enabled, affiliate_commission_bps${await shopProductsHasSplits() ? sql`, splits` : sql``}
    FROM shop_products
    WHERE shop_id = ${shop.id} AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const productRows = productsResult.rows as unknown as Array<{
    image_url: string | null;
    image_path: string | null;
    pinned_ugc_ad_id: string | null;
  }>;
  const pinnedAds = await pinnedAdVideosById(productRows);
  /* Order bumps (feature #13): each product carries its live add-on
     offer (resolved: same shop, active, priced — otherwise null), so
     the shop page can offer the tick at cart time. Resolved from this
     shop's own rows; pre-migration the config map is empty and every
     product simply carries bump: null. */
  const bumpConfigs = await fetchShopBumpConfigs(shop.id);
  const bumpTargets = new Map<string, ShopProductLite>();
  for (const cfg of bumpConfigs.values()) {
    if (!bumpTargets.has(cfg.bumpProductId)) {
      const t = await fetchShopProductLite(cfg.bumpProductId);
      if (t) bumpTargets.set(t.id, t);
    }
  }
  res.json({
    shop: await presentShopRow(shop),
    products: await Promise.all(
      productRows.map(async (p) => {
        const { pinned_ugc_ad_id, ...pub } = p;
        const pid = String((p as Record<string, unknown>)["id"] ?? "");
        const cfg = bumpConfigs.get(pid) ?? null;
        return {
          ...pub,
          image_url: p.image_url ? await refreshSupabaseStorageUrl(p.image_url) : p.image_url,
          pinned_ad: pinned_ugc_ad_id ? (pinnedAds.get(pinned_ugc_ad_id) ?? null) : null,
          bump: shopBumpOfferFromRows(
            { id: pid, shop_id: shop.id },
            cfg,
            cfg ? (bumpTargets.get(cfg.bumpProductId) ?? null) : null,
          ),
        };
      }),
    ),
  });
});

/* ── GET /api/shops/:id/products — the OWNER's product list (free) ─────────
   Every product in the shop, paused included, each carrying its
   status — this is the management read (my-shop). The public handle
   read above is buyer-shaped and can never serve it: it filters
   paused rows out, which would blind the seller to their own paused
   products. Same no-leak scoping as the other product rails: a shop
   the caller doesn't own 404s. */
router.get("/shops/:id/products", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path${await shopProductsHasImageAlt() ? sql`, image_alt_text` : sql``}, status, pinned_ugc_ad_id, affiliate_enabled, affiliate_commission_bps${await shopProductsHasSplits() ? sql`, splits` : sql``}, created_at, updated_at
    FROM shop_products
    WHERE shop_id = ${shop.id}
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const rows = result.rows as unknown as ProductRow[];
  const pinnedAds = await pinnedAdVideosById(rows);
  /* Owner reads carry the raw bump setting (feature #13) so the
     seller's dashboard can show and edit it even while the add-on is
     paused — buyer reads get the resolved `bump` offer instead. */
  const bumpConfigs = await fetchShopBumpConfigs(shop.id);
  res.json({
    products: await Promise.all(
      rows.map(async (p) => ({
        ...(await presentShopProductRow(p)),
        pinned_ad: p.pinned_ugc_ad_id ? (pinnedAds.get(p.pinned_ugc_ad_id) ?? null) : null,
        bumpConfig: bumpConfigs.get(p.id) ?? null,
      })),
    ),
  });
});

/* ── POST /api/shops/:id/products — add a product (free) ─────────────────── */
router.post("/shops/:id/products", publicApiLimiter, requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = createProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid product.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  /* Affiliates (#16): enabling without a creator-set rate would promise
     fans a % nobody chose — refuse, exactly like the storefront rail. */
  if (parsed.data.affiliate_enabled && parsed.data.affiliate_commission_bps == null) {
    res.status(400).json({
      error: "COMMISSION_REQUIRED",
      message: "Set the commission you'll pay affiliates (affiliate_commission_bps, 1–10000 = 0.01%–100% of your cut) when you turn affiliates on.",
    });
    return;
  }
  /* Co-seller splits (#36): whole-list validation before the write. */
  const splitsWrite = await prepareSplitsWrite(req.userId!, parsed.data.splits);
  if (splitsWrite && "errorStatus" in splitsWrite) {
    res.status(splitsWrite.errorStatus).json({ error: splitsWrite.error, message: splitsWrite.message });
    return;
  }
  const id = randomUUID();
  const storedImageUrl = parsed.data.image_url
    ? ((await mirrorExternalMediaUrl(parsed.data.image_url, { kind: "image", ownerKey: req.userId! })) ?? parsed.data.image_url)
    : null;
  const hasAlt = await shopProductsHasImageAlt();
  const imageAltText = sanitizeAltText(parsed.data.image_alt_text) || null;
  await db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, description, image_url, image_path, affiliate_enabled, affiliate_commission_bps${hasAlt ? sql`, image_alt_text` : sql``}${splitsWrite ? sql`, splits` : sql``})
    VALUES (${id}, ${shop.id}, ${req.userId!},
            ${parsed.data.name.trim()}, ${parsed.data.price_cents},
            ${parsed.data.description}, ${storedImageUrl}, ${isStorageRef(storedImageUrl ?? "") ? storedImageUrl : null},
            ${parsed.data.affiliate_enabled}, ${parsed.data.affiliate_commission_bps ?? null}${hasAlt ? sql`, ${imageAltText}` : sql``}${splitsWrite ? sql`, ${splitsWrite.json}::jsonb` : sql``})
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path${await shopProductsHasImageAlt() ? sql`, image_alt_text` : sql``}, status, pinned_ugc_ad_id, affiliate_enabled, affiliate_commission_bps${await shopProductsHasSplits() ? sql`, splits` : sql``}, created_at, updated_at
    FROM shop_products WHERE id = ${id} LIMIT 1
  `);
  const createdRow = (result.rows as unknown as ProductRow[])[0];
  res.status(201).json({
    product: createdRow
      ? {
          ...(await presentShopProductRow(createdRow)),
          pinned_ad: null,
          bumpConfig: await fetchShopBumpConfig(createdRow.id),
        }
      : createdRow,
  });
});

/* ── PATCH /api/shops/:id/products/:productId (free) ─────────────────────── */
router.patch("/shops/:id/products/:productId", publicApiLimiter, requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = updateProductSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid product update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const existing = await db.execute(sql`
    SELECT id, affiliate_commission_bps FROM shop_products WHERE id = ${param(req.params.productId)} AND shop_id = ${shop.id} LIMIT 1
  `);
  if ((existing.rows as unknown[]).length === 0) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const d = parsed.data;
  /* Affiliates (#16): enabling without a rate in this patch is only
     honest when a rate is already stored (the storefront rail's rule). */
  if (d.affiliate_enabled === true && d.affiliate_commission_bps === undefined) {
    const curBps = (existing.rows[0] as Record<string, unknown>)["affiliate_commission_bps"];
    if (curBps == null) {
      res.status(400).json({
        error: "COMMISSION_REQUIRED",
        message: "Set the commission you'll pay affiliates (affiliate_commission_bps) when you turn affiliates on.",
      });
      return;
    }
  }
  /* Co-seller splits (#36): absent = keep, null = clear, list =
     replace — validated whole before the write. */
  const splitsWrite = await prepareSplitsWrite(req.userId!, d.splits);
  if (splitsWrite && "errorStatus" in splitsWrite) {
    res.status(splitsWrite.errorStatus).json({ error: splitsWrite.error, message: splitsWrite.message });
    return;
  }
  const storedImageUrl = d.image_url
    ? ((await mirrorExternalMediaUrl(d.image_url, { kind: "image", ownerKey: req.userId! })) ?? d.image_url)
    : null;
  const hasAlt = await shopProductsHasImageAlt();
  /* Alt edit semantics: field absent = keep; present ("" included) =
     set exactly that, so a seller can clear a description. */
  const imageAltText = d.image_alt_text === undefined ? null : sanitizeAltText(d.image_alt_text);
  await db.execute(sql`
    UPDATE shop_products SET
      name = COALESCE(${d.name ?? null}, name),
      price_cents = COALESCE(${d.price_cents ?? null}, price_cents),
      description = COALESCE(${d.description ?? null}, description),
      image_url = COALESCE(${storedImageUrl}, image_url),
      image_path = COALESCE(${isStorageRef(storedImageUrl ?? "") ? storedImageUrl : null}, image_path),${hasAlt ? sql`
      image_alt_text = CASE WHEN ${imageAltText} IS NULL THEN image_alt_text ELSE ${imageAltText} END,` : sql``}
      status = COALESCE(${d.status ?? null}, status),
      affiliate_enabled = COALESCE(${d.affiliate_enabled ?? null}, affiliate_enabled),
      affiliate_commission_bps = COALESCE(${d.affiliate_commission_bps ?? null}, affiliate_commission_bps),${splitsWrite ? sql`
      splits = ${splitsWrite.json}::jsonb,` : sql``}
      updated_at = NOW()
    WHERE id = ${param(req.params.productId)}
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path${await shopProductsHasImageAlt() ? sql`, image_alt_text` : sql``}, status, pinned_ugc_ad_id, affiliate_enabled, affiliate_commission_bps${await shopProductsHasSplits() ? sql`, splits` : sql``}, created_at, updated_at
    FROM shop_products WHERE id = ${param(req.params.productId)} LIMIT 1
  `);
  const updatedRow = (result.rows as unknown as ProductRow[])[0];
  if (!updatedRow) {
    res.json({ product: updatedRow });
    return;
  }
  const pinnedAds = await pinnedAdVideosById([updatedRow]);
  res.json({
    product: {
      ...(await presentShopProductRow(updatedRow)),
      pinned_ad: updatedRow.pinned_ugc_ad_id
        ? (pinnedAds.get(updatedRow.pinned_ugc_ad_id) ?? null)
        : null,
      bumpConfig: await fetchShopBumpConfig(updatedRow.id),
    },
  });
});

/* ── DELETE /api/shops/:id/products/:productId (free) ────────────────────── */
router.delete("/shops/:id/products/:productId", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  /* Storage object is NEVER deleted (PR #27 lesson) — row only. */
  await db.execute(sql`
    DELETE FROM shop_products WHERE id = ${param(req.params.productId)} AND shop_id = ${shop.id}
  `);
  res.json({ deleted: true });
});

/* ── PUT /api/shops/:id/products/:productId/bump — order-bump attachment ──
   One add-on per product (feature #13). Attach-time hard rules mirror
   the storefront rail: the add-on must be the SAME shop's product,
   never the product itself, and never a $0 product (free goods ride
   the free-cart path, not a paid line). A paused add-on may be
   attached — the buyer-facing offer stays hidden until it's active,
   and the response says whether the offer is live right now. The
   UPDATE names the bump columns outright, so pre-migration this one
   surface answers an honest 500 (every read stays defensive). */
const setShopBumpSchema = z.object({
  bumpProductId: z.string().uuid().nullable(),
  percentOff: z.number().int().min(0).max(MAX_BUMP_PERCENT_OFF).default(0),
});

router.put("/shops/:id/products/:productId/bump", publicApiLimiter, requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = setShopBumpSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bump setting.", details: parsed.error.issues });
    return;
  }
  const productId = param(req.params.productId);
  try {
    const main = await fetchShopProductLite(productId);
    if (!main || main.shop_id !== shop.id) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const { bumpProductId, percentOff } = parsed.data;
    if (bumpProductId) {
      const target = await fetchShopProductLite(bumpProductId);
      if (!target || target.shop_id !== shop.id) {
        res.status(400).json({
          error: "BUMP_NOT_YOURS",
          message: "The add-on has to be one of this shop's own products.",
        });
        return;
      }
      const verdict = validateBumpTarget(
        { id: main.id, profileId: main.shop_id },
        {
          id: target.id,
          profileId: target.shop_id,
          priceCents: Number(target.price_cents),
          isActive: target.status === "active",
          inventory: -1,
        },
      );
      /* A paused add-on may be attached (it just isn't offered yet);
         every other refusal is hard. */
      if (!verdict.ok && verdict.code !== "BUMP_INACTIVE") {
        res.status(400).json({ error: verdict.code, message: verdict.reason });
        return;
      }
    }
    const r = await db.execute(sql`
      UPDATE shop_products
      SET bump_product_id = ${bumpProductId}, bump_percent_off = ${bumpProductId ? percentOff : 0},
          updated_at = NOW()
      WHERE id = ${productId} AND shop_id = ${shop.id}
      RETURNING id
    `);
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const cfg = await fetchShopBumpConfig(productId);
    const target = cfg ? await fetchShopProductLite(cfg.bumpProductId) : null;
    const offer = shopBumpOfferFromRows({ id: main.id, shop_id: shop.id }, cfg, target);
    logger.info({ userId: req.userId, shopId: shop.id, productId, bumpProductId, percentOff }, "[shops] product bump updated");
    res.json({ productId, bumpConfig: cfg, offerLive: offer !== null, bump: offer });
  } catch (err) {
    logger.error({ err, shopId: shop.id, productId }, "[shops] product bump update failed");
    res.status(500).json({ error: "Could not update the add-on offer." });
  }
});

/* ── Shop discount codes: owner management (0190) ────────────────────────
   Mirrors the storefront's /storefront/discounts CRUD, scoped to a
   shop the caller owns (getOwnedShop — another owner's shop 404s
   exactly like a missing one, on every verb). */

const UUID_PARAM_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const createShopDiscountSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only."),
  percentOff: z.number().int().min(1).max(90),
  maxUses: z.number().int().min(-1).default(-1),
  expiresAt: z.string().datetime().nullable().optional(),
});

router.get("/shops/:id/discounts", requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const r = await db.execute(sql`
    SELECT id, shop_id, code, percent_off, max_uses, used_count, expires_at, is_active, created_at
    FROM shop_discount_codes
    WHERE shop_id = ${shop.id}
    ORDER BY created_at DESC
    LIMIT 200
  `);
  const activeProducts = await productCount(shop.id);
  const codes = (r.rows as unknown as ShopDiscountRow[]).map((c) => ({
    ...presentShopDiscount(c),
    /* Codes are shop-wide: they apply to every product in the shop. */
    appliesTo: `${activeProducts} product(s)`,
  }));
  res.json({ codes });
});

router.post("/shops/:id/discounts", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = createShopDiscountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid discount code.", details: parsed.error.issues });
    return;
  }
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const d = parsed.data;
  /* Duplicate name → 409, the storefront's answer. SELECT-first (the
     unique index stays the backstop for a same-instant race): the
     storefront's ON CONFLICT … DO NOTHING + empty-RETURNING idiom
     reads differently under the pg-mem test engine, and this route's
     behavior must be identical on both. */
  const existing = await findShopDiscount(shop.id, d.code);
  if (existing) {
    res.status(409).json({ error: "CODE_TAKEN", message: "This shop already has a code with that name." });
    return;
  }
  let r;
  try {
    r = await db.execute(sql`
      INSERT INTO shop_discount_codes (shop_id, code, percent_off, max_uses, expires_at)
      VALUES (${shop.id}, ${d.code.trim().toUpperCase()}, ${d.percentOff}, ${d.maxUses}, ${d.expiresAt ?? null})
      RETURNING id, shop_id, code, percent_off, max_uses, used_count, expires_at, is_active, created_at
    `);
  } catch (err) {
    const msg = err instanceof Error ? pgErrorText(err) : String(err);
    if (isUniqueViolation(err) || /duplicate key|unique/i.test(msg)) {
      res.status(409).json({ error: "CODE_TAKEN", message: "This shop already has a code with that name." });
      return;
    }
    throw err;
  }
  logger.info({ userId: req.userId, shopId: shop.id, code: (r.rows[0] as Record<string, unknown>)["code"] }, "[shops] discount code created");
  res.status(201).json({ code: presentShopDiscount(r.rows[0] as unknown as ShopDiscountRow) });
});

router.patch("/shops/:id/discounts/:codeId", publicApiLimiter, requireAuth, async (req, res) => {
  const codeId = param(req.params.codeId);
  const parsed = z.object({
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    maxUses: z.number().int().min(-1).optional(),
  }).safeParse(req.body ?? {});
  if (!UUID_PARAM_RE.test(codeId) || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const d = parsed.data;
  const sets: ReturnType<typeof sql>[] = [];
  if (d.isActive !== undefined) sets.push(sql`is_active = ${d.isActive}`);
  if (d.expiresAt !== undefined) sets.push(sql`expires_at = ${d.expiresAt}`);
  if (d.maxUses !== undefined) sets.push(sql`max_uses = ${d.maxUses}`);
  if (sets.length === 0) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  const r = await db.execute(sql`
    UPDATE shop_discount_codes SET ${sql.join(sets, sql`, `)}
    WHERE id = ${codeId} AND shop_id = ${shop.id}
    RETURNING id
  `);
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Discount code not found." });
    return;
  }
  res.json({ ok: true });
});

router.delete("/shops/:id/discounts/:codeId", requireAuth, async (req, res) => {
  const codeId = param(req.params.codeId);
  if (!UUID_PARAM_RE.test(codeId)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const r = await db.execute(sql`
    DELETE FROM shop_discount_codes WHERE id = ${codeId} AND shop_id = ${shop.id} RETURNING id
  `);
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Discount code not found." });
    return;
  }
  res.json({ ok: true });
});

/* ── GET /api/shops/:id/discounts/validate?code= — public ──────────────────
   Answers "is this code good at THIS shop?" without spending a use —
   uses are only incremented when a sale is recorded. */
router.get("/shops/:id/discounts/validate", publicApiLimiter, async (req, res) => {
  const shopId = param(req.params.id);
  const code = String(req.query.code ?? "").trim();
  if (!UUID_PARAM_RE.test(shopId) || !code) {
    res.status(400).json({ error: "code is required." });
    return;
  }
  const shopRes = await db.execute(sql`SELECT id FROM shops WHERE id = ${shopId} LIMIT 1`);
  if (shopRes.rows.length === 0) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const d = await findShopDiscount(shopId, code);
  if (!d) {
    res.json({ valid: false, reason: "That code doesn't exist for this shop." });
    return;
  }
  const usable = shopDiscountUsable(d);
  if (!usable.ok) {
    res.json({ valid: false, reason: usable.reason });
    return;
  }
  res.json({ valid: true, code: d.code, percentOff: Number(d.percent_off) });
});

/* ── AI: shop description writer — 1 credit ───────────────────────────────── */
router.post("/shops/ai/shop-description", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = shopDescriptionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const balance = req.userCredits ?? 0;
  if (balance < SHOP_AI_CREDIT_COST) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to use the AI shop writer." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Shop Description" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to use the AI shop writer." });
      return;
    }
    throw err;
  }

  try {
    const { shopName, tagline, niche, products } = parsed.data;
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a luxury brand copywriter for independent creators selling their own merch and ` +
            `digital products. Write a storefront "about" blurb: 2–3 sentences, confident and premium, ` +
            `gold/black luxury energy without sounding corporate. No hype clichés ("game-changer", ` +
            `"revolutionary"), no emojis. Return ONLY JSON: {"description": "..."}.`,
        },
        {
          role: "user",
          content:
            `Shop name: ${shopName}\n` +
            `Tagline: ${tagline || "(none)"}\n` +
            `Niche: ${niche || "(not specified)"}\n` +
            `What they sell: ${products || "(not specified)"}`,
        },
      ],
      response_format: { type: "json_object" },
      /* GPT-6 rejects max_tokens — max_completion_tokens is the correct param. */
      max_completion_tokens: 400,
      temperature: 0.8,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let description = "";
    try {
      const j = JSON.parse(raw) as { description?: unknown };
      if (typeof j.description === "string" && j.description.trim()) description = j.description.trim();
    } catch { /* fall through */ }
    if (!description) throw new Error("Model returned no usable description");
    res.json({ description, creditsUsed: SHOP_AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Shop Description — Refund (provider failed)" });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[shops] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[shops] shop-description generation failed");
    res.status(502).json({ error: "The studio hiccupped — your Visual Buc was refunded. Try again." });
  }
});

/* ── AI: product description generator — 1 credit ─────────────────────────── */
router.post("/shops/ai/product-description", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = productDescriptionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const balance = req.userCredits ?? 0;
  if (balance < SHOP_AI_CREDIT_COST) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to use the AI product writer." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Product Description" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to use the AI product writer." });
      return;
    }
    throw err;
  }

  try {
    const { productName, details, price, tone } = parsed.data;
    const toneDirection: Record<string, string> = {
      luxury: "premium, confident, gold-standard luxury",
      playful: "fun, energetic, creator-to-fan",
      minimal: "clean, understated, Apple-store minimal",
      bold: "loud, hype, streetwear-drop energy",
    };
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a product copywriter for creator merch and digital products. Write a product ` +
            `description: 2–4 sentences that sell the benefit, not just the features, in a ` +
            `${toneDirection[tone]} voice. End with one short bullet list of 3 highlights ` +
            `(each under 8 words). No emojis, no hype clichés. ` +
            `Return ONLY JSON: {"description": "..."}.`,
        },
        {
          role: "user",
          content:
            `Product: ${productName}\n` +
            `Details: ${details || "(none provided)"}\n` +
            `Price: ${price || "(not set)"}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 500,
      temperature: 0.8,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let description = "";
    try {
      const j = JSON.parse(raw) as { description?: unknown };
      if (typeof j.description === "string" && j.description.trim()) description = j.description.trim();
    } catch { /* fall through */ }
    if (!description) throw new Error("Model returned no usable description");
    res.json({ description, creditsUsed: SHOP_AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Product Description — Refund (provider failed)" });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[shops] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[shops] product-description generation failed");
    res.status(502).json({ error: "The studio hiccupped — your Visual Buc was refunded. Try again." });
  }
});

/* ── AI: product image — 1 credit standard / 2 credits premium ────────────── */
router.post("/shops/ai/product-image", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = productImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const creditCost =
    parsed.data.tier === "premium" ? SHOP_IMAGE_PREMIUM_CREDITS : SHOP_IMAGE_STANDARD_CREDITS;
  const balance = req.userCredits ?? 0;
  if (balance < creditCost) {
    res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs for this product image." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, creditCost, {
      action: `AI Product Image (${parsed.data.tier})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs for this product image." });
      return;
    }
    throw err;
  }

  try {
    const { productName, styleHint, tier } = parsed.data;
    const styleLine = styleHint.trim() ? ` Style direction: ${styleHint.trim()}.` : "";
    const prompt =
      `Premium e-commerce product photograph of "${productName}" — a single hero product shot, ` +
      `studio lighting, clean dark background with subtle gold accents, ultra-detailed, ` +
      `commercial product photography, centered composition, no text, no watermark, no people.${styleLine}`;
    const imageResp = await getOpenAI().images.generate({
      model: SHOP_IMAGE_MODEL,
      prompt: prompt.slice(0, 4000),
      size: "1024x1024",
      quality: tier === "premium" ? "high" : "medium",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no image data.");

    /* R2 upload with namespaced key (shop-products/<userId>/products/<uuid>.png).
       Falls back to Supabase only when R2 is not configured. */
    const filePath = `${req.userId!}/products/${randomUUID()}.png`;
    const r2Key = `${SHOP_PRODUCTS_BUCKET}/${filePath}`;
    let publicUrl: string;
    if (isR2Configured()) {
      publicUrl = await r2Upload(r2Key, Buffer.from(b64, "base64"), "image/png");
    } else {
      /* Self-healing bucket: verify/create BEFORE the upload, never assume it
         exists. Throws loudly on failure → credit is refunded by the catch. */
      const { ensureShopProductsBucket } = await import("../../lib/objectStorage");
      await ensureShopProductsBucket();
      const { error: upErr } = await getSupabaseAdmin().storage
        .from(SHOP_PRODUCTS_BUCKET)
        .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;
      publicUrl = getSupabaseAdmin().storage
        .from(SHOP_PRODUCTS_BUCKET)
        .getPublicUrl(filePath).data.publicUrl;
    }

    res.json({
      url: publicUrl,
      path: filePath,
      tier,
      creditsUsed: creditCost,
      creditsRemaining,
    });
  } catch (err) {
    await refundCredits(req.userId!, creditCost, {
      action: `AI Product Image (${parsed.data.tier}) — Refund (provider failed)`,
    });
    const msg = err instanceof Error ? err.message : "Product image generation failed";
    logger.error({ err: msg }, "[shops] product-image generation failed — Visual Buc refunded");
    res.status(502).json({ error: `${msg} Your Visual Buc was refunded.` });
  }
});


/* ─── Storefronts platform layer (Stack 8 #2 — merged from
   generate/storefronts.ts) ─────────────────────────────────────────────
   Hub, public storefront by slug, analytics, sale recording, and custom
   domains over the SAME shops / shop_products / shop_events tables this
   module's CRUD + AI tools serve. One canonical shop surface: this file.
   The helpers below (STOREFRONT_PLATFORM_FEE_BPS, meetsProTier,
   requireProTier, issueDomainToken, txtRecordsMatch) keep their names —
   routes/store.ts, the require-auth plan tests, and this module's own
   Pro gates import them (via the generate/storefronts.ts shim). */

/* ── Platform economics — env-overridable without a deploy ─────────────── */
export const STOREFRONT_PLATFORM_FEE_BPS =
  Number(process.env["STOREFRONT_PLATFORM_FEE_BPS"]) || 500; // 500 bps = 5% (owner ruling 2026-10-18)
export const PLATFORM_FEE_PCT = STOREFRONT_PLATFORM_FEE_BPS / 100;

/**
 * "Pro or higher" tier gate. Plan names on the pricing page: Creator,
 * Pro Artist, Studio, VIP, MVP. Shops + custom domains require Pro Artist
 * or above — free / Creator plans are redirected to /pricing.
 */
export function meetsProTier(plan: string | null | undefined): boolean {
  const p = (plan ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!p) return false;
  return (
    p.includes("pro") ||
    p.includes("studio") ||
    p.includes("vip") ||
    p.includes("mvp")
  );
}

export function requireProTier(req: any, res: any, next: any) {
  if (meetsProTier(req.userPlan)) return next();
  res.status(403).json({
    error: "PRO_TIER_REQUIRED",
    message:
      "Storefronts require a Pro plan or higher. Upgrade to open your own shop.",
    upgradeUrl: "/pricing",
  });
}

/* ── Domain rules ──────────────────────────────────────────────────────────
   Real verification: the owner publishes a TXT record at
   bdv-verify.<domain> containing the issued token. We never fake this. */
const DOMAIN_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/;
const VERIFY_HOST_PREFIX = "bdv-verify";

function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN_RE.test(d) || d.length > 253) return null;
  if (d.endsWith(".bowdownvisuals.com")) return null; // platform subdomains stay ours
  return d;
}

export function issueDomainToken(): string {
  return `bdv-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Pure: does any TXT record at the host match the token? */
export function txtRecordsMatch(records: string[][], token: string): boolean {
  for (const rec of records) {
    if (rec.join("").trim() === token) return true;
  }
  return false;
}

async function checkDomainTxt(domain: string, token: string): Promise<{ ok: boolean; reason: string }> {
  const host = `${VERIFY_HOST_PREFIX}.${domain}`;
  let records: string[][];
  try {
    records = await dns.resolveTxt(host);
  } catch (err: any) {
    const code = err?.code ?? "UNKNOWN";
    return {
      ok: false,
      reason:
        code === "ENOTFOUND" || code === "ENODATA"
          ? `No TXT record found at ${host} yet — DNS can take a few minutes to propagate.`
          : `DNS lookup failed (${code}). Try again in a minute.`,
    };
  }
  if (txtRecordsMatch(records, token)) return { ok: true, reason: "verified" };
  return {
    ok: false,
    reason: `TXT record at ${host} doesn't match the verification token yet.`,
  };
}

/* ── View dedup: one counted view per IP+shop per hour ───────────────────── */
function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`shop-view|${ip}`).digest("hex").slice(0, 32);
}

async function recordView(shopId: string, userId: string, ip: string | undefined) {
  const ipHash = hashIp(ip);
  try {
    if (ipHash) {
      const recent = await db.execute(sql`
        SELECT id FROM shop_events
        WHERE shop_id = ${shopId} AND event_type = 'view' AND ip_hash = ${ipHash}
          AND created_at > NOW() - INTERVAL '1 hour'
        LIMIT 1
      `);
      if ((recent.rows as unknown[]).length > 0) return;
    }
    await db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, ip_hash)
      VALUES (${randomUUID()}, ${shopId}, ${userId}, 'view', ${ipHash})
    `);
  } catch (err) {
    /* Analytics must never break the storefront. */
    logger.warn({ err, shopId }, "[storefronts] view record failed");
  }
}

async function getOwnedShopFull(shopId: string, userId: string) {
  const result = await db.execute(sql`
    SELECT id, user_id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url,
           custom_domain, domain_verified, domain_verification_token,
           created_at, updated_at
    FROM shops
    WHERE id = ${shopId} AND user_id = ${userId}
    LIMIT 1
  `);
  const rows = result.rows as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

/* ── GET /api/storefronts — public hub ─────────────────────────────────────
   Every creator shop on the platform. Free, no auth. */
router.get("/storefronts", async (req, res) => {
  const q = (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q ?? "").toString().trim().slice(0, 60);
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 100);
  const where = q
    ? sql`WHERE (s.name ILIKE ${"%" + q + "%"} OR s.handle ILIKE ${"%" + q + "%"} OR COALESCE(s.tagline, '') ILIKE ${"%" + q + "%"})`
    : sql``;
  const result = await db.execute(sql`
    SELECT s.id, s.name, s.handle, s.tagline, s.description,
           s.banner_color, s.accent_color, s.banner_image_url,
           s.custom_domain, s.domain_verified, s.created_at
    FROM shops s
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `);
  /* Live-product counts in a separate grouped query (kept pg-mem
     friendly, same as /shops/mine — the correlated-subquery form
     this replaces could not run under the test database at all).
     Paused products (migration 0176) are unlisted, so the public
     count is live products only; the owner's /mine count stays the
     owner's full truth. */
  const counts = await db.execute(sql`
    SELECT shop_id, COUNT(*)::int AS n
    FROM shop_products
    WHERE status = 'active'
    GROUP BY shop_id
  `);
  const byShop = new Map<string, number>();
  for (const row of counts.rows as unknown as Array<{ shop_id: string; n: number }>) {
    byShop.set(row.shop_id, row.n);
  }
  const shopRows = (await refreshSupabaseStorageUrlsDeep(result.rows)) as Array<
    Record<string, unknown> & { id: string }
  >;
  res.json({
    shops: shopRows.map((s) => ({ ...s, product_count: byShop.get(s.id) ?? 0 })),
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

/* ── GET /api/storefronts/slug/:slug — public storefront + view ────────────
   No auth: anyone can view. Records a (deduped) view. Never leaks user_id.
   Resolution is TWO namespaces, in order:
   1. shops.handle — the canonical caller (/shop/:handle, hub links).
   2. creator_profiles.slug → profile's user_id → that user's shop —
      the media-page caller (MediaLinkBar via lib/streaming.ts
      resolveStoreSlug, fed creator-profile slugs from track / watch /
      playlist pages). Shop handles are freely chosen at creation and
      are NOT the owner's profile slug; without this fallback the
      lookup 404'd whenever they differed and the Store button on
      media pages never rendered. Handle wins on a collision so the
      canonical namespace is never shadowed by a profile slug. */
router.get("/storefronts/slug/:slug", async (req, res) => {
  const slug = (Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug ?? "").toLowerCase();
  const shopResult = await db.execute(sql`
    SELECT id, user_id, name, handle, tagline, description,
           banner_color, accent_color, banner_image_url,
           custom_domain, domain_verified, created_at
    FROM shops
    WHERE handle = ${slug}
    LIMIT 1
  `);
  let shops = shopResult.rows as unknown as Array<Record<string, unknown> & { id: string; user_id: string }>;
  if (shops.length === 0) {
    const byProfileResult = await db.execute(sql`
      SELECT s.id, s.user_id, s.name, s.handle, s.tagline, s.description,
             s.banner_color, s.accent_color, s.banner_image_url,
             s.custom_domain, s.domain_verified, s.created_at
      FROM shops s
      JOIN creator_profiles cp ON cp.user_id = s.user_id
      WHERE cp.slug = ${slug}
      ORDER BY s.created_at ASC
      LIMIT 1
    `);
    shops = byProfileResult.rows as unknown as Array<Record<string, unknown> & { id: string; user_id: string }>;
  }
  const shop = shops[0];
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  /* Buyers see live products only — paused rows (migration 0176) are
     unlisted here exactly as on the handle read, status unselected.
     The pinned-ad id (0178) is selected only to resolve the pin and
     stripped before the payload leaves, exactly as on the handle
     read; the minted video URL passes the deep refresh untouched. */
  const productsResult = await db.execute(sql`
    SELECT id, name, price_cents, description, image_url${await shopProductsHasImageAlt() ? sql`, image_alt_text` : sql``}, created_at, pinned_ugc_ad_id, affiliate_enabled, affiliate_commission_bps${await shopProductsHasSplits() ? sql`, splits` : sql``}
    FROM shop_products
    WHERE shop_id = ${shop.id} AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const { user_id, ...publicShop } = shop;
  /* Fire-and-forget analytics — never blocks the page. */
  recordView(shop.id, user_id, req.ip);
  const rawProducts = productsResult.rows as unknown as Array<
    Record<string, unknown> & { pinned_ugc_ad_id: string | null }
  >;
  const pinnedAds = await pinnedAdVideosById(rawProducts);
  /* Order bumps (feature #13): the live add-on offer rides each
     product exactly as on the handle read — this is the payload the
     shop page's cart actually renders from. */
  const bumpConfigs = await fetchShopBumpConfigs(shop.id);
  const bumpTargets = new Map<string, ShopProductLite>();
  for (const cfg of bumpConfigs.values()) {
    if (!bumpTargets.has(cfg.bumpProductId)) {
      const t = await fetchShopProductLite(cfg.bumpProductId);
      if (t) bumpTargets.set(t.id, t);
    }
  }
  const buyerProducts = rawProducts.map((p) => {
    const { pinned_ugc_ad_id, ...pub } = p;
    const pid = String(p["id"] ?? "");
    const cfg = bumpConfigs.get(pid) ?? null;
    return {
      ...pub,
      pinned_ad: pinned_ugc_ad_id ? (pinnedAds.get(pinned_ugc_ad_id) ?? null) : null,
      bump: shopBumpOfferFromRows(
        { id: pid, shop_id: shop.id },
        cfg,
        cfg ? (bumpTargets.get(cfg.bumpProductId) ?? null) : null,
      ),
    };
  });
  res.json(await refreshSupabaseStorageUrlsDeep({
    shop: publicShop,
    products: buyerProducts,
    platformFeePct: PLATFORM_FEE_PCT,
  }));
});

/* ── GET /api/storefronts/:id/analytics — owner-only ─────────────────────── */
router.get("/storefronts/:id/analytics", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const totals = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'view')::int AS views,
      COUNT(*) FILTER (WHERE event_type = 'sale')::int AS sales,
      COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'sale'), 0)::int AS gross_cents,
      COALESCE(SUM(platform_fee_cents) FILTER (WHERE event_type = 'sale'), 0)::int AS platform_fee_cents
    FROM shop_events
    WHERE shop_id = ${shop.id}
  `);
  const daily = await db.execute(sql`
    SELECT DATE_TRUNC('day', created_at)::date AS day,
           COUNT(*)::int AS views
    FROM shop_events
    WHERE shop_id = ${shop.id} AND event_type = 'view'
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  const sales = await db.execute(sql`
    SELECT e.id, e.product_id, p.name AS product_name,
           e.amount_cents, e.platform_fee_cents,
           (e.amount_cents - e.platform_fee_cents) AS seller_net_cents,
           e.buyer_email, e.created_at,
           e.quantity, e.payment_status, e.paid_at
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.shop_id = ${shop.id} AND e.event_type = 'sale'
    ORDER BY e.created_at DESC
    LIMIT 100
  `);
  /* Pending checkouts are the seller's honest "not yet" list: shown
     apart, never folded into the sales totals above (0146). */
  const pending = await db.execute(sql`
    SELECT e.id, e.product_id, p.name AS product_name,
           e.amount_cents, e.platform_fee_cents,
           (e.amount_cents - e.platform_fee_cents) AS seller_net_cents,
           e.buyer_email, e.created_at, e.quantity, e.payment_status
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.shop_id = ${shop.id} AND e.event_type = 'pending_sale'
    ORDER BY e.created_at DESC
    LIMIT 100
  `);
  const t = (totals.rows as unknown as Array<Record<string, number>>)[0] ?? {
    views: 0, sales: 0, gross_cents: 0, platform_fee_cents: 0,
  };
  res.json({
    totals: {
      views: t.views,
      sales: t.sales,
      gross_cents: t.gross_cents,
      platform_fee_cents: t.platform_fee_cents,
      seller_net_cents: t.gross_cents - t.platform_fee_cents,
      pending_orders: (pending.rows as unknown[]).length,
    },
    dailyViews: daily.rows,
    sales: sales.rows,
    pendingSales: pending.rows,
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

/* ── POST /api/storefronts/checkout — real card checkout (0146) ───────────
   The house pattern (tip-jar / shoutouts / memberships, over
   lib/stripe-checkout): the order is recorded FIRST as pending
   (shop_events event_type='pending_sale' — never counted as a sale),
   then a hosted Stripe Checkout session opens for the cart total, and
   the sale only becomes a sale when the session is confirmed paid via
   POST /storefronts/checkout/verify or the central webhook — both run
   the same guarded flip in lib/market-sale.
   Amounts are ALWAYS computed here from shop_products.price_cents —
   the client sends product ids and quantities, never money.
   The 5% platform fee comes out of the SELLER's cut; the buyer pays
   the listed price. All money math in integer cents.
   Seller side: the house's Stripe Connect is recipient/transfers-only
   (money-out — see lib/stripe-connect); there are NO destination
   charges anywhere, so this is a platform-account checkout (TEST mode
   only, enforced by getCheckoutStripe): funds land on the platform
   account, the row records the seller (shop owner user_id) and their
   net, settled later through the existing creator-payout path.
   A zero-total cart (free goods) needs no card: it records as paid
   with payment_status='no_payment_required', honestly labelled.
   Discount codes (0190): an optional code is validated against THIS
   shop's shop_discount_codes, applied to unit prices before the fee
   (the storefront's sequence), carried on the order rows, and counted
   as used only when the sale records — at the flip, or right here for
   a free cart.
   Order bumps (feature #13): includeBumps ticks a cart product's
   attached add-on; it is re-resolved + re-priced server-side, rides
   the same session as its own line/row (marked bump_for_product_id),
   and is never discounted by the shop code. */
const checkoutSchema = z.object({
  shopId: z.string().uuid(),
  /* Legacy single-line shape (kept for older callers). */
  productId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
  /* Cart shape: one checkout — one session — for the whole cart. */
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99).default(1),
  })).min(1).max(50).optional(),
  buyerEmail: z.string().trim().email().max(254).optional().default(""),
  /* Optional shop discount code (0190) — validated server-side against
     THIS shop's codes, exactly like the storefront rail validates
     against the seller's profile. */
  discountCode: z.string().trim().min(1).max(40).optional(),
  /* Optional affiliate share code (#16) — validated server-side against
     ONE product in the cart; that line's shop_events rows carry it to
     the paid flip, where the commission records exactly once. */
  affiliateCode: z.string().trim().min(1).max(64).optional(),
  /* Gift-card tender (Stack-100 #3 #26) — sits beside the discount
     code but is stored value, not a markdown: the discount prices the
     cart first, then the card (issued by THIS shop's owner in their
     creator store) tenders against the total. Fee stays on the full
     discounted gross (lib/gift-cards.ts fee law). */
  giftCardCode: z.string().trim().min(1).max(40).optional(),
  /* Order bumps (feature #13): the cart product ids whose attached
     add-on the buyer ticked. Each tick is re-resolved and re-priced
     server-side — the tick alone buys nothing. */
  includeBumps: z.array(z.string().uuid()).max(50).optional().default([]),
});

interface CheckoutLine {
  productId: string;
  name: string;
  /** The unit price actually charged (after any discount). */
  unitCents: number;
  /** The listed unit price before any discount. */
  listUnitCents: number;
  quantity: number;
  gross: number;
  fee: number;
  saleId: string;
  /** The validated affiliate code for THIS line, or null (#16). */
  affiliateCode?: string | null;
  /** Order bump (feature #13): this line is a ticked add-on, attached
      through the cart product `bumpFor`. */
  isBump?: boolean;
  bumpFor?: string;
}

/** Insert one order line into shop_events. Bump lines carry the
    bump_for_product_id marker on their own best-effort insert: if the
    marker column hasn't landed yet the plain insert still records the
    order (unreachable in practice — a bump line can only exist once
    the attachment columns do — but an order must never be lost to a
    labelling column). */
async function insertShopEventLine(
  l: CheckoutLine,
  shopId: string,
  sellerUserId: string,
  opts: {
    eventType: "sale" | "pending_sale";
    paymentStatus: string;
    paidNow: boolean;
    buyerEmail: string;
    groupId: string;
    discountCode: string | null;
  },
): Promise<void> {
  if (l.isBump && l.bumpFor) {
    try {
      await db.execute(sql`
        INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, payment_status, paid_at, quantity, checkout_group_id, discount_code, bump_for_product_id, affiliate_code)
        VALUES (${l.saleId}, ${shopId}, ${sellerUserId}, ${opts.eventType}, ${l.productId}, ${l.gross}, ${l.fee}, ${opts.buyerEmail || null}, ${opts.paymentStatus}, ${opts.paidNow ? sql`now()` : sql`NULL`}, ${l.quantity}, ${opts.groupId}, ${opts.discountCode}, ${l.bumpFor}, ${l.affiliateCode ?? null})
      `);
      return;
    } catch {
      /* Marker column absent — record the line without it. */
    }
  }
  await db.execute(sql`
    INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, payment_status, paid_at, quantity, checkout_group_id, discount_code, affiliate_code)
    VALUES (${l.saleId}, ${shopId}, ${sellerUserId}, ${opts.eventType}, ${l.productId}, ${l.gross}, ${l.fee}, ${opts.buyerEmail || null}, ${opts.paymentStatus}, ${opts.paidNow ? sql`now()` : sql`NULL`}, ${l.quantity}, ${opts.groupId}, ${opts.discountCode}, ${l.affiliateCode ?? null})
  `);
}

router.post("/storefronts/checkout", publicApiLimiter, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success || (!parsed.data.productId && !parsed.data.items)) {
    res.status(400).json({ error: "Invalid order." });
    return;
  }
  const { shopId, buyerEmail } = parsed.data;

  /* Merge duplicate lines, then price EVERY line from the server's
     own product rows — client-supplied amounts are never read. */
  const wanted = new Map<string, number>();
  const rawLines = parsed.data.items ?? [{ productId: parsed.data.productId!, quantity: parsed.data.quantity }];
  for (const l of rawLines) {
    wanted.set(l.productId, Math.min(99, (wanted.get(l.productId) ?? 0) + l.quantity));
  }

  const shopRes = await db.execute(sql`
    SELECT id, user_id, name, handle FROM shops WHERE id = ${shopId} LIMIT 1
  `);
  const shop = (shopRes.rows as unknown as Array<{ id: string; user_id: string; name: string; handle: string }>)[0];
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }

  /* Server-side discount validation (0190), before any row is written:
     the code must exist for THIS shop and be usable. A code from
     another shop — even with the same name — never applies here. */
  let discountCode: string | null = null;
  let percentOff = 0;
  if (parsed.data.discountCode) {
    const d = await findShopDiscount(shopId, parsed.data.discountCode);
    if (!d) {
      res.status(400).json({ error: "BAD_CODE", message: "That discount code doesn't exist for this shop." });
      return;
    }
    const usable = shopDiscountUsable(d);
    if (!usable.ok) {
      res.status(400).json({ error: "BAD_CODE", message: usable.reason });
      return;
    }
    discountCode = d.code;
    percentOff = Number(d.percent_off);
  }

  const lines: CheckoutLine[] = [];
  for (const [productId, quantity] of wanted) {
    const prod = await db.execute(sql`
      SELECT p.id, p.name, p.price_cents, p.status
      FROM shop_products p
      WHERE p.id = ${productId} AND p.shop_id = ${shopId}
      LIMIT 1
    `);
    const product = (prod.rows as unknown as Array<{ id: string; name: string; price_cents: number; status: string }>)[0];
    /* A paused product (migration 0176) is unlisted: to a buyer it is
       indistinguishable from a product that isn't in this shop, so it
       refuses on the exact same path — 404, before any row is written
       or any charge is attempted. A paused product can never sell. */
    if (!product || product.status !== "active") {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    /* The storefront's money sequence (0190): discount the unit price
       first (rounded), line gross from the discounted unit, then the
       ruled 5% fee out of the discounted gross. */
    const listUnitCents = Number(product.price_cents);
    const unitCents = percentOff > 0 ? discountedUnitCents(listUnitCents, percentOff) : listUnitCents;
    const gross = unitCents * quantity;
    lines.push({
      productId, name: product.name, unitCents, listUnitCents, quantity,
      gross, fee: Math.round((gross * STOREFRONT_PLATFORM_FEE_BPS) / 10_000),
      saleId: randomUUID(),
      affiliateCode: null,
    });
  }

  /* Affiliate attribution (#16): the presented code must be an active
     code for ONE of the cart's products, on a product the seller opened
     to affiliates. Only that line carries it; it never changes prices,
     the fee, or the buyer's total. */
  let affiliateCode: string | null = null;
  if (parsed.data.affiliateCode) {
    let matched: CheckoutLine | undefined;
    let lastReason = "That affiliate code isn't for anything in this cart.";
    for (const line of lines) {
      const v = await validateAffiliateCodeForProduct({
        code: parsed.data.affiliateCode, surface: "shop_product", productId: line.productId,
      });
      if (v.ok) { matched = line; affiliateCode = v.code.code; break; }
      lastReason = v.reason;
    }
    if (!matched || !affiliateCode) {
      res.status(400).json({ error: "BAD_AFFILIATE_CODE", message: lastReason });
      return;
    }
    matched.affiliateCode = affiliateCode;
  }
  /* Order bumps (feature #13): every ticked add-on is re-resolved and
     re-priced from the seller's setting HERE. A tick for a product
     that isn't in the cart, or with no live offer, refuses the whole
     checkout — no rows, no session, no charge. The shop discount code
     never discounts a bump line (the bump carries its own seller-set
     % off — the storefront rail's rule). One bump line per add-on
     product, however many cart products offer it. */
  const bumpLines: CheckoutLine[] = [];
  {
    const seenTargets = new Set<string>();
    for (const mainId of [...new Set(parsed.data.includeBumps ?? [])]) {
      if (!wanted.has(mainId)) {
        res.status(400).json({ error: "BUMP_NOT_IN_CART", message: "That add-on isn't part of this cart." });
        return;
      }
      const resolved = await resolveShopBumpForCheckout(mainId, shopId);
      if (!resolved.ok) {
        res.status(400).json({ error: resolved.code, message: resolved.message });
        return;
      }
      if (seenTargets.has(resolved.target.id)) continue;
      seenTargets.add(resolved.target.id);
      bumpLines.push({
        productId: resolved.target.id,
        name: resolved.target.name,
        unitCents: resolved.unitCents,
        listUnitCents: Number(resolved.target.price_cents),
        quantity: 1,
        gross: resolved.unitCents,
        fee: Math.round((resolved.unitCents * STOREFRONT_PLATFORM_FEE_BPS) / 10_000),
        saleId: randomUUID(),
        isBump: true,
        bumpFor: mainId,
      });
    }
  }
  const allLines = [...lines, ...bumpLines];

  const gross = allLines.reduce((s, l) => s + l.gross, 0);
  const listGross = allLines.reduce((s, l) => s + l.listUnitCents * l.quantity, 0);
  const fee = allLines.reduce((s, l) => s + l.fee, 0);
  const groupId = randomUUID();

  /* ── Gift-card tender: hold the card against this checkout group.
     The card must belong to THIS shop's owner (their creator profile
     is the issuing store); the hold settles in markMarketSalePaid —
     the one flip both verify and the webhook run. */
  let giftCardAppliedCents = 0;
  let giftReservationId: string | null = null;
  let giftCardLast4: string | null = null;
  if (parsed.data.giftCardCode) {
    if (!isGiftCardCodeShape(parsed.data.giftCardCode)) {
      res.status(400).json({ error: "BAD_GIFT_CARD", message: "That doesn't look like a gift-card code (BDV-XXXX-XXXX-XXXX-XXXX)." });
      return;
    }
    try {
      await releaseExpiredReservations();
      const card = await findCardByCode(parsed.data.giftCardCode);
      if (!card || card.status !== "active") {
        res.status(400).json({ error: "BAD_GIFT_CARD", message: "That gift card isn't active." });
        return;
      }
      const ownerRes = await db.execute(sql`
        SELECT user_id FROM creator_profiles WHERE id = ${String(card.profile_id)} LIMIT 1
      `);
      const ownerId = (ownerRes.rows[0] as Record<string, unknown> | undefined)?.["user_id"];
      if (!ownerId || String(ownerId) !== String(shop.user_id)) {
        res.status(400).json({ error: "WRONG_STORE", message: "That gift card is for a different store." });
        return;
      }
      const tender = tenderFor(Number(card.balance_cents) - Number(card.reserved_cents), gross);
      if (tender <= 0) {
        res.status(400).json({ error: "NO_BALANCE", message: "That gift card has no balance left to spend." });
        return;
      }
      const reservation = await reserveGiftCard({
        cardId: String(card.id), rail: "shops", ref: groupId, amountCents: tender,
      });
      if (!reservation) {
        res.status(409).json({ error: "GIFT_CARD_BUSY", message: "That gift card's balance is held by another checkout right now — try again in a moment." });
        return;
      }
      giftCardAppliedCents = tender;
      giftReservationId = String(reservation.id);
      giftCardLast4 = String(card.code_last4);
    } catch (err) {
      if (err instanceof GiftCardsUnavailable) {
        res.status(503).json({ error: "GIFT_CARDS_UNAVAILABLE", message: "Gift cards aren't live yet — check out without the code for now. Nothing was charged." });
        return;
      }
      throw err;
    }
  }
  const amountDueCents = gross - giftCardAppliedCents;
  const totals = {
    gross_cents: gross,
    list_gross_cents: listGross,
    discount_code: discountCode,
    percent_off: percentOff,
    platform_fee_cents: fee,
    platform_fee_pct: PLATFORM_FEE_PCT,
    seller_net_cents: gross - fee,
    gift_card_applied_cents: giftCardAppliedCents,
    gift_card_last4: giftCardLast4,
    amount_due_cents: amountDueCents,
    buyerEmail: buyerEmail || null,
  };
  const lineReceipts = allLines.map((l) => ({
    saleId: l.saleId, productId: l.productId, productName: l.name, quantity: l.quantity,
    unit_cents: l.unitCents, list_unit_cents: l.listUnitCents,
    gross_cents: l.gross, platform_fee_cents: l.fee, seller_net_cents: l.gross - l.fee,
    affiliate_code: l.affiliateCode,
    isBump: l.isBump === true,
    bumpForProductId: l.bumpFor ?? null,
  }));

  /* Free cart — OR a cart the gift card covers in full: no card
     payment exists to charge, so record the sale as paid right here,
     exactly once, with the honest payment status for each case. */
  if (gross <= 0 || amountDueCents <= 0) {
    const paidByGiftCard = gross > 0 && amountDueCents <= 0;
    for (const l of allLines) {
      await insertShopEventLine(l, shopId, shop.user_id, {
        eventType: "sale", paymentStatus: paidByGiftCard ? "gift_card" : "no_payment_required", paidNow: true,
        buyerEmail, groupId, discountCode: l.isBump ? null : discountCode,
      });
      /* Co-seller splits (#36): this line recorded as a sale right
         here, so its net divides right here (no-op without splits). */
      await recordShopEventSplitsSafely(l.saleId);
      /* A $0 line owes a $0 commission — recordAffiliateSale's
         zero-commission guard returns without a row, honestly. */
      if (l.affiliateCode) {
        await recordAffiliateSaleSafely({
          code: l.affiliateCode, surface: "shop_product", productId: l.productId,
          productTitle: l.name, orderRef: groupId, buyerEmail: buyerEmail || null,
          grossCents: l.gross, platformFeeCents: l.fee,
        });
      }
    }
    /* The sale is recorded right here, so a presented code's use is
       counted right here too (0190 redemption discipline). */
    if (discountCode) {
      await countShopDiscountUse(shopId, discountCode);
    }
    /* …and a gift-card hold settles right here too, against the group. */
    if (paidByGiftCard && giftReservationId) {
      const redeemed = await redeemReservation({ reservationId: giftReservationId, ref: groupId });
      if (!redeemed) {
        logger.error({ shopId, groupId, giftReservationId }, "[storefronts] gift-card redeem failed after free-path sale record — needs reconciliation");
      }
    }
    res.status(201).json({
      saleId: lines[0]!.saleId, saleIds: allLines.map((l) => l.saleId), groupId,
      status: "paid", paid: true, free: !paidByGiftCard, paidWithGiftCard: paidByGiftCard,
      paymentStatus: paidByGiftCard ? "gift_card" : "no_payment_required",
      productName: lines[0]!.name, quantity: allLines.reduce((s, l) => s + l.quantity, 0),
      lines: lineReceipts, ...totals,
      note: paidByGiftCard
        ? "Paid in full with your gift card — no card payment was taken. Whatever balance is left stays on the card."
        : "Free order — no payment was needed, and none was taken. It's yours.",
    });
    return;
  }

  /* Payments must be configured before any row is written, so a
     config failure never leaves a phantom pending order behind. */
  let stripe: ReturnType<typeof getCheckoutStripe>;
  try {
    stripe = getCheckoutStripe();
  } catch {
    if (giftReservationId) await releaseReservation(giftReservationId).catch(() => {});
    res.status(503).json({ error: "Payments are not configured yet." });
    return;
  }

  /* 1) Record the order as PENDING first (brief + house pattern).
        Bump lines record with the group, marked as add-on lines; the
        discount code rides cart lines only. */
  for (const l of allLines) {
    await insertShopEventLine(l, shopId, shop.user_id, {
      eventType: "pending_sale", paymentStatus: "pending", paidNow: false,
      buyerEmail, groupId, discountCode: l.isBump ? null : discountCode,
    });
  }

  /* 2) Open the hosted session for the cart total. Failure = honest
        error and the pending rows are removed (tip-jar's orphan rule):
        no session, no charge possible, no order pretending to exist. */
  let session: { id: string; url: string | null };
  try {
    const base = checkoutBaseUrl(req);
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      /* With a gift card in play the session charges only the amount
         still due, as one line — the shop_events rows still carry the
         full gross and the full 5% fee (tender is payment, not a
         markdown). Verify expects due, not gross, for these groups. */
      line_items: giftCardAppliedCents > 0
        ? [{
            price_data: {
              currency: "usd",
              unit_amount: amountDueCents,
              product_data: { name: `${shop.name} — order`, description: `Gift card applied: $${(giftCardAppliedCents / 100).toFixed(2)}` },
            },
            quantity: 1,
          }]
        : allLines.map((l) => ({
            price_data: {
              currency: "usd",
              unit_amount: l.unitCents,
              product_data: {
                name: l.isBump ? `${l.name} (add-on)` : l.name,
                description: shop.name,
              },
            },
            quantity: l.quantity,
          })),
      metadata: {
        type: "marketplace_shop_purchase",
        shop_id: shopId,
        checkout_group_id: groupId,
        sale_id: lines[0]!.saleId,
        discount_code: discountCode ?? "",
      },
      success_url: `${base}/shop/${shop.handle}?checkout=paid&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/shop/${shop.handle}?checkout=cancelled`,
    }, { idempotencyKey: `market-sale:${groupId}` });
    if (!session.url) throw new Error("Checkout session did not return a URL");
  } catch (err) {
    await db.execute(sql`DELETE FROM shop_events WHERE checkout_group_id = ${groupId} AND event_type = 'pending_sale'`).catch(() => {});
    /* The gift-card hold dies with the checkout — cents go back now,
       not at expiry. */
    if (giftReservationId) await releaseReservation(giftReservationId).catch(() => {});
    logger.error({ err, shopId, groupId }, "[storefronts] checkout session failed — pending order removed");
    res.status(502).json({ error: "Could not start checkout. Nothing was charged — try again." });
    return;
  }

  await db.execute(sql`
    UPDATE shop_events SET stripe_session_id = ${session.id}
    WHERE checkout_group_id = ${groupId} AND event_type = 'pending_sale'
  `);
  logger.info({ shopId, groupId, sessionId: session.id, gross }, "[storefronts] checkout session created (order pending)");
  res.status(201).json({
    saleId: lines[0]!.saleId, saleIds: allLines.map((l) => l.saleId), groupId,
    status: "pending_payment", paid: false, paymentStatus: "pending",
    sessionId: session.id,
    url: session.url, checkoutUrl: session.url,
    productName: lines[0]!.name, quantity: allLines.reduce((s, l) => s + l.quantity, 0),
    lines: lineReceipts, ...totals,
    testMode: isCheckoutTestMode(),
    note: "Your order is saved as pending — payment happens at the hosted checkout. It only counts as a sale once the payment confirms.",
  });
});

/* ── POST /api/storefronts/checkout/verify — confirm a payment ───────────
   The buyer is back from hosted checkout (or a stand is refreshing on
   focus): retrieve the session from Stripe, and only a PAID session
   whose total matches the pending order's server-computed gross flips
   the order to a sale — through the same guarded flip the webhook
   runs, so the two doors can never double-fulfil. The session id is
   the capability (shoutout/tip-jar pattern): no auth, but nothing is
   revealed beyond the order the session itself paid for. */
const checkoutVerifySchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

router.post("/storefronts/checkout/verify", publicApiLimiter, async (req, res) => {
  const parsed = checkoutVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const { sessionId } = parsed.data;
  const rows = await fetchMarketSaleBySession(sessionId);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found for that checkout session." });
    return;
  }
  if (marketSaleIsPaid(rows)) {
    const receipt = marketSaleReceipt(rows);
    /* The receipt itself carries status/paid — spreading it last is
       the whole shape; no duplicate literals. */
    res.json({ duplicate: true, sessionId, order: receipt, ...receipt });
    return;
  }
  let session;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this checkout session." });
    return;
  }
  if (session.metadata?.["type"] !== "marketplace_shop_purchase") {
    res.status(400).json({ error: "This session isn't a shop purchase." });
    return;
  }
  if (session.payment_status !== "paid") {
    const receipt = marketSaleReceipt(rows);
    res.json({ sessionId, order: receipt, ...receipt });
    return;
  }
  /* A gift-card group was charged only its amount DUE (gross minus
     tender) — the session total must match that, not the gross. The
     reservation (rail 'shops', ref = group) is the record; a missing
     table (pre-migration) simply means no tender existed. */
  let giftAppliedForGroup = 0;
  const groupIdForVerify = rows[0]?.checkout_group_id ? String(rows[0].checkout_group_id) : null;
  if (groupIdForVerify) {
    try {
      const reservation = await findReservation("shops", groupIdForVerify);
      if (reservation) giftAppliedForGroup = Number(reservation.amount_cents);
    } catch { /* no gift tables yet → no tender */ }
  }
  const expected = rows.reduce((s, r) => s + Number(r.amount_cents), 0) - giftAppliedForGroup;
  if ((session.amount_total ?? 0) !== expected) {
    logger.error({ sessionId, amountTotal: session.amount_total, expected }, "[storefronts] verify: paid amount does not match the order");
    res.status(400).json({ error: "The paid amount doesn't match this order." });
    return;
  }
  const { flipped, rows: after } = await markMarketSalePaid(sessionId);
  const receipt = marketSaleReceipt(after);
  logger.info({ sessionId, flipped }, "[storefronts] checkout verified — sale recorded");
  res.json({ duplicate: flipped === 0, sessionId, order: receipt, ...receipt });
});

/* ── GET /api/storefronts/checkout/status?sessionId= — DB truth, read-only ─
   What the server currently believes about an order, without asking
   Stripe: paid only when the flip has landed, pending (or expired)
   otherwise. A pending order NEVER reads as paid here. */
router.get("/storefronts/checkout/status", publicApiLimiter, async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "").trim();
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const rows = await fetchMarketSaleBySession(sessionId);
  if (rows.length === 0) {
    res.status(404).json({ error: "Order not found for that checkout session." });
    return;
  }
  const receipt = marketSaleReceipt(rows);
  res.json({ sessionId, ...receipt, order: receipt });
});

/* ════════════════════════════════════════════════════════════════════════
   IN-PERSON SELLING (POS mode) — Stack-100 #3, item #28.

   A POS mode inside My Shop: the seller taps products into a cart and
   either (a) shows the customer a QR code / payment link for the total —
   the customer pays on THEIR OWN phone through the same hosted Stripe
   Checkout rail as an online cart — or (b) records a cash sale.

   SCOPE HONESTY (hard rule): there is NO card reader and NO tap-to-pay
   here. Real card-present hardware is Stripe Terminal, a partnership
   step that is out of scope for this version. This is QR / payment-link
   in-person selling only, and the UI says exactly that.

   Card path discipline — deliberately identical to /storefronts/checkout:
   amounts are computed HERE from shop_products.price_cents (the client
   sends ids + quantities, never money); the order is recorded FIRST as
   shop_events 'pending_sale' rows (never counted as a sale); ONE hosted
   session covers the whole cart; the sale exists only when the paid
   flip (POST /storefronts/checkout/verify or the central webhook, both
   via lib/market-sale) confirms a paid session. The ruled flat-5% fee
   (STOREFRONT_PLATFORM_FEE_BPS) comes out of the seller's cut — the
   customer pays the listed price, exactly like an online sale, and the
   rows land in the same shop_events records.
   The in-person channel is marked, not disguised: the checkout group
   id carries the `pos_` prefix (group ids are opaque grouping keys
   everywhere they are consumed) and the Stripe session metadata
   carries channel='in_person_qr' alongside the usual
   type='marketplace_shop_purchase', so the existing verify/webhook
   flip handles POS sessions unchanged.
   Differences from the online rail, by design: the endpoint is
   seller-authenticated and owner-scoped (a POS cart can only ever
   contain the seller's own shop's products), and v1 takes no discount
   code at the till.

   Cash path: a cash sale never touches Stripe and the platform never
   holds the money, so NO platform fee is taken or recorded on it. It
   lands in the Money Tracker (money_entries) as income, category
   'merch_sales', source 'in_person_cash', one entry per cart line —
   honestly cash, never dressed up as a card sale, and deliberately
   NOT a shop_events sale row (those rows feed payout settlement for
   money the platform actually collected). */
export const POS_CHANNEL_QR = "in_person_qr";
export const POS_CASH_SOURCE = "in_person_cash";
export const POS_GROUP_PREFIX = "pos_";

const posItemsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99).default(1),
  })).min(1).max(50),
  /* Optional: the customer's email, used only to prefill the hosted
     checkout (Stripe emails the receipt). Never required at a till. */
  buyerEmail: z.string().trim().email().max(254).optional(),
});

interface PosLine {
  productId: string;
  name: string;
  unitCents: number;
  quantity: number;
  gross: number;
  fee: number;
  saleId: string;
}

/** Price a POS cart from the server's own product rows — shared by the
    QR/link checkout and the cash recorder so the two doors can never
    disagree about a price. Paused products refuse exactly like the
    online checkout refuses them (404 before anything is written). */
async function pricePosCart(
  shopId: string,
  items: Array<{ productId: string; quantity: number }>,
): Promise<{ ok: true; lines: PosLine[] } | { ok: false; status: number; error: string }> {
  const wanted = new Map<string, number>();
  for (const l of items) {
    wanted.set(l.productId, Math.min(99, (wanted.get(l.productId) ?? 0) + l.quantity));
  }
  const lines: PosLine[] = [];
  for (const [productId, quantity] of wanted) {
    const prod = await db.execute(sql`
      SELECT p.id, p.name, p.price_cents, p.status
      FROM shop_products p
      WHERE p.id = ${productId} AND p.shop_id = ${shopId}
      LIMIT 1
    `);
    const product = (prod.rows as unknown as Array<{ id: string; name: string; price_cents: number; status: string }>)[0];
    if (!product || product.status !== "active") {
      return { ok: false, status: 404, error: "Product not found." };
    }
    const unitCents = Number(product.price_cents);
    const gross = unitCents * quantity;
    lines.push({
      productId, name: product.name, unitCents, quantity, gross,
      fee: Math.round((gross * STOREFRONT_PLATFORM_FEE_BPS) / 10_000),
      saleId: randomUUID(),
    });
  }
  return { ok: true, lines };
}

function posTodayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ── POST /api/shops/:id/pos/checkout — QR / payment-link sale ────────────
   Seller-only. Mints ONE hosted Stripe Checkout session for the cart
   total on the existing marketplace rail and returns its URL — the
   frontend renders that URL as a QR code and a copyable payment link.
   The customer opens it on their own phone and pays with their card;
   nothing about the payment itself happens on the seller's device. */
router.post("/shops/:id/pos/checkout", publicApiLimiter, requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = posItemsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order." });
    return;
  }
  const buyerEmail = parsed.data.buyerEmail ?? "";

  const priced = await pricePosCart(shop.id, parsed.data.items);
  if (!priced.ok) {
    res.status(priced.status).json({ error: priced.error });
    return;
  }
  const lines = priced.lines;
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const fee = lines.reduce((s, l) => s + l.fee, 0);
  const groupId = `${POS_GROUP_PREFIX}${randomUUID()}`;
  const totals = {
    gross_cents: gross,
    platform_fee_cents: fee,
    platform_fee_pct: PLATFORM_FEE_PCT,
    seller_net_cents: gross - fee,
    channel: POS_CHANNEL_QR,
  };
  const lineReceipts = lines.map((l) => ({
    saleId: l.saleId, productId: l.productId, productName: l.name, quantity: l.quantity,
    unit_cents: l.unitCents, gross_cents: l.gross,
    platform_fee_cents: l.fee, seller_net_cents: l.gross - l.fee,
  }));

  /* Free cart: no card exists to charge — record the sale as paid with
     the honest no-payment status, exactly like the online rail. */
  if (gross <= 0) {
    for (const l of lines) {
      await db.execute(sql`
        INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, payment_status, paid_at, quantity, checkout_group_id, discount_code)
        VALUES (${l.saleId}, ${shop.id}, ${shop.user_id}, 'sale', ${l.productId}, ${l.gross}, ${l.fee}, ${buyerEmail || null}, 'no_payment_required', now(), ${l.quantity}, ${groupId}, ${null})
      `);
      /* Co-seller splits (#36): recorded as a sale right here, so its
         net divides right here (a $0 line divides nothing). */
      await recordShopEventSplitsSafely(l.saleId);
    }
    res.status(201).json({
      saleId: lines[0]!.saleId, saleIds: lines.map((l) => l.saleId), groupId,
      status: "paid", paid: true, free: true, paymentStatus: "no_payment_required",
      lines: lineReceipts, ...totals,
      note: "Free items — no payment was needed, and none was taken. The sale is recorded.",
    });
    return;
  }

  /* Payments must be configured before any row is written, so a
     config failure never leaves a phantom pending order behind. */
  let stripe: ReturnType<typeof getCheckoutStripe>;
  try {
    stripe = getCheckoutStripe();
  } catch {
    res.status(503).json({ error: "Payments are not configured yet." });
    return;
  }

  /* 1) Record the order as PENDING first (same discipline as online). */
  for (const l of lines) {
    await db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, payment_status, quantity, checkout_group_id, discount_code)
      VALUES (${l.saleId}, ${shop.id}, ${shop.user_id}, 'pending_sale', ${l.productId}, ${l.gross}, ${l.fee}, ${buyerEmail || null}, 'pending', ${l.quantity}, ${groupId}, ${null})
    `);
  }

  /* 2) Open the hosted session for the cart total. Failure = honest
        error and the pending rows are removed (the online rail's
        orphan rule): no session, no charge possible, no order. */
  let session: { id: string; url: string | null };
  try {
    const base = checkoutBaseUrl(req);
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      line_items: lines.map((l) => ({
        price_data: {
          currency: "usd",
          unit_amount: l.unitCents,
          product_data: { name: l.name, description: shop.name },
        },
        quantity: l.quantity,
      })),
      metadata: {
        type: "marketplace_shop_purchase",
        shop_id: shop.id,
        checkout_group_id: groupId,
        sale_id: lines[0]!.saleId,
        channel: POS_CHANNEL_QR,
        discount_code: "",
      },
      success_url: `${base}/shop/${shop.handle}?checkout=paid&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/shop/${shop.handle}?checkout=cancelled`,
    }, { idempotencyKey: `market-sale:${groupId}` });
    if (!session.url) throw new Error("Checkout session did not return a URL");
  } catch (err) {
    await db.execute(sql`DELETE FROM shop_events WHERE checkout_group_id = ${groupId} AND event_type = 'pending_sale'`).catch(() => {});
    logger.error({ err, shopId: shop.id, groupId }, "[pos] checkout session failed — pending order removed");
    res.status(502).json({ error: "Could not start checkout. Nothing was charged — try again." });
    return;
  }

  await db.execute(sql`
    UPDATE shop_events SET stripe_session_id = ${session.id}
    WHERE checkout_group_id = ${groupId} AND event_type = 'pending_sale'
  `);
  logger.info({ shopId: shop.id, groupId, sessionId: session.id, gross }, "[pos] checkout session created (order pending)");
  res.status(201).json({
    saleId: lines[0]!.saleId, saleIds: lines.map((l) => l.saleId), groupId,
    status: "pending_payment", paid: false, paymentStatus: "pending",
    sessionId: session.id,
    url: session.url, checkoutUrl: session.url, paymentLink: session.url,
    lines: lineReceipts, ...totals,
    testMode: isCheckoutTestMode(),
    note: "Show the QR code or share the payment link — your customer pays on their own phone. This only counts as a sale once the payment confirms.",
  });
});

/* ── POST /api/shops/:id/pos/cash-sale — record an in-person cash sale ───
   Seller-only. The customer paid cash in hand: the platform never held
   the money, so no fee is taken. One Money Tracker income entry per
   cart line, source 'in_person_cash', so the sale shows in the money
   tracker as exactly what it was. A $0 line is a giveaway, not a cash
   sale, and refuses. */
router.post("/shops/:id/pos/cash-sale", publicApiLimiter, requireAuth, async (req, res) => {
  const shop = await getOwnedShop(param(req.params.id), req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = posItemsSchema.omit({ buyerEmail: true }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cash sale." });
    return;
  }
  const priced = await pricePosCart(shop.id, parsed.data.items);
  if (!priced.ok) {
    res.status(priced.status).json({ error: priced.error });
    return;
  }
  const lines = priced.lines;
  if (lines.some((l) => l.gross <= 0)) {
    res.status(400).json({ error: "Free products have nothing to record as a cash sale." });
    return;
  }
  const entryDate = posTodayYmd();
  const entries: Array<Record<string, unknown>> = [];
  try {
    for (const l of lines) {
      const note = `In-person cash sale — ${l.name} ×${l.quantity}`.slice(0, 280);
      const inserted = await db.execute(sql`
        INSERT INTO money_entries (id, user_id, entry_type, category, amount_cents, note, source, entry_date)
        VALUES (${randomUUID()}, ${req.userId!}, 'income', 'merch_sales', ${l.gross}, ${note}, ${POS_CASH_SOURCE}, ${entryDate})
        RETURNING id, amount_cents, category, source, entry_date
      `);
      const row = (inserted.rows as unknown as Array<Record<string, unknown>>)[0];
      if (row) entries.push({ ...row, productId: l.productId, productName: l.name, quantity: l.quantity });
    }
  } catch (err) {
    logger.error({ err, shopId: shop.id }, "[pos] cash sale record failed");
    res.status(500).json({ error: "Could not record the cash sale." });
    return;
  }
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  logger.info({ shopId: shop.id, gross, lines: lines.length }, "[pos] cash sale recorded to money tracker");
  res.status(201).json({
    recorded: true,
    channel: POS_CASH_SOURCE,
    entries,
    gross_cents: gross,
    platform_fee_cents: 0,
    seller_net_cents: gross,
    note: "Recorded in your Money Tracker as in-person cash. No platform fee on cash — the money is already in your hand.",
  });
});

/* ── POST /api/storefronts/:id/domain — attach a custom domain (Pro+) ────── */
const domainSchema = z.object({
  domain: z.string().trim().min(4).max(253),
});

router.post("/storefronts/:id/domain", publicApiLimiter, requireAuth, requireProTier, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const parsed = domainSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "A valid domain is required (e.g. shop.yourname.com)." });
    return;
  }
  const domain = normalizeDomain(parsed.data.domain);
  if (!domain) {
    res.status(400).json({ error: "That doesn't look like a valid domain." });
    return;
  }
  const clash = await db.execute(sql`
    SELECT id FROM shops WHERE custom_domain = ${domain} AND id != ${shop.id} LIMIT 1
  `);
  if ((clash.rows as unknown[]).length > 0) {
    res.status(409).json({ error: "That domain is already connected to another shop." });
    return;
  }
  const token = issueDomainToken();
  await db.execute(sql`
    UPDATE shops
    SET custom_domain = ${domain},
        domain_verified = FALSE,
        domain_verification_token = ${token},
        updated_at = NOW()
    WHERE id = ${shop.id}
  `);
  res.json({
    domain,
    verified: false,
    verification: {
      type: "TXT",
      host: `${VERIFY_HOST_PREFIX}.${domain}`,
      value: token,
    },
    dns: {
      step1: `Add a TXT record at host "${VERIFY_HOST_PREFIX}" with the value above in your DNS provider (Cloudflare, GoDaddy, Namecheap…).`,
      step2: `Add a CNAME record: host "@" (or "shop") → cname.bowdownvisuals.com — this points your domain at your storefront.`,
      step3: `Come back here and hit "Verify domain". DNS can take a few minutes to propagate.`,
      cnameTarget: "cname.bowdownvisuals.com",
    },
  });
});

/* ── POST /api/storefronts/domain/verify — verify via DNS TXT ────────────── */
const verifySchema = z.object({
  shopId: z.string().uuid(),
});

router.post("/storefronts/domain/verify", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "shopId is required." });
    return;
  }
  const shop = await getOwnedShopFull(parsed.data.shopId, req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  const domain = shop.custom_domain as string | null;
  const token = shop.domain_verification_token as string | null;
  if (!domain || !token) {
    res.status(400).json({ error: "No domain is waiting for verification on this shop." });
    return;
  }
  const check = await checkDomainTxt(domain, token);
  if (check.ok) {
    await db.execute(sql`
      UPDATE shops SET domain_verified = TRUE, updated_at = NOW() WHERE id = ${shop.id}
    `);
    logger.info({ shopId: shop.id, domain }, "[storefronts] domain verified");
  }
  res.json({ domain, verified: check.ok, reason: check.reason });
});

/* ── DELETE /api/storefronts/:id/domain — detach (Pro+ not required) ─────── */
router.delete("/storefronts/:id/domain", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const shop = await getOwnedShopFull(id ?? "", req.userId!);
  if (!shop) {
    res.status(404).json({ error: "Shop not found." });
    return;
  }
  await db.execute(sql`
    UPDATE shops
    SET custom_domain = NULL, domain_verified = FALSE, domain_verification_token = NULL, updated_at = NOW()
    WHERE id = ${shop.id}
  `);
  res.json({ detached: true });
});


export default router;
