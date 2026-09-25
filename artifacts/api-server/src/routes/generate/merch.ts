import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { db, merchDesignsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  MERCH_DESIGN_CREDIT_COST,
  MERCH_COMMISSION_PCT,
  MERCH_BATCH_SIZE,
  MERCH_PRODUCTS,
  isMerchProductKey,
  isMerchStyleKey,
  buildMerchPrompt,
  calculateMerchMargin,
  suggestRetailPrice,
  type MerchProductKey,
  type MerchStyleKey,
} from "./merch-pricing";

const router = Router();

const DESIGN_CREDITS = Number(process.env["MERCH_DESIGN_CREDIT_COST"]) || MERCH_DESIGN_CREDIT_COST;
const COMMISSION_PCT = Number(process.env["MERCH_COMMISSION_PCT"]) || MERCH_COMMISSION_PCT;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5-sunburst";

/** Supabase Storage bucket for merch mockups. */
const MERCH_BUCKET = "generated-clips";

async function uploadMockup(userId: string, buffer: Buffer): Promise<{ url: string; path: string }> {
  const filePath = `merch/${userId}/${randomUUID()}.png`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(MERCH_BUCKET)
    .upload(filePath, buffer, { contentType: "image/png", upsert: false });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = getSupabaseAdmin().storage
    .from(MERCH_BUCKET)
    .getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/merch/design
   AI design batch: 2 product mockups for one product + style + description.
   1. Validate. 2. Charge 3 credits up front (402 when broke).
   3. Generate mockups. 4. On ANY failure → auto-refund, no charge stands.
───────────────────────────────────────────────────────────────────────────── */
const DesignBody = z.object({
  product: z.string(),
  style: z.string(),
  description: z.string().max(500).optional().default(""),
  title: z.string().max(80).optional().default(""),
});

router.post("/merch/design", requireAuth, async (req, res) => {
  const parsed = DesignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { product, style, description, title } = parsed.data;
  if (!isMerchProductKey(product)) {
    res.status(400).json({ error: `product must be one of: t-shirt, hoodie, cap, poster` });
    return;
  }
  if (!isMerchStyleKey(style)) {
    res.status(400).json({ error: `style must be one of: streetwear, minimal, vintage, luxury-gold` });
    return;
  }

  /* ── Charge before generate — always enforced ── */
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, DESIGN_CREDITS, { action: "Merch Design Batch" });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough credits. Please buy more credits to continue." });
      return;
    }
    if (chargeErr instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no credits were charged." });
      return;
    }
    throw chargeErr;
  }

  const fail = async (msg: string, logMsg: string) => {
    req.log.error({ userId: req.userId }, logMsg);
    try {
      await refundCredits(req.userId!, DESIGN_CREDITS, { action: "Merch Design Batch — Refund (generation failed)" });
    } catch (refundErr) {
      req.log.error({ err: refundErr, userId: req.userId }, "[merch] REFUND FAILED after generation failure");
    }
    res.status(500).json({ error: msg });
  };

  /* ── Generate the batch: real GPT Image calls, one per mockup ── */
  try {
    const mockups: Array<{ url: string; path: string }> = [];
    for (let i = 0; i < MERCH_BATCH_SIZE; i++) {
      const prompt = buildMerchPrompt(product as MerchProductKey, style as MerchStyleKey, description, i);
      req.log.info({ userId: req.userId, variant: i + 1 }, "[merch] mockup generation started");
      const imageResp = await getOpenAI().images.generate({
        model: IMAGE_MODEL,
        prompt: prompt.slice(0, 4000),
        size: "1024x1024",
        quality: "high",
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) {
        await fail("Image generation returned no image data.", "[merch] generation returned empty — refunding");
        return;
      }
      mockups.push(await uploadMockup(req.userId!, Buffer.from(b64, "base64")));
    }

    const baseCostCents = MERCH_PRODUCTS[product as MerchProductKey].baseCostCents;
    req.log.info({ userId: req.userId, creditsAfter }, "[merch] design batch complete");
    res.json({
      status: "succeeded",
      mockups,
      product,
      style,
      title: title || `${MERCH_PRODUCTS[product as MerchProductKey].label} Design`,
      baseCostCents,
      suggestedPriceCents: suggestRetailPrice(baseCostCents, COMMISSION_PCT),
      commissionPct: COMMISSION_PCT,
      creditCost: DESIGN_CREDITS,
      creditsRemaining: creditsAfter,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Merch design generation failed";
    await fail(msg, "[merch] generation failed — refunding");
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/merch/designs — list my designs (free)
───────────────────────────────────────────────────────────────────────────── */
router.get("/merch/designs", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(merchDesignsTable)
    .where(eq(merchDesignsTable.user_id, req.userId!))
    .orderBy(desc(merchDesignsTable.created_at));
  res.json({
    designs: rows.map((r) => ({
      ...r,
      margin: r.price_cents != null
        ? calculateMerchMargin(r.price_cents, r.base_cost_cents, COMMISSION_PCT)
        : null,
    })),
    commissionPct: COMMISSION_PCT,
    paymentsLive: false,
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/merch/designs — save/list a design (free)
───────────────────────────────────────────────────────────────────────────── */
const SaveBody = z.object({
  title: z.string().min(1).max(80),
  product: z.string(),
  style: z.string(),
  prompt: z.string().max(500).optional().default(""),
  imageUrl: z.string().url().max(2000),
  imagePath: z.string().max(500).optional(),
  priceCents: z.number().int().min(0).max(1000000).optional(),
  status: z.enum(["draft", "listed"]).optional().default("draft"),
});

router.post("/merch/designs", requireAuth, async (req, res) => {
  const parsed = SaveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid design data" });
    return;
  }
  const d = parsed.data;
  if (!isMerchProductKey(d.product) || !isMerchStyleKey(d.style)) {
    res.status(400).json({ error: "Invalid product or style" });
    return;
  }
  const [row] = await db
    .insert(merchDesignsTable)
    .values({
      user_id: req.userId!,
      title: d.title,
      product: d.product,
      style: d.style,
      prompt: d.prompt || null,
      image_url: d.imageUrl,
      image_path: d.imagePath ?? null,
      price_cents: d.priceCents ?? null,
      base_cost_cents: MERCH_PRODUCTS[d.product as MerchProductKey].baseCostCents,
      status: d.status,
      payments_live: false,
    })
    .returning({ id: merchDesignsTable.id });
  res.status(201).json({ id: row?.id });
});

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/merch/designs/:id — update price/title/status (owner only, free)
───────────────────────────────────────────────────────────────────────────── */
const PatchBody = z.object({
  title: z.string().min(1).max(80).optional(),
  priceCents: z.number().int().min(0).max(1000000).nullable().optional(),
  status: z.enum(["draft", "listed"]).optional(),
});

router.patch("/merch/designs/:id", requireAuth, async (req, res) => {
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update data" });
    return;
  }
  const { id } = req.params as { id: string };
  const existing = await db
    .select()
    .from(merchDesignsTable)
    .where(and(eq(merchDesignsTable.id, id), eq(merchDesignsTable.user_id, req.userId!)))
    .limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: "Design not found" });
    return;
  }
  const updates: Partial<{ title: string; price_cents: number | null; status: string }> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.priceCents !== undefined) updates.price_cents = parsed.data.priceCents;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  await db
    .update(merchDesignsTable)
    .set({ ...updates, updated_at: new Date() })
    .where(eq(merchDesignsTable.id, id));
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /api/merch/designs/:id — remove a design (owner only, free)
───────────────────────────────────────────────────────────────────────────── */
router.delete("/merch/designs/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const deleted = await db
    .delete(merchDesignsTable)
    .where(and(eq(merchDesignsTable.id, id), eq(merchDesignsTable.user_id, req.userId!)))
    .returning({ id: merchDesignsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Design not found" });
    return;
  }
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/merch/designs/:id/order — order intent (HONEST "coming soon").
   Records interest but NEVER charges, NEVER creates a payment. Dropship
   fulfillment ships when payments go live.
───────────────────────────────────────────────────────────────────────────── */
router.post("/merch/designs/:id/order", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const existing = await db
    .select()
    .from(merchDesignsTable)
    .where(eq(merchDesignsTable.id, id))
    .limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: "Design not found" });
    return;
  }
  req.log.info({ userId: req.userId, designId: id }, "[merch] order intent recorded (checkout coming soon)");
  res.json({
    status: "coming_soon",
    message: "Checkout is coming soon. Your interest has been noted — we'll notify you when ordering goes live. No charge was made.",
    paymentsLive: false,
  });
});

export default router;
