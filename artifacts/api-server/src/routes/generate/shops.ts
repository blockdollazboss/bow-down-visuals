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
import { randomUUID } from "crypto";
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
import { ensureShopProductsBucket, SHOP_PRODUCTS_BUCKET } from "../../lib/objectStorage";
import { db } from "@workspace/db";
import { requireProTier } from "./storefronts";
import { sql } from "drizzle-orm";

const router = Router();

/* ── Pricing — env-overridable without a deploy ─────────────────────────── */
export const SHOP_AI_CREDIT_COST = Number(process.env["SHOP_AI_CREDIT_COST"]) || 1;
export const SHOP_IMAGE_STANDARD_CREDITS =
  Number(process.env["SHOP_IMAGE_STANDARD_CREDITS"]) || 1;
export const SHOP_IMAGE_PREMIUM_CREDITS =
  Number(process.env["SHOP_IMAGE_PREMIUM_CREDITS"]) || 2;

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
  return rows[0] ?? null;
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
    shops: (result.rows as unknown as Array<{ id: string }>).map((s) => ({
      ...s,
      product_count: byShop.get(s.id) ?? 0,
    })),
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
  await db.execute(sql`
    UPDATE shops SET
      name = COALESCE(${d.name ?? null}, name),
      tagline = COALESCE(${d.tagline ?? null}, tagline),
      description = COALESCE(${d.description ?? null}, description),
      banner_color = COALESCE(${d.banner_color ?? null}, banner_color),
      accent_color = COALESCE(${d.accent_color ?? null}, accent_color),
      banner_image_url = COALESCE(${d.banner_image_url ?? null}, banner_image_url),
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
  res.json({ shop, products: productsResult.rows });
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
  await db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, description, image_url)
    VALUES (${id}, ${shop.id}, ${req.userId!},
            ${parsed.data.name.trim()}, ${parsed.data.price_cents},
            ${parsed.data.description}, ${parsed.data.image_url || null})
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path, created_at, updated_at
    FROM shop_products WHERE id = ${id} LIMIT 1
  `);
  res.status(201).json({ product: (result.rows as unknown as ProductRow[])[0] });
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
  await db.execute(sql`
    UPDATE shop_products SET
      name = COALESCE(${d.name ?? null}, name),
      price_cents = COALESCE(${d.price_cents ?? null}, price_cents),
      description = COALESCE(${d.description ?? null}, description),
      image_url = COALESCE(${d.image_url ?? null}, image_url),
      updated_at = NOW()
    WHERE id = ${param(req.params.productId)}
  `);
  const result = await db.execute(sql`
    SELECT id, shop_id, user_id, name, price_cents, description, image_url, image_path, created_at, updated_at
    FROM shop_products WHERE id = ${param(req.params.productId)} LIMIT 1
  `);
  res.json({ product: (result.rows as unknown as ProductRow[])[0] });
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
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to use the AI shop writer." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Shop Description" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to use the AI shop writer." });
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
    res.status(502).json({ error: "The studio hiccupped — your credit was refunded. Try again." });
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
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to use the AI product writer." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SHOP_AI_CREDIT_COST, { action: "AI Product Description" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to use the AI product writer." });
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
    res.status(502).json({ error: "The studio hiccupped — your credit was refunded. Try again." });
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
    res.status(402).json({ error: "out_of_credits", message: "Not enough credits for this product image." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, creditCost, {
      action: `AI Product Image (${parsed.data.tier})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough credits for this product image." });
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

    /* Self-healing bucket: verify/create BEFORE the upload, never assume it
       exists. Throws loudly on failure → credit is refunded by the catch. */
    await ensureShopProductsBucket();

    const filePath = `${req.userId!}/products/${randomUUID()}.png`;
    const { error: upErr } = await getSupabaseAdmin().storage
      .from(SHOP_PRODUCTS_BUCKET)
      .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = getSupabaseAdmin().storage
      .from(SHOP_PRODUCTS_BUCKET)
      .getPublicUrl(filePath);

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
    logger.error({ err: msg }, "[shops] product-image generation failed — credit refunded");
    res.status(502).json({ error: `${msg} Your credit was refunded.` });
  }
});

export default router;
