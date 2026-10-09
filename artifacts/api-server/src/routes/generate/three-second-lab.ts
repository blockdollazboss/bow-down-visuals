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

/* ─── Three Second Lab ────────────────────────────────────────────────────
   /api/three-second-lab/openings — 2 credits: the creator describes their
   video; the AI writes 5 alternate first-3-second opening hooks — each
   with spoken/visual text plus a visual direction — then scores each
   0-100 for scroll-stopping power with one-line reasoning, sorted best
   first.

   Honest framing is mandatory: scores are comparative judgments of hook
   craft, not predictions of performance. The model must not promise
   views. */

const router = Router();

/* 2 credits per 5-opening lab — env-overridable without a deploy. Five
   scored openings with visual direction is a long structured GPT-6 Sol
   completion; 2 credits holds a deep margin — and honors the standing rule
   that every AI feature costs a fee. */
const OPENINGS_CREDITS = Number(process.env["THREE_SECOND_LAB_OPENINGS_CREDITS"]) || 200;

const openingsSchema = z.object({
  videoDescription: z.string().min(1, "Describe your video.").max(1000),
  niche: z.string().max(120).optional().default(""),
});

interface OpeningItem {
  text: string;
  visual: string;
  score: number; // 0-100
  reasoning: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parseOpening(e: Record<string, unknown>): OpeningItem | null {
  const text = str(e["text"]).slice(0, 300);
  const visual = str(e["visual"]).slice(0, 400);
  if (!text || !visual) return null;
  return {
    text,
    visual,
    score: typeof e["score"] === "number" ? clamp(e["score"]) : 50,
    reasoning: str(e["reasoning"]).slice(0, 300),
  };
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[three-second-lab] refund failed after generation error");
  }
}

/* POST /api/three-second-lab/openings { videoDescription, niche? }
   → 200 { openings[{text,visual,score,reasoning}] (5, score desc), creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/three-second-lab/openings", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = openingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid three-second-lab request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < OPENINGS_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to test your openings.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, OPENINGS_CREDITS, { action: "Three Second Lab — Openings" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to test your openings.",
      });
      return;
    }
    throw err;
  }

  const { videoDescription, niche } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a hook doctor for short-form video creators. A creator describes the video they made. ` +
            `You write EXACTLY 5 alternate first-3-second openings — each one a different psychological ` +
            `angle (curiosity gap, bold claim, pattern interrupt, relatable pain, payoff tease). ` +
            `Each opening has:\n` +
            `- text: the exact spoken words / on-screen text for the first 3 seconds (under 20 words)\n` +
            `- visual: the visual direction — what the viewer SEES in those 3 seconds (camera, action, framing)\n` +
            `- score: 0-100 for scroll-stopping power — judge the craft honestly, spread the scores, ` +
            `never inflate\n` +
            `- reasoning: one line on why this opening earns its score\n` +
            `HONESTY RULE: scores are comparative judgments of hook craft, not predictions of views — ` +
            `never promise performance. ` +
            `Return ONLY JSON: {"openings": [{"text": "...", "visual": "...", "score": <0-100>, ` +
            `"reasoning": "..."}, ...]}. Exactly 5 openings, varied angles.`,
        },
        {
          role: "user",
          content:
            `Write 5 alternate openings for my video.\n` +
            `Video: ${videoDescription.trim()}` +
            (niche.trim() ? `\nMy niche: ${niche.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let openings: OpeningItem[] = [];
    try {
      const j = JSON.parse(raw) as { openings?: unknown };
      if (Array.isArray(j.openings)) {
        openings = j.openings
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map(parseOpening)
          .filter((o): o is OpeningItem => o !== null)
          .slice(0, 5);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (openings.length === 0) {
      throw new Error("Model returned no usable openings");
    }
    openings.sort((a, b) => b.score - a.score);

    res.json({
      openings,
      creditsUsed: OPENINGS_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, OPENINGS_CREDITS, "Three Second Lab — Openings");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[three-second-lab] OpenAI rate limit / quota");
      res.status(503).json({ error: "The three-second lab is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[three-second-lab] openings generation failed");
    res.status(502).json({ error: "The three-second lab hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
