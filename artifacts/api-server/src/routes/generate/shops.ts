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
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { SHOP_PRODUCTS_BUCKET, refreshSupabaseStorageUrl, refreshSupabaseStorageUrlsDeep, isStorageRef } from "../../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../../lib/mirrorMedia";

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
  return { ...row, image_url: source ? await refreshSupabaseStorageUrl(source) : row.image_url };
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
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price_cents: z.number().int().min(0).max(100_000_000).optional(),
  description: z.string().trim().max(2000).optional(),
  image_url: z.string().trim().max(2000).optional(),
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
  const productsResult = await db.execute(sql`
    SELECT id, name, price_cents, description, image_url, created_at
    FROM shop_products
    WHERE shop_id = ${shop.id}
    ORDER BY created_at ASC
    LIMIT 200
  `);
  res.json({
    shop: await presentShopRow(shop),
    products: await Promise.all(
      (productsResult.rows as unknown as Array<{ image_url: string | null; image_path: string | null }>).map(
        async (p) => ({ ...p, image_url: p.image_url ? await refreshSupabaseStorageUrl(p.image_url) : p.image_url }),
      ),
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
  const id = randomUUID();
  const storedImageUrl = parsed.data.image_url
    ? ((await mirrorExternalMediaUrl(parsed.data.image_url, { kind: "image", ownerKey: req.userId! })) ?? parsed.data.image_url)
    : null;
  await db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, description, image_url, image_path)
    VALUES (${id}, ${shop.id}, ${req.userId!},
            ${parsed.data.name.trim()}, ${parsed.data.price_cents},
            ${parsed.data.description}, ${storedImageUrl}, ${isStorageRef(storedImageUrl ?? "") ? storedImageUrl : null})
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path, created_at, updated_at
    FROM shop_products WHERE id = ${id} LIMIT 1
  `);
  const createdRow = (result.rows as unknown as ProductRow[])[0];
  res.status(201).json({ product: createdRow ? await presentShopProductRow(createdRow) : createdRow });
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
    SELECT id FROM shop_products WHERE id = ${param(req.params.productId)} AND shop_id = ${shop.id} LIMIT 1
  `);
  if ((existing.rows as unknown[]).length === 0) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const d = parsed.data;
  const storedImageUrl = d.image_url
    ? ((await mirrorExternalMediaUrl(d.image_url, { kind: "image", ownerKey: req.userId! })) ?? d.image_url)
    : null;
  await db.execute(sql`
    UPDATE shop_products SET
      name = COALESCE(${d.name ?? null}, name),
      price_cents = COALESCE(${d.price_cents ?? null}, price_cents),
      description = COALESCE(${d.description ?? null}, description),
      image_url = COALESCE(${storedImageUrl}, image_url),
      image_path = COALESCE(${isStorageRef(storedImageUrl ?? "") ? storedImageUrl : null}, image_path),
      updated_at = NOW()
    WHERE id = ${param(req.params.productId)}
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path, created_at, updated_at
    FROM shop_products WHERE id = ${param(req.params.productId)} LIMIT 1
  `);
  const updatedRow = (result.rows as unknown as ProductRow[])[0];
  res.json({ product: updatedRow ? await presentShopProductRow(updatedRow) : updatedRow });
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
  Number(process.env["STOREFRONT_PLATFORM_FEE_BPS"]) || 1000; // 1000 bps = 10%
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
           s.custom_domain, s.domain_verified, s.created_at,
           (SELECT COUNT(*)::int FROM shop_products p WHERE p.shop_id = s.id) AS product_count
    FROM shops s
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `);
  res.json({ shops: await refreshSupabaseStorageUrlsDeep(result.rows), platformFeePct: PLATFORM_FEE_PCT });
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
  const productsResult = await db.execute(sql`
    SELECT id, name, price_cents, description, image_url, created_at
    FROM shop_products
    WHERE shop_id = ${shop.id}
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const { user_id, ...publicShop } = shop;
  /* Fire-and-forget analytics — never blocks the page. */
  recordView(shop.id, user_id, req.ip);
  res.json(await refreshSupabaseStorageUrlsDeep({
    shop: publicShop,
    products: productsResult.rows,
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
           e.buyer_email, e.created_at
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.shop_id = ${shop.id} AND e.event_type = 'sale'
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
    },
    dailyViews: daily.rows,
    sales: sales.rows,
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

/* ── POST /api/storefronts/checkout — record a sale ────────────────────────
   Order capture (no card processing yet — Stripe Connect is the follow-up).
   The 10% platform fee comes out of the SELLER's cut; the buyer pays the
   listed price. All money math in integer cents. */
const checkoutSchema = z.object({
  shopId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
  buyerEmail: z.string().trim().email().max(254).optional().default(""),
});

router.post("/storefronts/checkout", publicApiLimiter, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order." });
    return;
  }
  const { shopId, productId, quantity, buyerEmail } = parsed.data;
  const prod = await db.execute(sql`
    SELECT p.id, p.shop_id, p.name, p.price_cents, s.user_id
    FROM shop_products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.id = ${productId} AND p.shop_id = ${shopId}
    LIMIT 1
  `);
  const rows = prod.rows as unknown as Array<{
    id: string; shop_id: string; name: string; price_cents: number; user_id: string;
  }>;
  const product = rows[0];
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const gross = product.price_cents * quantity;
  const fee = Math.round((gross * STOREFRONT_PLATFORM_FEE_BPS) / 10_000);
  const net = gross - fee;
  const saleId = randomUUID();
  await db.execute(sql`
    INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email)
    VALUES (${saleId}, ${shopId}, ${product.user_id}, 'sale', ${productId}, ${gross}, ${fee}, ${buyerEmail || null})
  `);
  res.status(201).json({
    saleId,
    productName: product.name,
    quantity,
    gross_cents: gross,
    platform_fee_cents: fee,
    platform_fee_pct: PLATFORM_FEE_PCT,
    seller_net_cents: net,
    buyerEmail: buyerEmail || null,
    note: "Order recorded. Card processing via Stripe Connect is coming soon — the seller follows up to complete payment.",
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
