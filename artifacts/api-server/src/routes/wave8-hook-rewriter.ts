import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";

const router = Router();

/* ─── Wave 8 · Hook Rewriter ─────────────────────────────────────────────
   Creators paste an underperforming post + their niche and get exactly 5
   rewritten hook variants back, each with its angle and why it works.
   Paid: 50 Visual Bucs per rewrite. Auth required; credits are deducted
   BEFORE the model call and REFUNDED on model failure, using the same
   pre-check + chargeCredits + refundCredits pattern as the paid routes. */

export const WAVE8_HOOK_REWRITE_CREDITS =
  Number(process.env["WAVE8_HOOK_REWRITE_CREDITS"]) || 50;

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

/* POST /api/wave8/hook-rewriter/rewrite { post, niche }
   → 200 { variants, creditsUsed, creditsRemaining }. Paid: 50 VB. */
router.post("/wave8/hook-rewriter/rewrite", publicApiLimiter, requireAuth, async (req, res) => {
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
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, WAVE8_HOOK_REWRITE_CREDITS, {
      action: "Hook Rewriter",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to rewrite your hook.",
      });
      return;
    }
    throw err;
  }

  try {
    const { post, niche } = parsed.data;

    let variants: Variant[] | null = null;
    /* Two attempts: a malformed first response gets one retry before we
       refund and fail. */
    for (let attempt = 0; attempt < 2 && !variants; attempt++) {
      const completion = await getOpenAI().chat.completions.create({
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
        temperature: 0.8,
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

    res.json({
      variants,
      creditsUsed: WAVE8_HOOK_REWRITE_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    /* The charge was taken before the model call — give it back so a
       provider failure never costs the creator. */
    try {
      await refundCredits(req.userId!, WAVE8_HOOK_REWRITE_CREDITS, {
        action: "Hook Rewriter — Refund (rewrite failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[wave8-hook-rewriter] refund failed after generation failure"
      );
    }

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[wave8-hook-rewriter] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[wave8-hook-rewriter] rewrite failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
