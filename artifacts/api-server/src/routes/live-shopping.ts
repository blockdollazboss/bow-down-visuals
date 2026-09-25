import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  liveShopProductsTable,
  liveShopStreamsTable,
  liveShopSalesTable,
  liveShopAlertsTable,
  platformFeeCents,
  LIVE_SHOPPING_FEE_BPS,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

/* ── Live Shopping (v1) ──────────────────────────────────────────────────
   Creators sell products during live streams: product catalog, selling
   sessions with a pinned overlay product, recorded sales with a 5% platform
   fee, and a purchase-alert feed the overlay polls for popups.

   Pricing (standing rule: pure interface is free):
   - Catalog / streams / overlay / dashboard: FREE (no AI, no compute burn).
   - The business model is the 5% transaction fee on platform sales.
   - One paid AI endpoint: POST /live-shopping/ai-description — 1 credit for
     an AI-written product description, charged BEFORE the model call and
     refunded if the provider fails (same pattern as hook-studio).

   Honest v1 boundaries (never fake a transaction):
   - Platform checkout does NOT exist yet: product "buy" buttons open the
     creator's own `external_url` in a new tab, and the UI labels it.
   - POST /live-shopping/sales and /streams/:id/alerts record TEST sales —
     every response and the dashboard label them as test sales until
     platform checkout ships.
   - Ownership is enforced on every row: users can only touch their own.

   Endpoints (all authed):
   GET    /live-shopping/catalog             → { products, fee_bps } (free)
   POST   /live-shopping/products            → create product (free)
   PATCH  /live-shopping/products/:id        → update own product (free)
   DELETE /live-shopping/products/:id        → delete own product (free)
   GET    /live-shopping/streams             → own streams, newest first (free)
   POST   /live-shopping/streams             → start a selling session (free)
   PATCH  /live-shopping/streams/:id         → { status?, pinned_product_id? } (free)
   POST   /live-shopping/streams/:id/alerts  → record TEST purchase alert (free)
   GET    /live-shopping/streams/:id/alerts  → alert feed for the overlay (free)
   POST   /live-shopping/sales               → record TEST sale (free)
   GET    /live-shopping/dashboard           → revenue per stream (free)
   POST   /live-shopping/ai-description      → AI product description (1 credit) */

const router = Router();

export const AI_DESCRIPTION_CREDIT_COST =
  Number(process.env["LIVE_SHOPPING_AI_DESC_CREDITS"]) || 1;

export const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120),
  price_cents: z.number().int().min(0).max(10_000_000),
  image_url: z.string().url().max(2048).optional().or(z.literal("")),
  external_url: z.string().url().max(2048).optional().or(z.literal("")),
  description: z.string().max(2000).optional(),
  is_active: z.boolean().optional(),
});

export const productUpdateSchema = productSchema.partial();

export const streamSchema = z.object({
  title: z.string().trim().min(1, "Stream title is required").max(160),
});

export const streamUpdateSchema = z.object({
  status: z.enum(["scheduled", "live", "ended"]).optional(),
  pinned_product_id: z.string().uuid().nullable().optional(),
});

export const alertSchema = z.object({
  product_id: z.string().uuid(),
  buyer_name: z.string().trim().max(80).default("A viewer"),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const saleSchema = z.object({
  product_id: z.string().uuid(),
  stream_id: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const aiDescriptionSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120),
  selling_points: z.string().trim().max(1000).optional(),
});

/** Format cents as a human price string, e.g. 2499 → "$24.99". */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function serializeProduct(row: typeof liveShopProductsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    price_cents: row.price_cents,
    price: formatPrice(row.price_cents),
    image_url: row.image_url,
    external_url: row.external_url,
    description: row.description,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

/* ── Catalog ─────────────────────────────────────────────────────────── */

router.get("/live-shopping/catalog", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(liveShopProductsTable)
    .where(eq(liveShopProductsTable.user_id, req.userId!))
    .orderBy(desc(liveShopProductsTable.created_at));
  res.json({
    products: rows.map(serializeProduct),
    fee_bps: LIVE_SHOPPING_FEE_BPS,
    checkout_status: "coming_soon",
    note: "Platform checkout is coming soon — buy buttons link to your own checkout page, and sales recorded here are test sales.",
  });
});

router.post(
  "/live-shopping/products",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = productSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid product.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const [row] = await db
      .insert(liveShopProductsTable)
      .values({
        user_id: req.userId!,
        name: parsed.data.name,
        price_cents: parsed.data.price_cents,
        image_url: parsed.data.image_url || null,
        external_url: parsed.data.external_url || null,
        description: parsed.data.description ?? null,
        is_active: parsed.data.is_active ?? true,
      })
      .returning();
    res.status(201).json({ product: serializeProduct(row!) });
  },
);

