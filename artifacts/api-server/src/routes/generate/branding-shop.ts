import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import RunwayML from "@runwayml/sdk";
import Stripe from "stripe";
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
import {
  fulfillmentMode,
  toOrderStatus,
  type FulfillmentStatus,
} from "../../lib/printful";
import {
  fulfillBrandingOrder,
  refreshBrandingOrder,
  markBrandingOrderPaid,
  confirmBrandingFulfillment,
} from "../../lib/branding-fulfillment";

const router = Router();

/* ─── AI Branding Shop ────────────────────────────────────────────────────
   Dropship branding store: AI designs the brand kit (logo + product
   mockups via Runway gen4_image), the shop sells merch at retail in USD
   (Stripe checkout), and Printful manufactures + ships direct — Bow Down
   Visuals never touches inventory.

   MONEY RULES:
   - Catalog retail prices hold 40-60% margins over baseCostCents (internal;
     base costs never leave the server).
   - AI brand-kit design costs credits (2cr), charged BEFORE generation,
     refunded on ANY provider failure.
   - Browsing the catalog and viewing orders is FREE (pure UI).

   HONESTY (standing rule — never fabricate):
   - Fulfillment statuses come only from the provider. Without
     PRINTFUL_API_KEY the clearly-labeled mock sandbox simulates the flow;
     with the key, Printful's real API drives statuses. */

/* Product catalog — keep in sync with the frontend /branding-shop page.
   baseCostCents is server-only (margin internals). Margins:
   tee 60% · hoodie 56% · mug 59% · snapback 57% · poster 60% · case 57% · tote 58% */
const PRODUCTS = {
  tshirt:    { label: "Classic Tee",  priceCents: 2499, baseCostCents: 1000, sizes: ["S", "M", "L", "XL", "2XL"] },
  hoodie:    { label: "Luxury Hoodie", priceCents: 4999, baseCostCents: 2200, sizes: ["S", "M", "L", "XL", "2XL"] },
  mug:       { label: "Gold-Rim Mug", priceCents: 1699, baseCostCents: 700,  sizes: ["11oz"] },
  snapback:  { label: "Snapback Cap", priceCents: 2799, baseCostCents: 1200, sizes: ["One size"] },
  poster:    { label: "Art Poster",   priceCents: 1999, baseCostCents: 800,  sizes: ['12x18"', '18x24"'] },
  phonecase: { label: "Phone Case",   priceCents: 2299, baseCostCents: 1000, sizes: ["iPhone", "Samsung"] },
  tote:      { label: "Canvas Tote",  priceCents: 1899, baseCostCents: 800,  sizes: ["One size"] },
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

/* 2 credits per AI brand-kit design set (logo + up to 3 product mockups).
   The set burns one GPT-6 text call plus up to 4 Runway gen4_image
   generations — 2 credits holds a healthy margin at that provider cost.
   Env-overridable without a deploy. */
const DESIGN_CREDIT_COST = Number(process.env["BRANDING_SHOP_DESIGN_COST"]) || 2;

/* Server-side poll budget for the parallel Runway design tasks. */
const DESIGN_TIMEOUT_MS = Number(process.env["BRANDING_SHOP_DESIGN_TIMEOUT_MS"]) || 180_000;
const DESIGN_POLL_MS = 3_000;

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
  designUrl: z.string().url().max(2000).optional(),
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Submit one Runway gen4_image task, poll server-side until it completes,
   download the result, and re-host it in our Supabase bucket. Throws on
   failure or timeout — the caller refunds credits. */
async function runwayGenerateAndUpload(
  userId: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) throw new Error("RUNWAYML_API_SECRET is not configured on the server");
  const client = new RunwayML({ apiKey });

  const task = await client.textToImage.create({
    model: "gen4_image",
    promptText: prompt.slice(0, 1000),
    ratio: "1080:1080",
    contentModeration: { publicFigureThreshold: "low" },
  });

  const deadline = Date.now() + DESIGN_TIMEOUT_MS;
  let runwayUrl: string | null = null;
  for (;;) {
    await sleep(DESIGN_POLL_MS);
    const status = await client.tasks.retrieve(task.id);
    if (status.status === "SUCCEEDED") {
      runwayUrl = (status.output as string[] | undefined)?.[0] ?? null;
      break;
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      const failure = (status as { failure?: string }).failure ?? "image generation failed";
      throw new Error(`Runway task ${status.status.toLowerCase()}: ${failure}`);
    }
    if (Date.now() > deadline) {
      throw new Error("Design generation timed out — please try again");
    }
  }
  if (!runwayUrl) throw new Error("Image generation returned no image data");

  const dl = await fetch(runwayUrl, { signal: AbortSignal.timeout(120_000) });
  if (!dl.ok) throw new Error(`Design download failed (${dl.status})`);
  const buf = Buffer.from(await dl.arrayBuffer());

  const filePath = `${userId}/branding/${randomUUID()}.png`;
  const { error: upErr } = await getSupabaseAdmin()
    .storage.from(BRANDING_BUCKET)
    .upload(filePath, buf, { contentType: "image/png", upsert: false });
  if (upErr) throw upErr;
  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(BRANDING_BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/* ── POST /api/branding-shop/design — AI brand kit (PAID: 2 credits) ──────
   One GPT-6 text call produces the brand brief (logo prompt + per-product
   mockup prompts); then the logo + up to 3 mockups are generated with
   Runway gen4_image in PARALLEL (server-side polling). Credits are charged
   BEFORE generation and refunded on ANY provider failure — the user never
   pays for a kit they didn't get. */
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

  if (!process.env["RUNWAYML_API_SECRET"]) {
    res.status(500).json({ error: "Design generation is not configured on the server right now." });
    return;
  }

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

    /* Parallel: 1 logo + N mockups via Runway gen4_image. */
    const logoPromise = runwayGenerateAndUpload(
      req.userId!,
      `${brief.logoPrompt} Brand name: "${brandName}".`
    );
    const mockupPromises = products.map(async (p) => ({
      product: p,
      url: await runwayGenerateAndUpload(
        req.userId!,
        `${brief.mockupPrompts[p]} The applied logo reads "${brandName}".`
      ),
    }));
    const [logoUrl, mockups] = await Promise.all([logoPromise, Promise.all(mockupPromises)]);

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

/* ── POST /api/branding-shop/orders — place an order (FREE intake) ─────────
   Order intake only. Totals are recomputed server-side from the catalog —
   the client total is never trusted. The order is immediately submitted to
   fulfillment (Printful live, or the clearly-labeled mock sandbox) and the
   response carries the provider + honest fulfillment messaging. Payment is
   a separate step (POST /checkout) — nothing is charged here. */
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

  /* Submit to fulfillment (Printful live or mock sandbox). A fulfillment
     failure must not lose the order — it stays 'received' and can be
     retried via the refresh endpoint. */
  let fulfillment: { provider: string; providerOrderId: string; status: string } | null = null;
  try {
    fulfillment = await fulfillBrandingOrder(id);
  } catch (err) {
    logger.error({ err, orderId: id }, "[branding-shop] fulfillment submission failed — order kept as received");
  }

  const mode = fulfillmentMode();
  res.status(201).json({
    order: {
      id: row.id,
      status: fulfillment?.status ?? row.status,
      totalCents: row.total_cents,
      createdAt: row.created_at,
      provider: fulfillment?.provider ?? mode,
      providerOrderId: fulfillment?.providerOrderId ?? null,
      demo: mode === "mock",
    },
    message:
      mode === "mock"
        ? "Order received! Demo fulfillment is simulating the dropship flow — connect a Printful API key to ship real products. No payment has been taken."
        : "Order received and sent to our print partner! Pay at checkout and production begins. No payment has been taken yet.",
  });
});

