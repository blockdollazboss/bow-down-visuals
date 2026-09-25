import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
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
  LedgerWriteError,
} from "../../lib/credits";
import { db } from "@workspace/db";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

const router = Router();

/* ─── AI Branding Shop ────────────────────────────────────────────────────
   Dropship branding store: AI designs the brand kit (logo + product
   mockups), the shop sells merch, manufacturers ship direct — Bow Down
   Visuals never touches inventory.

   v1 HONESTY CONTRACT (standing rule — never fabricate):
   - Order statuses are only "received" / "pending_fulfillment". There is no
     "shipped", no "delivered", no tracking number until a real dropship
     partner integration exists. The UI says "dropship partner integration
     coming soon" and orders are saved as received.
   - Browsing the catalog and placing orders is FREE (pure UI + order
     intake, no AI compute). Only the AI brand-kit design costs credits. */

/* Product catalog — keep in sync with the frontend /branding-shop page. */
const PRODUCTS = {
  tshirt: { label: "Classic Tee", priceCents: 2499, sizes: ["S", "M", "L", "XL", "2XL"] },
  hoodie: { label: "Luxury Hoodie", priceCents: 4999, sizes: ["S", "M", "L", "XL", "2XL"] },
  mug:    { label: "Gold-Rim Mug", priceCents: 1699, sizes: ["11oz"] },
  cap:    { label: "Snapback Cap", priceCents: 2799, sizes: ["One size"] },
  poster: { label: "Art Poster", priceCents: 1999, sizes: ['12x18"', '18x24"'] },
} as const;
type ProductKey = keyof typeof PRODUCTS;

const COLORS = ["black", "gold", "white"] as const;

const STYLES = ["luxury-gold", "streetwear", "minimal", "bold"] as const;
type BrandStyle = (typeof STYLES)[number];

const STYLE_DIRECTION: Record<BrandStyle, string> = {
  "luxury-gold": "opulent luxury — black and metallic gold, sharp serif letterforms, premium fashion-house energy",
  streetwear: "bold streetwear — heavy type, urban edge, high-contrast graphics",
  minimal: "clean minimal — lots of negative space, thin lines, one restrained mark",
  bold: "loud and maximal — vibrant color, big shapes, unmissable from across the room",
};

/* 2 credits per AI brand-kit design set (logo + up to 3 product mockups),
   following the logo-maker premium GPT Image tier (2cr). The set burns one
   GPT-6 text call plus up to 4 GPT Image generations — 2 credits holds a
   healthy margin at that provider cost. Env-overridable without a deploy. */
const DESIGN_CREDIT_COST = Number(process.env["BRANDING_SHOP_DESIGN_COST"]) || 2;

const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";
const BRANDING_BUCKET = "artist-references";

const designSchema = z.object({
  brandName: z.string().min(1, "Brand name is required.").max(80),
  niche: z.string().min(1, "Tell us your niche.").max(120),
  style: z.enum(STYLES),
  products: z
    .array(z.enum(Object.keys(PRODUCTS) as [ProductKey, ...ProductKey[]]))
    .min(1, "Pick at least one product.")
    .max(3, "Pick up to 3 products per design set."),
});

const orderItemSchema = z.object({
  product: z.enum(Object.keys(PRODUCTS) as [ProductKey, ...ProductKey[]]),
  color: z.enum(COLORS),
  size: z.string().min(1).max(20),
  qty: z.number().int().min(1).max(99),
});

const orderSchema = z.object({
  items: orderItemSchema.array().min(1, "Your cart is empty.").max(20),
  name: z.string().min(1, "Name is required.").max(120),
  email: z.string().email("Enter a valid email.").max(200),
  address: z.string().min(1, "Address is required.").max(300),
  city: z.string().min(1, "City is required.").max(120),
  state: z.string().min(1, "State is required.").max(120),
  zip: z.string().min(1, "ZIP is required.").max(30),
});

