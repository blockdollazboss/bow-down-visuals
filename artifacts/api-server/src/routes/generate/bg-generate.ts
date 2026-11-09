import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  bgImageProviderConfigured,
  BgImageNotConfiguredError,
  generateBackgroundImage,
} from "../../lib/bg-image-client";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

const router = Router();

/**
 * Price — Visual Bucs per AI-generated background plate: 200.
 * This constant IS the charged price and the price the status endpoint
 * reports (the editor UI displays the status value; its display-only
 * fallback is also 200). Matches Images Pro (2 cr = 200 VB).
 */
export const BG_GENERATE_CREDIT_COST = 200;

export const BG_GENERATE_STYLES = ["studio", "neon-city", "golden-palace", "beach-sunset"] as const;

/* Served with a replayed result (C-36 honesty): the stored plate comes
   back verbatim and says an identical ask cannot be re-bought. */
const REPLAY_NOTE = "This is the background plate you already made for this request — tweak the prompt or style for a fresh one.";

const bgGenerateSchema = z.object({
  prompt: z.string().min(3).max(500),
  style: z.enum(BG_GENERATE_STYLES).optional(),
  idempotencyKey: z.string().max(128).optional(),
});

/**
 * GET /api/bg-generate/status — is the house image provider connected?
 * Never 503s; the frontend disables Generate when configured === false.
 */
router.get("/bg-generate/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: bgImageProviderConfigured(),
    /* House copy law: the wire never carries the image provider's name.
       Clients read `configured` / `creditCost` only; the provider field
       stays as a house token so the shape doesn't change under them. */
    provider: bgImageProviderConfigured() ? "house" : null,
    styles: BG_GENERATE_STYLES,
    creditCost: BG_GENERATE_CREDIT_COST,
    pricePlaceholder: false,
  });
});

/**
 * POST /api/bg-generate — generate a background plate ({prompt, style}
 * → {imageUrl}) through the house image provider. Charges
 * BG_GENERATE_CREDIT_COST via chargeCredits with an idempotency key;
 * a provider failure refunds the charge in full. 503 (no charge) when
 * no image key is configured; 402 when out of credits.
 */
router.post("/bg-generate", requireAuth, async (req: Request, res: Response) => {
  const parsed = bgGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "prompt (3–500 chars) is required; style must be one of the listed presets.",
    });
    return;
  }
  if (!bgImageProviderConfigured()) {
    const err = new BgImageNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  /* Idempotency: every call carries a real server-derived key. A sane
     client per-attempt key is honored; a keyless call is keyed by its
     INTENT (prompt + style) instead of running unkeyed — the ledger
     dedups on this key, so an identical re-ask can never
     double-charge. (Supersedes the Lane V3 F1 keyless rule: with a
     stored result behind the key, an identical re-run is a replay,
     not a free generation and not a fresh charge.) */
  const idempotencyKey = buildChargeIdempotencyKey(
    "bg-generate", req.userId!, parsed.data.idempotencyKey,
    { prompt: parsed.data.prompt, style: parsed.data.style ?? "studio" },
  );

  /* Stored-result pre-check (migration 0333) BEFORE any funding: a
     replay under a landed key is answered from the durable row —
     the stored body verbatim + replayed/replayNote — with no charge
     and no provider call, even after a server restart. Fail-open: a
     storage miss or failure falls through to the charge below. */
  const stored = await findStoredGenerationResult("bg-generate", idempotencyKey, req.userId!);
  if (stored) {
    res.json({ ...stored, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BG_GENERATE_CREDIT_COST, {
      action: "AI Background Plate",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating." });
      return;
    }
    throw err;
  }

  try {
    const result = await generateBackgroundImage({
      prompt: parsed.data.prompt,
      style: parsed.data.style ?? "studio",
      userId: req.userId!,
    });
    const body = { imageUrl: result.imageUrl, creditCost: BG_GENERATE_CREDIT_COST, creditsRemaining: creditsAfter };
    /* Persist BEFORE answering: the row is what a post-restart replay
       is served from. Fail-open inside the helper — a storage failure
       never fails this paid success. */
    await storeGenerationResult("bg-generate", idempotencyKey, req.userId!, { ...body });
    res.json(body);
  } catch (err) {
    /* Provider failed after the charge — refund in full, then VOID the
       charge's idempotency key: without the void, the refunded attempt's
       key still reads as "already charged", so the retry is suppressed
       as a replay and generates FREE (Lane V3 F1 leak). The refund claim
       in the response is only made when the refund actually landed. */
    let refunded = true;
    try {
      await refundCredits(req.userId!, BG_GENERATE_CREDIT_COST, {
        action: "AI Background Plate — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded && idempotencyKey) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    if (err instanceof BgImageNotConfiguredError) {
      res.status(503).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "BG_GENERATE_FAILED",
      message: err instanceof Error
        ? err.message
        : refunded
          ? "Background generation failed. Your Visual Bucs were refunded."
          : "Background generation failed, and the refund didn't go through — it's been flagged for reconciliation.",
    });
  }
});

export default router;
