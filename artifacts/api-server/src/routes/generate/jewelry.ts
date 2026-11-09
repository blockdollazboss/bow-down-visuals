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
import { Router, type Response } from "express";
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import multer from "multer";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { uploadPublicMediaToR2 } from "../../lib/objectStorage";
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
  // R2 migration: zero-egress public upload (Supabase fallback when R2 unset).
  const url = await uploadPublicMediaToR2(JEWELRY_BUCKET, filePath, buffer, contentType);
  return { url, path: filePath };
}

/* The out-of-credits body (402) is returned inline by each run
   function below as a __status body — see runJewelryDesign. */

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

/* ─── Idempotent charge + stored-result replay (CA-3) ──────────────────
   This file carries THREE paid rails (design / export-stl / consult),
   each with its own scope and replay note, sharing one in-process
   replay cache. The server derives the charge key from the request
   intent (for the two upload rails, a hash of the logo bytes rides in
   the intent — the file itself never enters the key); a replay — the
   same ask sent twice, a double-tap, a retried upload — is served the
   STORED result (flagged replayed:true) instead of charging again.
   The durable check runs through lib/generation-stored-results.ts so
   a replay survives a restart; fresh responses are byte-identical;
   storage is fail-open. Every refund path VOIDS its charge key so a
   genuine retry charges fresh. */
const JEWELRY_DESIGN_SCOPE = "jewelry-design";
const JEWELRY_DESIGN_REPLAY_NOTE =
  "This is the preview you already made for this logo and these options — change the logo or options for a fresh one.";
const JEWELRY_STL_SCOPE = "jewelry-export-stl";
const JEWELRY_STL_REPLAY_NOTE =
  "This is the STL export you already made for this logo and these options — change the logo or options for a fresh one.";
const JEWELRY_CONSULT_SCOPE = "jewelry-consult";
const JEWELRY_CONSULT_REPLAY_NOTE =
  "This is the answer you already got for this message — ask something new for a fresh take.";

interface StoredResult {
  body: Record<string, unknown>;
  storedAt: number;
}

const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: clear the in-process replay cache between cases. */
export function __resetJewelryReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

async function serveReplayableRun(opts: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  note: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey, note, run } = opts;

  /* 1) Durable pre-check (restart-surviving) — BEFORE funding. */
  const durable = await findStoredGenerationResult(
    "jewelry",
    idempotencyKey,
    userId,
  );
  if (durable) {
    const body =
      durable.result && typeof durable.result === "object"
        ? (durable.result as Record<string, unknown>)
        : null;
    if (body && body["error"] === undefined) {
      storedResults.set(idempotencyKey, { body, storedAt: Date.now() });
      res.json({ ...body, replayed: true, replayNote: note });
      return;
    }
  }

  /* 2) In-process completed result. */
  const done = storedResults.get(idempotencyKey);
  if (done) {
    res.json({ ...done.body, replayed: true, replayNote: note });
    return;
  }

  /* 3) In-flight twin: wait for it, then serve its result as a replay.
        If the twin failed, fall through and run fresh. */
  const twin = inFlight.get(idempotencyKey);
  if (twin) {
    const twinBody = await twin.catch(() => null);
    if (twinBody && twinBody["__status"] === undefined) {
      res.json({ ...twinBody, replayed: true, replayNote: note });
      return;
    }
  }

  /* 4) Fresh run. */
  const promise = (async () => run())();
  inFlight.set(idempotencyKey, promise);
  let body: Record<string, unknown>;
  try {
    body = await promise;
  } finally {
    if (inFlight.get(idempotencyKey) === promise) {
      inFlight.delete(idempotencyKey);
    }
  }

  const status = body["__status"];
  if (typeof status === "number") {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  /* 5) Success: remember it in-process AND durably BEFORE answering,
        so a replay that lands in between still finds it. */
  if (storedResults.size >= MAX_STORED_RESULTS) {
    storedResults.clear();
  }
  storedResults.set(idempotencyKey, { body, storedAt: Date.now() });
  await storeGenerationResult("jewelry", idempotencyKey, userId, body);

  /* Post-charge guard: if a DIFFERENT stored body won the durable
     slot while this run was working, serve that stored body as the
     replay — the ledger dedup already kept this to one charge. */
  const winner = await findStoredGenerationResult(
    "jewelry",
    idempotencyKey,
    userId,
  );
  if (winner) {
    const winnerBody =
      winner.result && typeof winner.result === "object"
        ? (winner.result as Record<string, unknown>)
        : null;
    if (
      winnerBody &&
      winnerBody["error"] === undefined &&
      JSON.stringify(winnerBody) !== JSON.stringify(body)
    ) {
      storedResults.set(idempotencyKey, { body: winnerBody, storedAt: Date.now() });
      res.json({ ...winnerBody, replayed: true, replayNote: note });
      return;
    }
  }

  res.json(body);
}

/* ─── POST /api/jewelry/design ──────────────────────────────────────────
   AI preview render from the uploaded logo + options. 2 credits.
   Charge up front; auto-refund on any failure. */