interface DesignBrief {
  logoPrompt: string;
  tagline: string;
  palette: string[];
  mockupPrompts: Record<string, string>;
}

function parseBrief(raw: string, products: ProductKey[]): DesignBrief | null {
  try {
    const j = JSON.parse(raw) as {
      logoPrompt?: unknown;
      tagline?: unknown;
      palette?: unknown;
      mockupPrompts?: unknown;
    };
    if (typeof j.logoPrompt !== "string" || !j.logoPrompt.trim()) return null;
    const mockupPrompts: Record<string, string> = {};
    const mp = j.mockupPrompts as Record<string, unknown> | undefined;
    for (const p of products) {
      const v = mp?.[p];
      if (typeof v === "string" && v.trim()) mockupPrompts[p] = v.trim().slice(0, 1000);
    }
    if (Object.keys(mockupPrompts).length === 0) return null;
    return {
      logoPrompt: j.logoPrompt.trim().slice(0, 1000),
      tagline: typeof j.tagline === "string" ? j.tagline.trim().slice(0, 200) : "",
      palette: Array.isArray(j.palette)
        ? j.palette.filter((c): c is string => typeof c === "string").slice(0, 3)
        : [],
      mockupPrompts,
    };
  } catch {
    return null;
  }
}

async function generateAndUpload(
  userId: string,
  prompt: string,
  size: "1024x1024" | "1024x1536"
): Promise<string> {
  const imageResp = await getOpenAI().images.generate({
    model: IMAGE_MODEL,
    prompt: prompt.slice(0, 4000),
    size,
    quality: "high",
    n: 1,
  });
  const b64 = imageResp.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image data");
  const filePath = `${userId}/branding/${randomUUID()}.png`;
  const { error: upErr } = await getSupabaseAdmin()
    .storage.from(BRANDING_BUCKET)
    .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
  if (upErr) throw upErr;
  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(BRANDING_BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/* ── POST /api/branding-shop/design — AI brand kit (PAID: 2 credits) ──────
   One GPT-6 text call produces the brand brief (logo prompt + per-product
   mockup prompts); then 1 logo + up to 3 mockup images are generated and
   stored. Credits are charged BEFORE generation and refunded on ANY provider
   failure — the user never pays for a kit they didn't get. */
router.post("/branding-shop/design", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = designSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid brand kit request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { brandName, niche, style, products } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < DESIGN_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to design your brand kit.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, DESIGN_CREDIT_COST, {
      action: "Branding Shop — AI Brand Kit",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to design your brand kit.",
      });
      return;
    }
    throw err;
  }

  try {
    const productList = products.map((p) => PRODUCTS[p].label).join(", ");
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a brand identity designer for independent creators. ` +
            `Design a merch-ready brand kit. Style direction: ${STYLE_DIRECTION[style]}. ` +
            `Write: (1) logoPrompt — a detailed text-to-image prompt for the brand logo ` +
            `(flat vector-style logo, centered, clean background, no photo, no mockup, ` +
            `no text artifacts beyond the brand name); (2) tagline — one short punchy ` +
            `tagline; (3) palette — exactly 3 hex colors; (4) mockupPrompts — one ` +
            `text-to-image prompt PER product below, each describing a premium product ` +
            `photography mockup with the brand logo applied to the product, studio ` +
            `lighting, e-commerce style. Return ONLY JSON: {"logoPrompt": "...", ` +
            `"tagline": "...", "palette": ["#...", "#...", "#..."], ` +
            `"mockupPrompts": {"${products[0]}": "..."${products
              .slice(1)
              .map((p) => `, "${p}": "..."`)
              .join("")}}}.`,
        },
        {
          role: "user",
          content:
            `Brand name: "${brandName}". Niche: "${niche}". ` +
            `Products to mock up: ${productList}.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.8,
    });

    const brief = parseBrief(completion.choices[0]?.message?.content ?? "{}", products);
    if (!brief) throw new Error("Model returned no usable brand brief");

    const logoUrl = await generateAndUpload(
      req.userId!,
      `${brief.logoPrompt} Brand name: "${brandName}".`,
      "1024x1024"
    );
    const mockups: Array<{ product: ProductKey; url: string }> = [];
    for (const p of products) {
      const url = await generateAndUpload(
        req.userId!,
        `${brief.mockupPrompts[p]} The applied logo reads "${brandName}".`,
        "1024x1024"
      );
      mockups.push({ product: p, url });
    }

    res.json({
      logo: { url: logoUrl },
      mockups,
      brief: { tagline: brief.tagline, palette: brief.palette },
      creditsUsed: DESIGN_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    /* Provider failure AFTER charge → refund, always. */
    try {
      await refundCredits(req.userId!, DESIGN_CREDIT_COST, {
        action: "Branding Shop — AI Brand Kit (refund: generation failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[branding-shop] design failed AND refund failed — manual reconciliation required"
      );
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[branding-shop] OpenAI rate limit / quota");
      res.status(503).json({ error: "The design studio is catching its breath — try again in a moment.", refunded: true });
      return;
    }
    if (err instanceof LedgerWriteError) throw err;
    logger.error({ err }, "[branding-shop] brand kit generation failed — credits refunded");
    res.status(502).json({ error: "The design studio hiccupped — your credits were refunded.", refunded: true });
  }
});