router.patch(
  "/live-shopping/products/:id",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = productUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid product update.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const existing = await db
      .select()
      .from(liveShopProductsTable)
      .where(
        and(
          eq(liveShopProductsTable.id, (req.params.id as string)),
          eq(liveShopProductsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    const updates: {
      name?: string;
      price_cents?: number;
      image_url?: string | null;
      external_url?: string | null;
      description?: string | null;
      is_active?: boolean;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.price_cents !== undefined) updates.price_cents = parsed.data.price_cents;
    if (parsed.data.image_url !== undefined) updates.image_url = parsed.data.image_url || null;
    if (parsed.data.external_url !== undefined) updates.external_url = parsed.data.external_url || null;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
    if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;
    const [row] = await db
      .update(liveShopProductsTable)
      .set(updates)
      .where(eq(liveShopProductsTable.id, (req.params.id as string)))
      .returning();
    res.json({ product: serializeProduct(row!) });
  },
);

router.delete(
  "/live-shopping/products/:id",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const deleted = await db
      .delete(liveShopProductsTable)
      .where(
        and(
          eq(liveShopProductsTable.id, (req.params.id as string)),
          eq(liveShopProductsTable.user_id, req.userId!),
        ),
      )
      .returning({ id: liveShopProductsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.json({ deleted: true });
  },
);

/* ── Streams (selling sessions) ──────────────────────────────────────── */

router.get("/live-shopping/streams", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(liveShopStreamsTable)
    .where(eq(liveShopStreamsTable.user_id, req.userId!))
    .orderBy(desc(liveShopStreamsTable.created_at));
  res.json({ streams: rows });
});

router.post(
  "/live-shopping/streams",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = streamSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid stream.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const [row] = await db
      .insert(liveShopStreamsTable)
      .values({
        user_id: req.userId!,
        title: parsed.data.title,
        status: "live",
        started_at: new Date(),
      })
      .returning();
    res.status(201).json({ stream: row });
  },
);

router.patch(
  "/live-shopping/streams/:id",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = streamUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid stream update.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const existing = await db
      .select()
      .from(liveShopStreamsTable)
      .where(
        and(
          eq(liveShopStreamsTable.id, (req.params.id as string)),
          eq(liveShopStreamsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      res.status(404).json({ error: "Stream not found." });
      return;
    }
    /* A pinned product must belong to the same user. */
    if (parsed.data.pinned_product_id) {
      const product = await db
        .select({ id: liveShopProductsTable.id })
        .from(liveShopProductsTable)
        .where(
          and(
            eq(liveShopProductsTable.id, parsed.data.pinned_product_id),
            eq(liveShopProductsTable.user_id, req.userId!),
          ),
        )
        .limit(1);
      if (product.length === 0) {
        res.status(400).json({ error: "Pinned product not found." });
        return;
      }
    }
    const updates: {
      status?: string;
      pinned_product_id?: string | null;
      ended_at?: Date;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
      if (parsed.data.status === "ended") updates.ended_at = new Date();
    }
    if (parsed.data.pinned_product_id !== undefined) {
      updates.pinned_product_id = parsed.data.pinned_product_id;
    }
    const [row] = await db
      .update(liveShopStreamsTable)
      .set(updates)
      .where(eq(liveShopStreamsTable.id, (req.params.id as string)))
      .returning();
    res.json({ stream: row });
  },
);

/* ── Purchase alerts (test alerts in v1) ─────────────────────────────── */

router.post(
  "/live-shopping/streams/:id/alerts",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const streamId = req.params.id as string;
    const stream = await db
      .select()
      .from(liveShopStreamsTable)
      .where(
        and(
          eq(liveShopStreamsTable.id, streamId),
          eq(liveShopStreamsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (stream.length === 0) {
      res.status(404).json({ error: "Stream not found." });
      return;
    }
    const parsed = alertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid alert.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const product = await db
      .select()
      .from(liveShopProductsTable)
      .where(
        and(
          eq(liveShopProductsTable.id, parsed.data.product_id),
          eq(liveShopProductsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (product.length === 0) {
      res.status(400).json({ error: "Product not found." });
      return;
    }
    const totalCents = product[0]!.price_cents * parsed.data.quantity;
    const [alert] = await db
      .insert(liveShopAlertsTable)
      .values({
        user_id: req.userId!,
        stream_id: streamId,
        product_id: parsed.data.product_id,
        buyer_name: parsed.data.buyer_name,
        quantity: parsed.data.quantity,
        total_cents: totalCents,
      })
      .returning();
    res.status(201).json({
      alert,
      product_name: product[0]!.name,
      total: formatPrice(totalCents),
      test: true,
      note: "Test alert — platform checkout is coming soon; this is not a real purchase.",
    });
  },
);

router.get(
  "/live-shopping/streams/:id/alerts",
  requireAuth,
  async (req: Request, res: Response) => {
    const stream = await db
      .select({ id: liveShopStreamsTable.id })
      .from(liveShopStreamsTable)
      .where(
        and(
          eq(liveShopStreamsTable.id, (req.params.id as string)),
          eq(liveShopStreamsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (stream.length === 0) {
      res.status(404).json({ error: "Stream not found." });
      return;
    }
    const after = typeof req.query.after === "string" ? req.query.after : null;
    const alerts = await db
      .select()
      .from(liveShopAlertsTable)
      .where(eq(liveShopAlertsTable.stream_id, (req.params.id as string)))
      .orderBy(desc(liveShopAlertsTable.created_at))
      .limit(50);
    res.json({
      alerts: (after ? alerts.filter((a) => a.created_at > new Date(after)) : alerts).map((a) => ({
        ...a,
        total: formatPrice(a.total_cents),
      })),
    });
  },
);

/* ── Sales (test sales in v1) + dashboard ────────────────────────────── */

router.post(
  "/live-shopping/sales",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = saleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid sale.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const product = await db
      .select()
      .from(liveShopProductsTable)
      .where(
        and(
          eq(liveShopProductsTable.id, parsed.data.product_id),
          eq(liveShopProductsTable.user_id, req.userId!),
        ),
      )
      .limit(1);
    if (product.length === 0) {
      res.status(400).json({ error: "Product not found." });
      return;
    }
    if (parsed.data.stream_id) {
      const stream = await db
        .select({ id: liveShopStreamsTable.id })
        .from(liveShopStreamsTable)
        .where(
          and(
            eq(liveShopStreamsTable.id, parsed.data.stream_id),
            eq(liveShopStreamsTable.user_id, req.userId!),
          ),
        )
        .limit(1);
      if (stream.length === 0) {
        res.status(400).json({ error: "Stream not found." });
        return;
      }
    }
    const totalCents = product[0]!.price_cents * parsed.data.quantity;
    const feeCents = platformFeeCents(totalCents);
    const [sale] = await db
      .insert(liveShopSalesTable)
      .values({
        user_id: req.userId!,
        stream_id: parsed.data.stream_id ?? null,
        product_id: parsed.data.product_id,
        quantity: parsed.data.quantity,
        price_cents: product[0]!.price_cents,
        platform_fee_cents: feeCents,
      })
      .returning();
    res.status(201).json({
      sale,
      product_name: product[0]!.name,
      total: formatPrice(totalCents),
      platform_fee: formatPrice(feeCents),
      creator_payout: formatPrice(totalCents - feeCents),
      test: true,
      note: "Test sale — platform checkout is coming soon; this is not a real payment.",
    });
  },
);

router.get("/live-shopping/dashboard", requireAuth, async (req: Request, res: Response) => {
  const streams = await db
    .select()
    .from(liveShopStreamsTable)
    .where(eq(liveShopStreamsTable.user_id, req.userId!))
    .orderBy(desc(liveShopStreamsTable.created_at));
  const sales = await db
    .select()
    .from(liveShopSalesTable)
    .where(eq(liveShopSalesTable.user_id, req.userId!))
    .orderBy(desc(liveShopSalesTable.created_at));
  const byStream = new Map<string, { stream_id: string; title: string; sales: number; revenue_cents: number; fees_cents: number }>();
  for (const s of streams) {
    byStream.set(s.id, { stream_id: s.id, title: s.title, sales: 0, revenue_cents: 0, fees_cents: 0 });
  }
  let totalRevenue = 0;
  let totalFees = 0;
  for (const sale of sales) {
    const total = sale.price_cents * sale.quantity;
    totalRevenue += total;
    totalFees += sale.platform_fee_cents;
    if (sale.stream_id && byStream.has(sale.stream_id)) {
      const row = byStream.get(sale.stream_id)!;
      row.sales += 1;
      row.revenue_cents += total;
      row.fees_cents += sale.platform_fee_cents;
    }
  }
  res.json({
    totals: {
      sales: sales.length,
      revenue: formatPrice(totalRevenue),
      revenue_cents: totalRevenue,
      platform_fees: formatPrice(totalFees),
      platform_fees_cents: totalFees,
      creator_payout: formatPrice(totalRevenue - totalFees),
      fee_bps: LIVE_SHOPPING_FEE_BPS,
    },
    per_stream: [...byStream.values()].map((r) => ({
      ...r,
      revenue: formatPrice(r.revenue_cents),
      fees: formatPrice(r.fees_cents),
    })),
    test_data: true,
    note: "Sales recorded here are test sales — platform checkout is coming soon.",
  });
});

/* ── AI product description (1 credit, charged before the model call,
     refunded on provider failure — the standing rule for AI features) ── */

router.post(
  "/live-shopping/ai-description",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = aiDescriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const balance = req.userCredits ?? 0;
    if (balance < AI_DESCRIPTION_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate AI product descriptions.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, AI_DESCRIPTION_CREDIT_COST, {
        action: "Live Shopping — AI Product Description",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to generate AI product descriptions.",
        });
        return;
      }
      throw err;
    }
    const sellingPoints = parsed.data.selling_points?.trim();
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              "You are a direct-response copywriter for creators selling merch and products " +
              "during live streams. Write a punchy, hype product description (2-4 short lines, " +
              "under 60 words) that creates urgency and sounds natural when read aloud on stream. " +
              "No corporate speak, no false claims, no emojis spam — one emoji max. " +
              "Return ONLY JSON: {\"description\": \"...\"}.",
          },
          {
            role: "user",
            content:
              `Product: "${parsed.data.name}".` +
              (sellingPoints ? ` Selling points: "${sellingPoints}".` : ""),
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 300,
        temperature: 0.8,
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      let description = "";
      try {
        const parsedJson = JSON.parse(raw) as { description?: unknown };
        if (typeof parsedJson.description === "string" && parsedJson.description.trim()) {
          description = parsedJson.description.trim().slice(0, 600);
        }
      } catch {
        /* fall through to the empty check */
      }
      if (!description) {
        throw new Error("Model returned no usable description");
      }
      res.json({ description, creditsUsed: AI_DESCRIPTION_CREDIT_COST, creditsRemaining });
    } catch (err) {
      /* Provider failed — refund the charge so failures are free. */
      logger.error({ err, userId: req.userId }, "[live-shopping] AI description failed — refunding");
      await refundCredits(req.userId!, AI_DESCRIPTION_CREDIT_COST, {
        action: "Live Shopping — AI Product Description — Refund (provider failed)",
      });
      res.status(500).json({ error: "AI description failed — your credit was refunded." });
    }
  },
);

export default router;