async function runJewelryDesign(
  userId: string,
  category: "jewelry" | "apparel",
  jewelryOpts: JewelryDesignOptions | null,
  apparelOpts: ApparelDesignOptions | null,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  const fail = async (msg: string): Promise<Record<string, unknown>> => {
    log.error({ userId }, "[jewelry] preview failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, PREVIEW_CREDITS, {
        action: "Jewelry Studio — AI Preview Refund (generation failed)",
      });
    } catch (refundErr) {
      refunded = false;
      log.error({ err: refundErr }, "[jewelry] REFUND FAILED after preview failure");
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: msg };
  };

  try {
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(userId, PREVIEW_CREDITS, {
        action: "Jewelry Studio — AI Preview",
      }, { idempotencyKey });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        return {
          __status: 402,
          error: "out_of_credits",
          message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
        };
      }
      throw chargeErr;
    }

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
      return await fail("Image generation returned no image data.");
    }
    const file = await uploadJewelryFile(userId, Buffer.from(b64, "base64"), "png", "image/png");
    return {
      url: file.url,
      path: file.path,
      creditsRemaining: creditsAfter,
      creditCost: PREVIEW_CREDITS,
      note: "AI visualization — your STL manufacturing file is built from your exact logo geometry.",
    };
  } catch (err) {
    return await fail("Preview generation failed. Please try again.");
  }
}

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

  const idempotencyKey = buildChargeIdempotencyKey(
    JEWELRY_DESIGN_SCOPE, req.userId!, undefined,
    {
      category,
      jewelry: jewelryOpts,
      apparel: apparelOpts,
      fileHash: createHash("sha256").update(req.file.buffer).digest("hex"),
    },
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    note: JEWELRY_DESIGN_REPLAY_NOTE,
    run: () => runJewelryDesign(
      req.userId!, category, jewelryOpts, apparelOpts, idempotencyKey, req.log,
    ),
  });
});

/* ─── POST /api/jewelry/export-stl ──────────────────────────────────────
   Logo → binary STL pendant medallion (disc + logo relief + bail +
   optional NFC tag cavity). 4 credits. Returns a download URL plus the
   physical specs the estimate engine uses. */
async function runJewelryStl(
  userId: string,
  opts: JewelryDesignOptions,
  fileBuffer: Buffer,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  const fail = async (msg: string): Promise<Record<string, unknown>> => {
    log.error({ userId }, "[jewelry] STL export failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, STL_CREDITS, {
        action: "Jewelry Studio — STL Export Refund (failed)",
      });
    } catch (refundErr) {
      refunded = false;
      log.error({ err: refundErr }, "[jewelry] REFUND FAILED after STL failure");
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: msg };
  };

  try {
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(userId, STL_CREDITS, {
        action: "Jewelry Studio — STL Export",
      }, { idempotencyKey });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        return {
          __status: 402,
          error: "out_of_credits",
          message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
        };
      }
      throw chargeErr;
    }

    const img = decodePNG(fileBuffer);
    const mask = logoToMask(img, 128);
    const built = buildPendantSTL(mask, { nfcPocket: opts.nfc });
    const density = JEWELRY_METALS[opts.metal].densityGPerCm3;
    const weightG = stlWeightGrams(built.volumeMm3, density);
    const file = await uploadJewelryFile(userId, built.stl, "stl", "model/stl");

    const pieceNote =
      opts.piece === "diamond-pendant" || opts.piece === "gold-pendant"
        ? "Ready to cast as a pendant — bail included for your chain."
        : `This STL is the logo medallion/centerpiece for your ${JEWELRY_PIECES[opts.piece].label.toLowerCase()} — your jeweler mounts it to the finished piece during CAD review.`;

    return {
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
    };
  } catch (err) {
    return await fail(
      err instanceof Error ? `STL export failed: ${err.message}` : "STL export failed.",
    );
  }
}

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

  const idempotencyKey = buildChargeIdempotencyKey(
    JEWELRY_STL_SCOPE, req.userId!, undefined,
    {
      options: opts,
      fileHash: createHash("sha256").update(req.file.buffer).digest("hex"),
    },
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    note: JEWELRY_STL_REPLAY_NOTE,
    run: () => runJewelryStl(req.userId!, opts, req.file!.buffer, idempotencyKey, req.log),
  });
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

async function runJewelryConsult(
  userId: string,
  data: z.infer<typeof ConsultBody>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  try {
    await chargeCredits(userId, CONSULT_CREDITS, {
      action: "Jewelry Studio — AI Consultant",
    }, { idempotencyKey });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
      };
    }
    if (chargeErr instanceof LedgerWriteError) {
      return { __status: 500, error: "ledger_write_failed" };
    }
    log.error({ err: chargeErr }, "[jewelry] consult charge failed");
    return { __status: 500, error: "Could not process Visual Bucs. Please try again." };
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: JEWELRY_CONSULTANT_SYSTEM_PROMPT },
        ...data.history.map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        { role: "user", content: data.message },
      ],
      max_completion_tokens: 600,
    });
    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — could you ask that again? 🦈";
    return { reply, creditCost: CONSULT_CREDITS };
  } catch (err) {
    /* The charge landed before the provider call — refund it on any
       failure, same fail-closure shape as the preview/STL handlers
       above (D5 sweep G13). CA-3: the refund VOIDS the charge key so
       a genuine retry charges fresh. */
    let refunded = true;
    try {
      await refundCredits(userId, CONSULT_CREDITS, {
        action: "Jewelry Studio — AI Consultant Refund (consult failed)",
      });
    } catch (refundErr) {
      refunded = false;
      log.error({ err: refundErr }, "[jewelry] REFUND FAILED after consult failure");
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      return { __status: 503, error: "I'm catching my breath — try again in a moment. 🦈" };
    }
    log.error({ err }, "[jewelry] consult failed");
    return { __status: 500, error: "Something went wrong — give me another shot. 🦈" };
  }
}

router.post("/jewelry/consult", requireAuth, async (req, res) => {
  const parsed = ConsultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const idempotencyKey = buildChargeIdempotencyKey(
    JEWELRY_CONSULT_SCOPE, req.userId!, undefined, parsed.data,
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    note: JEWELRY_CONSULT_REPLAY_NOTE,
    run: () => runJewelryConsult(req.userId!, parsed.data, idempotencyKey, req.log),
  });
});

export default router;
