/**
 * jewelry.ts — the Logo-to-Luxury studio API.
 *
 * One-stop pipeline: upload logo → AI preview → STL manufacturing file →
 * cost estimate → manufacturer guidance → NFC setup. Every step is served
 * here so the user never leaves the site to figure out the next step.
 *
 *   GET    /api/jewelry/status       pricing + options catalog (public)
 *   POST   /api/jewelry/design       AI preview render (2 credits, logo upload)
 *   POST   /api/jewelry/export-stl   STL manufacturing file (4 credits, logo upload)
 *   POST   /api/jewelry/estimate     cost estimate, deterministic (free)
 *   POST   /api/jewelry/consult      AI jewelry consultant chat (1 credit/msg)
 *   GET    /api/jewelry/guide        manufacturing guide (public)
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import multer from "multer";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  JEWELRY_PREVIEW_CREDIT_COST,
  JEWELRY_STL_CREDIT_COST,
  JEWELRY_CONSULT_CREDIT_COST,
  JEWELRY_PIECES,
  JEWELRY_METALS,
  JEWELRY_STONES,
  JEWELRY_STYLES,
  APPAREL_PRODUCTS,
  DECO_METHODS,
  DEFAULT_JEWELRY_OPTIONS,
  DEFAULT_APPAREL_OPTIONS,
  buildJewelryPrompt,
  buildApparelPrompt,
  estimateManufacturing,
  estimateStoneCount,
  estimateApparel,
  isJewelryPieceKey,
  isMetalKey,
  isStoneKey,
  isJewelryStyleKey,
  isApparelProductKey,
  isDecoMethodKey,
  JEWELRY_GUIDE,
  JEWELRY_CONSULTANT_SYSTEM_PROMPT,
  type JewelryDesignOptions,
  type ApparelDesignOptions,
} from "./jewelry-pricing";
import {
  decodePNG,
  logoToMask,
  buildPendantSTL,
  stlWeightGrams,
  PENDANT_DISC_R_MM,
} from "./jewelry-stl";

const router = Router();

const PREVIEW_CREDITS =
  Number(process.env["JEWELRY_PREVIEW_CREDIT_COST"]) || JEWELRY_PREVIEW_CREDIT_COST;
const STL_CREDITS =
  Number(process.env["JEWELRY_STL_CREDIT_COST"]) || JEWELRY_STL_CREDIT_COST;
const CONSULT_CREDITS =
  Number(process.env["JEWELRY_CONSULT_CREDIT_COST"]) || JEWELRY_CONSULT_CREDIT_COST;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5-sunburst";

const JEWELRY_BUCKET = "generated-clips";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      /\.(png|jpe?g|webp)$/i.test(file.originalname);
    cb(null, ok);
  },
});

async function uploadJewelryFile(
  userId: string,
  buffer: Buffer,
  ext: string,
  contentType: string,
): Promise<{ url: string; path: string }> {
  const filePath = `jewelry/${userId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await getSupabaseAdmin()
    .storage.from(JEWELRY_BUCKET)
    .upload(filePath, buffer, { contentType, upsert: false });
  if (upErr) throw upErr;
  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(JEWELRY_BUCKET).getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

function outOfCredits(res: any) {
  res.status(402).json({
    error: "out_of_credits",
    message: "Not enough credits. Please buy more credits to continue.",
  });
}

/* ─── GET /api/jewelry/status ───────────────────────────────────────────
   Public catalog: credit costs + available options for the studio UI. */
router.get("/jewelry/status", (_req, res) => {
  res.json({
    previewCreditCost: PREVIEW_CREDITS,
    stlCreditCost: STL_CREDITS,
    consultCreditCost: CONSULT_CREDITS,
    pieces: JEWELRY_PIECES,
    metals: JEWELRY_METALS,
    stones: JEWELRY_STONES,
    styles: JEWELRY_STYLES,
    apparel: APPAREL_PRODUCTS,
    decoMethods: DECO_METHODS,
    defaults: { jewelry: DEFAULT_JEWELRY_OPTIONS, apparel: DEFAULT_APPAREL_OPTIONS },
  });
});

/* ─── GET /api/jewelry/guide ────────────────────────────────────────────
   Static manufacturing guide. Free — pure content. */
router.get("/jewelry/guide", (_req, res) => {
  res.json({ sections: JEWELRY_GUIDE });
});

/* ─── Option schemas ──────────────────────────────────────────────────── */

