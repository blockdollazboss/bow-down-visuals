import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import { saveGeneration, asVaultId } from "../../lib/save-generation";
import { r2Upload } from "../../lib/r2-client";

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────────
   PHOTO ENHANCE — credit pricing
   PLACEHOLDER — NOT USER-APPROVED. The user must approve the final price
   before this ships. Env-overridable without a deploy (PHOTO_ENHANCE_CREDITS).
   ───────────────────────────────────────────────────────────────────────────── */
export const PHOTO_ENHANCE_CREDIT_COST_PLACEHOLDER = 100;
const ENHANCE_CREDITS = Number(process.env["PHOTO_ENHANCE_CREDITS"]) || PHOTO_ENHANCE_CREDIT_COST_PLACEHOLDER;

/* ── No local `sharp` build exists in this service (checked package.json +
   node_modules on 2026-10-11), so ALL four operations route through the gated
   Nano Banana 2.1 AI provider below. If `sharp` is ever added, upscale/denoise
   can move to a free local path and stop charging. ── */

/** Google Gemini image model (Nano Banana 2.1) — env-overridable. Requires GEMINI_API_KEY. */
const NANO_MODEL = process.env["GEMINI_IMAGE_MODEL"] || "gemini-nano-banana-2.1";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_MODEL}:generateContent`;

export const PHOTO_ENHANCE_OPS = ["upscale", "denoise", "restore", "colorize"] as const;
export type PhotoEnhanceOp = (typeof PHOTO_ENHANCE_OPS)[number];

const NANO_ASPECT = {
  "9:16": "9:16",
  "1:1": "1:1",
  "16:9": "16:9",
} as const;

/** Fetches an https image URL and returns it as base64 + mime type. */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Source photo download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 12 * 1024 * 1024) {
    throw new Error("Source photo is empty or too large (12 MB max).");
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  if (!/^image\//i.test(mimeType)) throw new Error("Source URL did not return an image.");
  return { data: buf.toString("base64"), mimeType };
}

interface GeminiPart { inlineData?: { data?: string }; text?: string }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Runs Nano Banana 2.1 as an image EDITOR: the source photo is passed in as
 * image input and the prompt describes the enhancement to apply.
 */
async function enhanceWithNanoBanana(opts: {
  sourceImage: { data: string; mimeType: string };
  prompt: string;
  aspect?: "9:16" | "1:1" | "16:9";
  log: { warn: (...a: unknown[]) => void };
}): Promise<Buffer> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server");

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: opts.prompt },
            { inlineData: { mimeType: opts.sourceImage.mimeType, data: opts.sourceImage.data } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        /* No aspectRatio when unset — the model keeps the input photo's own
           proportions, which is what an enhancer must do by default. */
        imageConfig: {
          imageSize: "2K",
          ...(opts.aspect ? { aspectRatio: NANO_ASPECT[opts.aspect] } : {}),
        },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    const blockReason = json.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Nano Banana blocked this photo (${blockReason}). Try a different photo.`
        : "Nano Banana returned no image data.",
    );
  }
  return Buffer.from(b64, "base64");
}

/* ── Operation instructions. Every op preserves the original photo — faces,
   identity, composition, clothing, text — and only fixes what its name says. ── */
const OP_INSTRUCTIONS: Record<PhotoEnhanceOp, string> = {
  upscale:
    "Upscale this photo to high resolution (2K). Sharpen fine details, refine textures, hair, and edges, and clean up compression softness. Keep the exact same composition, faces, and colors — do not crop or reframe.",
  denoise:
    "Remove digital noise, grain, and compression artifacts from this photo while preserving fine detail, skin texture, and a natural look. Do not smooth faces into plastic or erase real texture.",
  restore:
    "Restore this old damaged photograph: remove scratches, dust spots, stains, tears, creases, and fading; plausibly repair damaged areas to match the surrounding content; restore contrast and tonal balance. Keep the original subjects, faces, composition, and identity exactly — do not modernize the photo or invent new elements.",
  colorize:
    "Colorize this black-and-white photo into full natural color: realistic skin tones, natural colors for clothing, hair, and background, consistent with the scene's lighting. Keep the exact same composition, faces, identity, lighting, and detail — do not change the scene.",
};

function strengthGuidance(strength: number, op: PhotoEnhanceOp): string {
  const s = Math.max(0, Math.min(100, Math.round(strength)));
  if (s <= 30) return `Apply very subtle, conservative processing for the ${op} step.`;
  if (s >= 70) return `Apply strong, confident processing for the ${op} step.`;
  return `Apply moderate, balanced processing for the ${op} step.`;
}