function getBaseUrl(req: import("express").Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["host"];
  if (host) return `${proto}://${host}`;
  return "http://localhost";
}

/* ── POST /api/branding-shop/checkout — pay for an order (Stripe USD) ─────
   Creates a Stripe Checkout Session with retail-price line items (USD).
   Server recomputes the total from the catalog — the client total is never
   trusted. On success the Stripe webhook marks the order paid and confirms
   fulfillment. Without STRIPE_SECRET_KEY a clearly-labeled mock checkout
   completes the order instantly (demo mode). */
router.post("/branding-shop/checkout", publicApiLimiter, requireAuth, async (req, res) => {
  const { orderId } = (req.body ?? {}) as { orderId?: string };
  if (!orderId || typeof orderId !== "string") {
    res.status(400).json({ error: "orderId is required." });
    return;
  }

  const result = await db.execute(sql`
    SELECT id, user_id, items, total_cents, name, email, paid
    FROM branding_orders
    WHERE id = ${orderId} AND user_id = ${req.userId!}
    LIMIT 1
  `);
  const order = result.rows[0] as unknown as
    | {
        id: string;
        user_id: string;
        items: Array<{ product: ProductKey; size: string; color: string; qty: number; unitPriceCents: number }>;
        total_cents: number;
        name: string;
        email: string;
        paid: boolean;
      }
    | undefined;
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (order.paid) {
    res.status(400).json({ error: "This order is already paid." });
    return;
  }

  /* Recompute the total server-side and verify it matches the stored total. */
  let totalCents = 0;
  for (const item of order.items) {
    const product = PRODUCTS[item.product];
    if (!product) {
      res.status(400).json({ error: `Unknown product in order: ${item.product}.` });
      return;
    }
    totalCents += product.priceCents * item.qty;
  }
  if (totalCents !== order.total_cents || totalCents <= 0) {
    res.status(400).json({ error: "Order total mismatch — please place the order again." });
    return;
  }

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    /* Demo mode: no Stripe configured — complete instantly, clearly labeled. */
    await markBrandingOrderPaid(order.id, `mock_${randomUUID()}`);
    let fulfillment: { provider: string; providerOrderId: string; status: string } | null = null;
    try {
      fulfillment = await fulfillBrandingOrder(order.id);
      await confirmBrandingFulfillment(order.id);
    } catch (err) {
      logger.error({ err, orderId: order.id }, "[branding-shop] mock fulfillment failed");
    }
    res.json({
      mock: true,
      demo: true,
      orderId: order.id,
      status: fulfillment?.status ?? "received",
      message: "Demo checkout complete — no real payment was taken.",
    });
    return;
  }

  const stripe = new Stripe(stripeKey);
  const baseUrl = getBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    line_items: order.items.map((item) => {
      const product = PRODUCTS[item.product];
      return {
        price_data: {
          currency: "usd",
          unit_amount: product.priceCents,
          product_data: {
            name: `Bow Down Visuals — ${product.label}`,
            description: `${item.color} · ${item.size}`,
          },
        },
        quantity: item.qty,
      };
    }),
    metadata: {
      branding_order_id: order.id,
      user_id: req.userId!,
      kind: "branding_order",
    },
    success_url: `${baseUrl}/branding-shop?order=${order.id}&paid=1`,
    cancel_url: `${baseUrl}/branding-shop?order=${order.id}`,
  });

  await db.execute(sql`
    UPDATE branding_orders SET stripe_session_id = ${session.id} WHERE id = ${order.id}
  `);

  res.json({ checkoutUrl: session.url, orderId: order.id });
});