const JewelryOptionsSchema = z.object({
  category: z.literal("jewelry"),
  piece: z.string(),
  metal: z.string(),
  stone: z.string(),
  style: z.string(),
  nfc: z.coerce.boolean().default(true),
  nfcUrl: z.string().max(500).default(""),
  notes: z.string().max(500).default(""),
});

const ApparelOptionsSchema = z.object({
  category: z.literal("apparel"),
  product: z.string(),
  deco: z.string(),
  color: z.string().max(40).default("Black"),
  notes: z.string().max(500).default(""),
});

function parseJewelryOptions(body: unknown): JewelryDesignOptions | null {
  const p = JewelryOptionsSchema.safeParse(body);
  if (!p.success) return null;
  const d = p.data;
  if (
    !isJewelryPieceKey(d.piece) ||
    !isMetalKey(d.metal) ||
    !isStoneKey(d.stone) ||
    !isJewelryStyleKey(d.style)
  ) {
    return null;
  }
  return {
    piece: d.piece,
    metal: d.metal,
    stone: d.stone,
    style: d.style,
    nfc: d.nfc,
    nfcUrl: d.nfcUrl,
    notes: d.notes,
  };
}

function parseApparelOptions(body: unknown): ApparelDesignOptions | null {
  const p = ApparelOptionsSchema.safeParse(body);
  if (!p.success) return null;
  const d = p.data;
  if (!isApparelProductKey(d.product) || !isDecoMethodKey(d.deco)) return null;
  return { product: d.product, deco: d.deco, color: d.color, notes: d.notes };
}

/* ─── POST /api/jewelry/design ──────────────────────────────────────────
   AI preview render from the uploaded logo + options. 2 credits.
   Charge up front; auto-refund on any failure. */
router.post("/jewelry/design", requireAuth, upload.single("logo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Upload a logo image (PNG/JPG/WebP)." });
    return;
  }

  const category = req.body.category === "apparel" ? "apparel" : "jewelry";
  const jewelryOpts = category === "jewelry" ? parseJewelryOptions(req.body) : null;
  const apparelOpts = category === "apparel" ? parseApparelOptions(req.body) : null;
  if ((category === "jewelry" && !jewelryOpts) || (category === "apparel" && !apparelOpts)) {
    res.status(400).json({ error: "Invalid design options." });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, PREVIEW_CREDITS, {
      action: "Jewelry Studio — AI Preview",
    });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      outOfCredits(res);
      return;
    }
    throw chargeErr;
  }

  const fail = async (msg: string) => {
    req.log.error({ userId: req.userId }, "[jewelry] preview failed — refunding");
    try {
      await refundCredits(req.userId!, PREVIEW_CREDITS, {
        action: "Jewelry Studio — AI Preview Refund (generation failed)",
      });
    } catch (refundErr) {
      req.log.error({ err: refundErr }, "[jewelry] REFUND FAILED after preview failure");
    }
    res.status(500).json({ error: msg });
  };

  try {
    const prompt =
      category === "apparel" && apparelOpts
        ? buildApparelPrompt(apparelOpts)
        : buildJewelryPrompt(jewelryOpts!);
    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt: prompt.slice(0, 4000),
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      await fail("Image generation returned no image data.");
      return;
    }
    const file = await uploadJewelryFile(req.userId!, Buffer.from(b64, "base64"), "png", "image/png");
    res.json({
      url: file.url,
      path: file.path,
      creditsRemaining: creditsAfter,
      creditCost: PREVIEW_CREDITS,
      note: "AI visualization — your STL manufacturing file is built from your exact logo geometry.",
    });
  } catch (err) {
    await fail("Preview generation failed. Please try again.");
  }
});

/* ─── POST /api/jewelry/export-stl ──────────────────────────────────────
   Logo → binary STL pendant medallion (disc + logo relief + bail +
   optional NFC tag cavity). 4 credits. Returns a download URL plus the
   physical specs the estimate engine uses. */