function buildEnhancePrompt(ops: PhotoEnhanceOp[], strengths: Partial<Record<PhotoEnhanceOp, number>>): string {
  const steps = ops.map((op, i) => {
    const instruction = OP_INSTRUCTIONS[op];
    const guidance = strengths[op] != null ? ` ${strengthGuidance(strengths[op], op)}` : "";
    return `Step ${i + 1} (${op}): ${instruction}${guidance}`;
  });
  return (
    "You are a professional photo enhancement tool. Enhance the input photo by applying the following steps in order. " +
    "CRITICAL IDENTITY RULE: preserve the exact original photo — same composition, same faces, same people, same clothing, same text, same scene. " +
    "Fix only what each step describes; never add, remove, or replace subjects, and never change anyone's identity or face. " +
    steps.join(" ") +
    " Return the enhanced photo only."
  ).slice(0, 4000);
}

/* ── Request validation ── */
const photoEnhanceSchema = z.object({
  /** Public https URL of the source photo (uploaded client-side via /api/r2/upload). */
  imageUrl: z.string().url().max(2048),
  operations: z.array(z.enum(PHOTO_ENHANCE_OPS)).min(1).max(4),
  /** Optional per-operation strength 0–100 (manual mode). Missing = model default. */
  strengths: z.record(z.enum(PHOTO_ENHANCE_OPS), z.number().min(0).max(100)).optional(),
  /** Optional output aspect override. Omitted = keep the input photo's proportions. */
  aspect: z.enum(["9:16", "1:1", "16:9"]).optional(),
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /photo-enhance
   1. Credit pre-check — always enforced (no dev bypass).
   2. 503 "not connected" gate when GEMINI_API_KEY is missing.
   3. Fetch the source photo, edit it with Nano Banana 2.1, charge on success.
   4. Upload to R2, save to generation history, return the public URL.
───────────────────────────────────────────────────────────────────────────── */
router.post("/photo-enhance", requireAuth, generationLimiter, async (req, res) => {
  const parsed = photoEnhanceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid photo enhance request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { imageUrl, operations, strengths, aspect } = parsed.data;

  if (!/^https:\/\//i.test(imageUrl)) {
    res.status(400).json({ error: "imageUrl must be a public https URL." });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const creditCost = ENHANCE_CREDITS;
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
    });
    return;
  }

  /* ── Provider gate: all four ops run on Nano Banana 2.1 (no local sharp) ── */
  if (!process.env["GEMINI_API_KEY"]) {
    res.status(503).json({
      error: "photo_enhance_not_connected",
      message: "Photo Enhance is not connected yet — the AI image service still needs to be set up on the server.",
    });
    return;
  }

  const prompt = buildEnhancePrompt(operations, strengths ?? {});
  req.log.info(
    { userId: req.userId, operations, hasStrengths: !!strengths, aspect: aspect ?? "input" },
    "[photo-enhance] enhancement started",
  );

  try {
    const sourceImage = await fetchImageAsBase64(imageUrl);
    const buffer = await enhanceWithNanoBanana({
      sourceImage,
      prompt,
      aspect,
      log: req.log,
    });

    /* ── Charge credits (image was delivered; same pattern as artist-image) ── */
    try {
      const creditsAfter = await chargeCreditsAtomic(
        req.userId!,
        creditCost,
        { action: "Photo Enhance" },
        { rollbackOnLedgerFailure: false },
      );
      req.log.info(
        { userId: req.userId, creditsAfter, deducted: creditCost, operations },
        "[photo-enhance] credits deducted",
      );
    } catch (err) {
      if (err instanceof LedgerWriteError) {
        req.log.error({ err }, "[photo-enhance] CRITICAL: ledger write failed after deduction — image delivered, charge has no ledger trace");
      } else {
        req.log.error({ err }, "[photo-enhance] credit deduction FAILED — image delivered without charge");
      }
    }

    /* ── Upload + save to history ── */
    const filePath = `${req.userId}/photo-enhance/${randomUUID()}.png`;
    const publicUrl = await r2Upload(filePath, buffer, "image/png");
    saveGeneration({
      userId: req.userId!,
      type: "image",
      artistVaultId: asVaultId((req.body as { artistVaultId?: unknown } | undefined)?.artistVaultId),
      title: `Photo Enhance (${operations.join(" + ")})`,
      fileUrl: publicUrl,
      thumbnailUrl: publicUrl,
      prompt: prompt.slice(0, 500),
      creditsSpent: creditCost,
    });

    res.json({
      taskId: `enhance-${randomUUID()}`,
      status: "succeeded",
      url: publicUrl,
      path: filePath,
      creditCost,
      operations,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Photo enhancement failed";
    req.log.error({ err: msg }, "[photo-enhance] enhancement failed — no credits charged");
    const status =
      /GEMINI_API_KEY is not configured/.test(msg) || /not connected/.test(msg) ? 503 : 500;
    res.status(status).json({
      error: status === 503 ? "photo_enhance_not_connected" : msg,
      message:
        status === 503
          ? "Photo Enhance is not connected yet — the AI image service still needs to be set up on the server."
          : undefined,
    });
  }
});

export default router;