/* ── GET /api/branding-shop/orders — my orders (FREE) ───────────────────── */
router.get("/branding-shop/orders", requireAuth, async (req, res) => {
  const result = await db.execute(sql`
    SELECT id, items, total_cents, status, provider, provider_order_id,
           tracking_number, tracking_url, paid, created_at
    FROM branding_orders
    WHERE user_id = ${req.userId!}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json({
    demo: fulfillmentMode() === "mock",
    orders: (result.rows as unknown as Array<{
      id: string;
      items: unknown;
      total_cents: number;
      status: string;
      provider: string;
      provider_order_id: string | null;
      tracking_number: string | null;
      tracking_url: string | null;
      paid: boolean;
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      items: r.items,
      totalCents: r.total_cents,
      status: r.status,
      provider: r.provider,
      providerOrderId: r.provider_order_id,
      trackingNumber: r.tracking_number,
      trackingUrl: r.tracking_url,
      paid: r.paid,
      createdAt: r.created_at,
    })),
  });
});

/* ── POST /api/branding-shop/orders/:id/refresh — refresh status (FREE) ────
   Pulls the latest fulfillment state from the provider and persists it. */
router.post("/branding-shop/orders/:id/refresh", requireAuth, async (req, res) => {
  try {
    const refreshed = await refreshBrandingOrder(req.params.id as string, req.userId!);
    res.json({ orderId: req.params.id, ...refreshed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Refresh failed";
    res.status(msg === "Order not found" ? 404 : 502).json({ error: msg });
  }
});

/* ── POST /api/branding-shop/webhooks/printful — provider webhook ──────────
   Printful posts order events here (type + data). If
   PRINTFUL_WEBHOOK_SECRET is set, the shared secret must match
   (?secret= or x-printful-webhook-secret header); without it the endpoint
   is open but logs a warning (dev/mock use). */
router.post("/branding-shop/webhooks/printful", async (req, res) => {
  const expected = process.env["PRINTFUL_WEBHOOK_SECRET"];
  if (expected) {
    const got =
      (req.query["secret"] as string | undefined) ??
      (req.headers["x-printful-webhook-secret"] as string | undefined);
    if (got !== expected) {
      res.status(401).json({ error: "Invalid webhook secret." });
      return;
    }
  } else {
    logger.warn("[branding-shop] Printful webhook hit without PRINTFUL_WEBHOOK_SECRET set");
  }

  const { type, data } = (req.body ?? {}) as {
    type?: string;
    data?: { order?: { id?: number | string; status?: string }; shipment?: { tracking_number?: string; tracking_url?: string } };
  };
  const providerOrderId = data?.order?.id != null ? String(data.order.id) : null;
  if (!providerOrderId) {
    res.status(400).json({ error: "Missing order id in webhook payload." });
    return;
  }

  let status: FulfillmentStatus = "in_production";
  const t = (type ?? "").toLowerCase();
  if (t.includes("ship")) status = "shipped";
  else if (t.includes("deliver")) status = "delivered";
  else if (t.includes("fail")) status = "failed";
  else if (t.includes("cancel")) status = "canceled";
  else if (t.includes("draft") || t.includes("pending")) status = "pending";

  await db.execute(sql`
    UPDATE branding_orders
    SET status = ${toOrderStatus(status)},
        tracking_number = COALESCE(${data?.shipment?.tracking_number ?? null}, tracking_number),
        tracking_url = COALESCE(${data?.shipment?.tracking_url ?? null}, tracking_url)
    WHERE provider_order_id = ${providerOrderId}
  `);

  logger.info({ type, providerOrderId, status }, "[branding-shop] Printful webhook processed");
  res.json({ received: true });
});

export default router;

/* Re-exported for tests: catalog + pricing constants + schemas + statuses. */
const ORDER_STATUSES = [
  "received",
  "pending_fulfillment",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
  "failed",
] as const;
export { PRODUCTS, DESIGN_CREDIT_COST, designSchema, orderSchema, ORDER_STATUSES };
export type { ProductKey };