router.post("/jewelry/export-stl", requireAuth, upload.single("logo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Upload a logo image (PNG/JPG/WebP)." });
    return;
  }
  const opts = parseJewelryOptions({ ...req.body, category: "jewelry" });
  if (!opts) {
    res.status(400).json({ error: "Invalid design options." });
    return;
  }
  if (!["image/png", "image/x-png"].includes(req.file.mimetype)) {
    res.status(400).json({
      error: "For the sharpest STL, upload a PNG with a transparent background.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, STL_CREDITS, {
      action: "Jewelry Studio — STL Export",
    });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      outOfCredits(res);
      return;
    }
    throw chargeErr;
  }

  const fail = async (msg: string) => {
    req.log.error({ userId: req.userId }, "[jewelry] STL export failed — refunding");
    try {
      await refundCredits(req.userId!, STL_CREDITS, {
        action: "Jewelry Studio — STL Export Refund (failed)",
      });
    } catch (refundErr) {
      req.log.error({ err: refundErr }, "[jewelry] REFUND FAILED after STL failure");
    }
    res.status(500).json({ error: msg });
  };

  try {
    const img = decodePNG(req.file.buffer);
    const mask = logoToMask(img, 128);
    const built = buildPendantSTL(mask, { nfcPocket: opts.nfc });
    const density = JEWELRY_METALS[opts.metal].densityGPerCm3;
    const weightG = stlWeightGrams(built.volumeMm3, density);
    const file = await uploadJewelryFile(req.userId!, built.stl, "stl", "model/stl");

    const pieceNote =
      opts.piece === "diamond-pendant" || opts.piece === "gold-pendant"
        ? "Ready to cast as a pendant — bail included for your chain."
        : `This STL is the logo medallion/centerpiece for your ${JEWELRY_PIECES[opts.piece].label.toLowerCase()} — your jeweler mounts it to the finished piece during CAD review.`;

    res.json({
      url: file.url,
      path: file.path,
      facetCount: built.facetCount,
      volumeMm3: Math.round(built.volumeMm3),
      weightG: Math.round(weightG * 10) / 10,
      metal: JEWELRY_METALS[opts.metal].label,
      widthMm: built.widthMm,
      heightMm: Math.round(built.heightMm * 10) / 10,
      nfcPocket: opts.nfc,
      pieceNote,
      creditsRemaining: creditsAfter,
      creditCost: STL_CREDITS,
    });
  } catch (err) {
    await fail(
      err instanceof Error ? `STL export failed: ${err.message}` : "STL export failed.",
    );
  }
});

/* ─── POST /api/jewelry/estimate ────────────────────────────────────────
   Deterministic cost estimate. Free — pure math, no AI cost. */
const EstimateBody = z.object({
  category: z.enum(["jewelry", "apparel"]).default("jewelry"),
  options: z.record(z.string(), z.unknown()).default({}),
  weightG: z.number().positive().max(2000).optional(),
  qty: z.number().int().min(1).max(1000).default(24),
});

router.post("/jewelry/estimate", requireAuth, async (req, res) => {
  const parsed = EstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid estimate request." });
    return;
  }
  const { category, options, weightG, qty } = parsed.data;
  if (category === "apparel") {
    const o = parseApparelOptions({ ...options, category: "apparel" });
    if (!o) {
      res.status(400).json({ error: "Invalid apparel options." });
      return;
    }
    res.json({ category, estimate: estimateApparel(o, qty), qty });
    return;
  }
  const o = parseJewelryOptions({ ...options, category: "jewelry" });
  if (!o) {
    res.status(400).json({ error: "Invalid jewelry options." });
    return;
  }
  res.json({
    category,
    estimate: estimateManufacturing(o, weightG),
    stoneCount: estimateStoneCount(o),
  });
});

/* ─── POST /api/jewelry/consult ────────────────────────────────────────
   AI jewelry & apparel consultant. 1 credit per message. */
const ConsultBody = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});

router.post("/jewelry/consult", requireAuth, async (req, res) => {
  const parsed = ConsultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  try {
    await chargeCredits(req.userId!, CONSULT_CREDITS, {
      action: "Jewelry Studio — AI Consultant",
    });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      outOfCredits(res);
      return;
    }
    if (chargeErr instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed" });
      return;
    }
    throw chargeErr;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: JEWELRY_CONSULTANT_SYSTEM_PROMPT },
        ...parsed.data.history.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user", content: parsed.data.message },
      ],
      max_completion_tokens: 600,
      temperature: 0.7,
    });
    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — could you ask that again? 🦈";
    res.json({ reply, creditCost: CONSULT_CREDITS });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      res.status(503).json({ error: "I'm catching my breath — try again in a moment. 🦈" });
      return;
    }
    req.log.error({ err }, "[jewelry] consult failed");
    res.status(500).json({ error: "Something went wrong — give me another shot. 🦈" });
  }
});

export default router;
