import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel, LOW_REASONING_PARAMS } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../lib/credits";
import { findStoredGenerationResult, storeGenerationResult } from "../lib/generation-stored-results";

const router = Router();

/* ─── Wave 8 · Hook Rewriter ─────────────────────────────────────────────
   Creators paste an underperforming post + their niche and get exactly 5
   rewritten hook variants back, each with its angle and why it works.
   Paid: 50 Visual Bucs per rewrite. Auth required; credits are deducted
   BEFORE the model call and REFUNDED on model failure, using the same
   pre-check + chargeCredits + refundCredits pattern as the paid routes. */

const WAVE8_HOOK_REWRITE_CREDITS =
  Number(process.env["WAVE8_HOOK_REWRITE_CREDITS"]) || 50;

const REPLAY_NOTE =
  "These are the hook rewrites you already made for this request — tweak the post for a fresh set.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave8HookRewriterReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

const rewriteSchema = z.object({
  post: z
    .string()
    .trim()
    .min(1, "Paste the post you want rewritten.")
    .max(2000, "Keep the post under 2000 characters."),
  niche: z.string().trim().max(100, "Keep your niche under 100 characters.").default(""),
});

const variantSchema = z.object({
  hook: z.string().trim().min(1).max(280),
  angle: z.string().trim().min(1).max(60),
  whyItWorks: z.string().trim().min(1).max(300),
});

const aiResponseSchema = z.object({
  variants: z.array(variantSchema).length(5, "AI must return exactly 5 variants."),
});

type Variant = z.infer<typeof variantSchema>;

async function runWave8HookRewriter(
  userId: string,
  parsedData: z.infer<typeof rewriteSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(userId, WAVE8_HOOK_REWRITE_CREDITS, {
      action: "Hook Rewriter",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to rewrite your hook.",
      };
    }
    throw err;
  }

  try {
    const { post, niche } = parsedData;

    let variants: Variant[] | null = null;
    /* Two attempts: a malformed first response gets one retry before we
       refund and fail. */
    for (let attempt = 0; attempt < 2 && !variants; attempt++) {
      const completion = await getOpenAI().chat.completions.create({
        ...LOW_REASONING_PARAMS,
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              `You are a hook surgeon for content creators. The creator pastes a post ` +
              `that is underperforming, and you rewrite ONLY the opening hook — not the ` +
              `whole post — into exactly 5 fresh variants. Each variant must use a DIFFERENT ` +
              `angle (pick 5 of: curiosity gap, bold claim, contrarian take, number/stat, ` +
              `story opener, direct callout, question, transformation promise). Keep every ` +
              `hook under 40 words, written in the creator's voice, ready to drop in front ` +
              `of their existing content. No made-up stats, no virality guarantees, no ` +
              `clickbait that the post can't deliver on. ` +
              `Return ONLY JSON: { "variants": [ { "hook": "<the rewritten hook>", ` +
              `"angle": "<short angle label>", ` +
              `"whyItWorks": "<one sentence on the psychology behind this hook>" }, ` +
              `... exactly 5 variants ] }.`,
          },
          {
            role: "user",
            content:
              (niche ? `Niche: ${niche}\n` : "") +
              `Underperforming post:\n"""\n${post}\n"""\nRewrite the hook 5 ways.`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1200,
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      try {
        const checked = aiResponseSchema.safeParse(JSON.parse(raw));
        if (checked.success) variants = checked.data.variants;
      } catch {
        /* retry once */
      }
    }
    if (!variants) throw new Error("Model returned no usable hook variants");

    return {
      variants,
      creditsUsed: WAVE8_HOOK_REWRITE_CREDITS,
      creditsRemaining,
    };
  } catch (err) {
    /* The charge was taken before the model call — give it back so a
       provider failure never costs the creator. */
    let refunded = true;
    try {
      await refundCredits(userId, WAVE8_HOOK_REWRITE_CREDITS, {
        action: "Hook Rewriter — Refund (rewrite failed)",
      });
    } catch (refundErr) {
      refunded = false;
      logger.error(
        { err: refundErr, userId },
        "[wave8-hook-rewriter] refund failed after generation failure"
      );
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[wave8-hook-rewriter] OpenAI rate limit / quota");
      return {
        __status: 503,
        error: "The studio is catching its breath — try again in a moment.",
      };
    }
    logger.error({ err }, "[wave8-hook-rewriter] rewrite failed");
    return { __status: 502, error: "The studio hiccupped — try again." };
  }
}

/* POST /api/wave8/hook-rewriter/rewrite { post, niche }
   → 200 { variants, creditsUsed, creditsRemaining }. Paid: 50 VB. */
router.post("/wave8/hook-rewriter/rewrite", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = rewriteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid rewrite request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    getOpenAI();
  } catch {
    res.status(503).json({ error: "ai_unavailable" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < WAVE8_HOOK_REWRITE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to rewrite your hook.",
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    "wave8-hook-rewriter", req.userId!, undefined,
    { post: parsed.data.post, niche: parsed.data.niche },
  );

  const durable = await findStoredGenerationResult("wave8-hook-rewriter", idempotencyKey, req.userId!);
  if (durable) {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json({ ...stored.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json({ ...twinBody, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }
  }

  const run = runWave8HookRewriter(req.userId!, parsed.data, idempotencyKey);
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

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult("wave8-hook-rewriter", idempotencyKey, req.userId!, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  res.json(body);
});

export default router;
