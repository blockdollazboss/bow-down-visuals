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

const REPLAY_NOTE =
  "This is the background plate you already made for this request — tweak the prompt or style for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetBgGenerateReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

async function runBgGeneration(
  userId: string,
  prompt: string,
  style: (typeof BG_GENERATE_STYLES)[number],
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, BG_GENERATE_CREDIT_COST, {
      action: "AI Background Plate",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      };
    }
    throw err;
  }

  try {
    const result = await generateBackgroundImage({ prompt, style, userId });
    return { imageUrl: result.imageUrl, creditCost: BG_GENERATE_CREDIT_COST, creditsRemaining: creditsAfter };
  } catch (err) {
    /* Provider failed after the charge — refund in full, then VOID the
       charge's idempotency key: without the void, the refunded attempt's
       key still reads as "already charged", so the retry is suppressed
       as a replay and generates FREE (Lane V3 F1 leak). The refund claim
       in the response is only made when the refund actually landed. */
    let refunded = true;
    try {
      await refundCredits(userId, BG_GENERATE_CREDIT_COST, {
        action: "AI Background Plate — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    if (err instanceof BgImageNotConfiguredError) {
      return { __status: 503, error: err.code, message: err.message };
    }
    return {
      __status: 500,
      error: "BG_GENERATE_FAILED",
      message: err instanceof Error
        ? err.message
        : refunded
          ? "Background generation failed. Your Visual Bucs were refunded."
          : "Background generation failed, and the refund didn't go through — it's been flagged for reconciliation.",
    };
  }
}

const router = Router();

/**
 * Price — Visual Bucs per AI-generated background plate: 200.
 * This constant IS the charged price and the price the status endpoint
 * reports (the editor UI displays the status value; its display-only
 * fallback is also 200). Matches Images Pro (2 cr = 200 VB).
 */
export const BG_GENERATE_CREDIT_COST = 200;

export const BG_GENERATE_STYLES = ["studio", "neon-city", "golden-palace", "beach-sunset"] as const;

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

  /* Idempotency (CA-KEY): the server derives the key itself on EVERY
     call — a sane client key (≥8 chars) is honored, otherwise the
     {prompt, style} intent hash IS the key. A keyless caller used to
     pass null here: every replay re-charged and re-generated (the
     charge-audit's weak-key defect). The intent-hash trade-off is the
     C-36 ruling's: an identical ask can never be re-bought — so a
     replay serves the stored plate with replayed: true and says so
     (REPLAY_NOTE) instead of charging again. */
  const clientKey = parsed.data.idempotencyKey;
  const idempotencyKey = buildChargeIdempotencyKey(
    "bg-generate", req.userId!, clientKey,
    { prompt: parsed.data.prompt, style: parsed.data.style ?? "studio" },
  );

  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json({ ...stored.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody) {
      res.json({ ...twinBody, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }
    /* The twin failed (refunded + key voided) — fall through and run
       this request fresh. */
  }

  const run = runBgGeneration(
    req.userId!,
    parsed.data.prompt,
    parsed.data.style ?? "studio",
    idempotencyKey,
  );
  inFlight.set(idempotencyKey, run);
  let body: Record<string, unknown>;
  try {
    body = await run;
  } finally {
    if (inFlight.get(idempotencyKey) === run) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  /* Store BEFORE answering (contracts/post-assist pattern): a retry
     that arrives after this response is served from the stored plate.
     Fail-open — store errors never fail the paid ask. */
  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

export default router;