/* ── POST /api/branding-shop/orders — place an order (FREE) ───────────────
   Order intake only. Totals are recomputed server-side from the catalog —
   the client total is never trusted. Status is always "received"; the
   response carries the honest dropship-coming-soon message. */
router.post("/branding-shop/orders", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = orderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid order.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { items, name, email, address, city, state, zip } = parsed.data;

  /* Validate sizes against the catalog and recompute the total. */
  let totalCents = 0;
  for (const item of items) {
    const product = PRODUCTS[item.product];
    if (!(product.sizes as readonly string[]).includes(item.size)) {
      res.status(400).json({ error: `Invalid size "${item.size}" for ${product.label}.` });
      return;
    }
    totalCents += product.priceCents * item.qty;
  }

  const id = randomUUID();
  const itemsJson = JSON.stringify(
    items.map((i) => ({ ...i, unitPriceCents: PRODUCTS[i.product].priceCents }))
  );
  const result = await db.execute(sql`
    INSERT INTO branding_orders (id, user_id, items, total_cents, name, email, address, city, state, zip, status)
    VALUES (${id}, ${req.userId!}, ${itemsJson}::jsonb, ${totalCents}, ${name.trim()}, ${email.trim()}, ${address.trim()}, ${city.trim()}, ${state.trim()}, ${zip.trim()}, 'received')
    RETURNING id, status, total_cents, created_at
  `);
  const row = result.rows[0] as unknown as { id: string; status: string; total_cents: number; created_at: string };

  res.status(201).json({
    order: {
      id: row.id,
      status: row.status,
      totalCents: row.total_cents,
      createdAt: row.created_at,
    },
    message:
      "Order received! Our dropship partner integration is coming soon — your order is saved and we'll notify you the moment fulfillment goes live. No payment has been taken.",
  });
});

/* ── GET /api/branding-shop/orders — my orders (FREE) ──────────────────── */
router.get("/branding-shop/orders", requireAuth, async (req, res) => {
  const result = await db.execute(sql`
    SELECT id, items, total_cents, status, created_at
    FROM branding_orders
    WHERE user_id = ${req.userId!}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json({
    orders: (result.rows as unknown as Array<{
      id: string;
      items: unknown;
      total_cents: number;
      status: string;
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      items: r.items,
      totalCents: r.total_cents,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

export default router;

/* Re-exported for tests: catalog + pricing constants + schemas + statuses. */
const ORDER_STATUSES = ["received", "pending_fulfillment"] as const;
export { PRODUCTS, DESIGN_CREDIT_COST, designSchema, orderSchema, ORDER_STATUSES };
export type { ProductKey };
