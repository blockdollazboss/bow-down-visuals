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
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import { withReplayProtection, ReplayShortCircuit } from "./ca6-replay-guard";

/* ─── Trend Jacker ────────────────────────────────────────────────────────
   /api/trend-jacker/draft — 200 credits: AI writes a complete video draft
   riding a named trend — scroll-stopping hook, full 60-90s script in the
   creator's style, shot-by-shot visual plan, caption, and hashtags.

   Honest framing is mandatory: riding a trend improves timing, never
   guarantees virality. The model must not promise outcomes. */

const router = Router();

/* 200 credits per draft — env-overridable without a deploy. A draft is a
   long structured GPT-6 Sol completion; 200 credits holds a deep margin while
   staying an impulse buy — and honors the standing rule that every AI
   feature costs a fee. */
const DRAFT_CREDITS = Number(process.env["TREND_JACKER_DRAFT_CREDITS"]) || 200;

const draftSchema = z.object({
  trend: z.string().min(1, "Trend is required.").max(200),
  trendWhy: z.string().max(500).optional().default(""),
  niche: z.string().min(1, "Niche is required.").max(120),
  styleNotes: z.string().max(500).optional().default(""),
});

interface DraftJson {
  hook?: unknown;
  script?: unknown;
  visualPlan?: unknown;
  caption?: unknown;
  hashtags?: unknown;
}

function parseStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

async function refundOnFailure(userId: string, amount: number, label: string): Promise<boolean> {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
    return true;
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[trend-jacker] refund failed after generation error");
    return false;
  }
}

/* POST /api/trend-jacker/draft { trend, trendWhy?, niche, styleNotes? }
   → 200 { hook, script, visualPlan[], caption, hashtags[], creditsUsed, creditsRemaining }
   Paid: 200 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/trend-jacker/draft", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid trend-jacker request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* CA-6 replay protection (charge audit B6): server-derived key over
     the trend/niche/style ask; the guard's stored-result pre-check
     runs before the balance gate and any funding. A failed draft
     refunds as before and voids the key. */
  const idempotencyKey = buildChargeIdempotencyKey("trend-jacker-draft", req.userId!, null, {
    trend: parsed.data.trend,
    trendWhy: parsed.data.trendWhy ?? null,
    niche: parsed.data.niche,
    styleNotes: parsed.data.styleNotes ?? null,
  });

  try {
    const outcome = await withReplayProtection("trend-jacker-draft", idempotencyKey, req.userId!, async () => {
  const balance = req.userCredits ?? 0;
  if (balance < DRAFT_CREDITS) {
    throw new ReplayShortCircuit(402, {
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to draft your trend video.",
    });
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, DRAFT_CREDITS, { action: "Trend Jacker — Draft" }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      throw new ReplayShortCircuit(402, {
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to draft your trend video.",
      });
    }
    throw err;
  }

  const { trend, trendWhy, niche, styleNotes } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a short-form video strategist for independent content creators. A creator gives you ` +
            `a trend they want to ride, why it's trending, their niche, and notes on their personal style. ` +
            `You write a COMPLETE draft video they can film today:\n` +
            `- hook: one scroll-stopping opening line (first 3 seconds, spoken on camera)\n` +
            `- script: a full 60-90 second spoken script IN THE CREATOR'S STYLE from the style notes — ` +
            `natural spoken word, not essay prose; include beat markers like [beat] where the energy shifts\n` +
            `- visualPlan: a shot-by-shot visual plan, 5-9 shots, each one string describing exactly ` +
            `what the viewer sees for that section of the script\n` +
            `- caption: a ready-to-post caption (under 150 characters) with a call to action\n` +
            `- hashtags: 5-10 hashtags as an array of strings WITHOUT the # symbol\n` +
            `RULES: ride the trend authentically in the creator's voice — no cringe forced tie-ins. ` +
            `HONESTY RULE: never promise virality, views, or growth — riding a trend improves timing, ` +
            `nothing more. ` +
            `Return ONLY JSON: {"hook": "...", "script": "...", "visualPlan": ["shot 1", ...], ` +
            `"caption": "...", "hashtags": ["...", ...]}.`,
        },
        {
          role: "user",
          content:
            `Write my trend-jacking video draft.\n` +
            `Trend: ${trend.trim()}` +
            (trendWhy.trim() ? `\nWhy it's trending: ${trendWhy.trim()}` : "") +
            `\nMy niche: ${niche.trim()}` +
            (styleNotes.trim() ? `\nMy style: ${styleNotes.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let hook = "";
    let script = "";
    let visualPlan: string[] = [];
    let caption = "";
    let hashtags: string[] = [];
    try {
      const j = JSON.parse(raw) as DraftJson;
      hook = typeof j.hook === "string" ? j.hook.trim() : "";
      script = typeof j.script === "string" ? j.script.trim() : "";
      visualPlan = parseStringArray(j.visualPlan, 12);
      caption = typeof j.caption === "string" ? j.caption.trim() : "";
      hashtags = parseStringArray(j.hashtags, 15).map((h) => h.replace(/^#+/, "").trim()).filter(Boolean);
    } catch {
      /* fall through to the empty check below */
    }
    if (!hook || !script || visualPlan.length === 0) {
      throw new Error("Model returned no usable draft");
    }

    return {
      hook,
      script,
      visualPlan,
      caption,
      hashtags,
      creditsUsed: DRAFT_CREDITS,
      creditsRemaining,
    };
  } catch (err) {
    const refunded = await refundOnFailure(req.userId!, DRAFT_CREDITS, "Trend Jacker — Draft");
    /* CA-6: a landed refund voids the key, so the retry re-charges. */
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    throw err;
  }
    });
    res.json(outcome.replayed ? { ...outcome.body, replayed: true } : outcome.body);
  } catch (err) {
    if (err instanceof ReplayShortCircuit) {
      res.status(err.status).json(err.body);
      return;
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[trend-jacker] OpenAI rate limit / quota");
      res.status(503).json({ error: "The trend jacker is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[trend-jacker] draft generation failed");
    res.status(502).json({ error: "The trend jacker hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
