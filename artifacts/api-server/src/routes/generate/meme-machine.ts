import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

/* ─── Meme Machine ────────────────────────────────────────────────────────
   /api/meme-machine/captions — 1 credit: the creator describes a clip
   moment and picks a meme format; the AI writes 5 punchy meme captions
   (top/bottom text style options) for it. */

const router = Router();

/* 1 credit per 5-caption pack — env-overridable without a deploy. A short
   structured GPT-6 Sol completion; 1 credit holds a deep margin — and
   honors the standing rule that every AI feature costs a fee. */
const CAPTIONS_CREDITS = Number(process.env["MEME_MACHINE_CAPTIONS_CREDITS"]) || 100;

const captionsSchema = z.object({
  context: z.string().min(1, "Describe the clip moment.").max(500),
  format: z.string().max(80).optional().default(""),
});

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[meme-machine] refund failed after generation error");
  }
}

/* POST /api/meme-machine/captions { context, format? }
   → 200 { captions[5], creditsUsed, creditsRemaining }
   Paid: 1 credit. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/meme-machine/captions", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = captionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid meme-machine request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CAPTIONS_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to meme this moment.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CAPTIONS_CREDITS, { action: "Meme Machine — Captions" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to meme this moment.",
      });
      return;
    }
    throw err;
  }

  const { context, format } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a meme-caption writer for content creators. A creator describes a moment from their ` +
            `clip and optionally names a meme format. You write EXACTLY 5 punchy meme captions for it.\n` +
            `Each caption is one string in top/bottom text style — write it as "TOP TEXT / BOTTOM TEXT" ` +
            `when the format fits, or a single killer line when it doesn't. Keep each under 15 words, ` +
            `relatable, and actually funny — internet-native humor, no corporate voice. Vary the angles: ` +
            `one absurd, one relatable-pain, one callout, one wholesome twist, one unhinged-but-kind.\n` +
            `RULES: punch at situations, never punch down at real private people; no harassment, no slurs. ` +
            `Return ONLY JSON: {"captions": ["caption 1", "caption 2", "caption 3", "caption 4", "caption 5"]}. ` +
            `Exactly 5.`,
        },
        {
          role: "user",
          content:
            `Write 5 meme captions.\n` +
            `Moment: ${context.trim()}` +
            (format.trim() ? `\nMeme format: ${format.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.95,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let captions: string[] = [];
    try {
      const j = JSON.parse(raw) as { captions?: unknown };
      if (Array.isArray(j.captions)) {
        captions = j.captions
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.trim())
          .slice(0, 5);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (captions.length === 0) {
      throw new Error("Model returned no usable captions");
    }

    res.json({
      captions,
      creditsUsed: CAPTIONS_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, CAPTIONS_CREDITS, "Meme Machine — Captions");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[meme-machine] OpenAI rate limit / quota");
      res.status(503).json({ error: "The meme machine is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[meme-machine] captions generation failed");
    res.status(502).json({ error: "The meme machine hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
