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

/* ─── Trend Predictor ────────────────────────────────────────────────────
   /api/trend-predictor/forecast — 2 credits: AI analyzes the creator's niche
   and predicts 5 upcoming viral trends with confidence scores + reasoning.
   /api/trend-predictor/ideas — 1 credit: 10 content ideas for one trend.
   Trend tracking (the watchlist) is free — it's pure UI state, no compute.

   Honest framing is mandatory: these are predictions based on pattern
   analysis, not guarantees. The model must say so, and the frontend must
   show the disclaimer next to every forecast. */

const router = Router();

const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;

/* 2 credits per forecast — env-overridable without a deploy. A forecast is a
   long structured GPT-6 Sol completion; 2 credits holds a deep margin while
   staying an impulse buy — and honors the standing rule that every AI
   feature costs a fee. */
const FORECAST_CREDITS = Number(process.env["TREND_PREDICTOR_FORECAST_CREDITS"]) || 2;
/* 1 credit per 10-idea pack — short completion, same margin logic. */
const IDEAS_CREDITS = Number(process.env["TREND_PREDICTOR_IDEAS_CREDITS"]) || 1;

const forecastSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(120),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3).optional().default(["tiktok"]),
  audienceSize: z.enum(["starting", "growing", "established"]).optional().default("growing"),
});

const ideasSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(120),
  trend: z.string().min(1, "Trend is required.").max(200),
  trendWhy: z.string().max(500).optional().default(""),
});

interface TrendItem {
  trend: string;
  confidence: number; // 0-100
  timeframe: string; // e.g. "2-4 weeks"
  reasoning: string;
  earlySignals: string[];
}

interface ForecastJson {
  trends?: unknown;
  disclaimer?: unknown;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function parseTrend(e: Record<string, unknown>): TrendItem | null {
  const trend = String(e["trend"] ?? "").trim();
  if (!trend) return null;
  const rawSignals = e["earlySignals"];
  const earlySignals = Array.isArray(rawSignals)
    ? rawSignals
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 4)
    : [];
  return {
    trend,
    confidence: typeof e["confidence"] === "number" ? clamp(e["confidence"]) : 50,
    timeframe: String(e["timeframe"] ?? "").trim().slice(0, 40) || "Coming weeks",
    reasoning: String(e["reasoning"] ?? "").trim().slice(0, 600),
    earlySignals,
  };
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[trend-predictor] refund failed after generation error");
  }
}

/* POST /api/trend-predictor/forecast { niche, platforms?, audienceSize? }
   → 200 { trends[5], disclaimer, creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/trend-predictor/forecast", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = forecastSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid forecast request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < FORECAST_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to predict your trends.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, FORECAST_CREDITS, { action: "Trend Predictor — Forecast" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to predict your trends.",
      });
      return;
    }
    throw err;
  }

  const { niche, platforms, audienceSize } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a trend forecaster for independent content creators. A creator gives you ` +
            `their niche, target platforms, and audience size. You predict 5 upcoming viral ` +
            `trends they could ride EARLY — formats, sounds, challenges, topics, or aesthetics ` +
            `likely to spike in the next 2-8 weeks. Base predictions on pattern analysis: ` +
            `recurring trend cycles, cross-platform migration (what blew up on TikTok moves to ` +
            `Reels/Shorts), seasonal moments, and emerging subcultures in the niche. ` +
            `For each trend: a punchy name, a confidence score 0-100 (be honest — most trends ` +
            `deserve 40-75, never inflate), an estimated timeframe like "2-4 weeks", 1-2 ` +
            `sentences of reasoning citing the pattern you see, and up to 4 early signals ` +
            `to watch (specific accounts, sounds, hashtags, search terms). ` +
            `HONESTY RULE: these are predictions based on pattern analysis, not guarantees. ` +
            `Never promise virality. Your disclaimer must say exactly: ` +
            `"Predictions based on pattern analysis — not guarantees. Trends shift fast; ` +
            `verify momentum before going all-in." ` +
            `Return ONLY JSON: {"trends": [{"trend": "...", "confidence": <0-100>, ` +
            `"timeframe": "...", "reasoning": "...", "earlySignals": ["...", "..."]}], ` +
            `"disclaimer": "<the exact disclaimer above>"}. Exactly 5 trends.`,
        },
        {
          role: "user",
          content:
            `Predict 5 upcoming trends for me.\n` +
            `Niche: ${niche.trim()}\n` +
            `Platforms: ${platforms.join(", ")}\n` +
            `Audience size: ${audienceSize}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let trends: TrendItem[] = [];
    let disclaimer =
      "Predictions based on pattern analysis — not guarantees. Trends shift fast; verify momentum before going all-in.";
    try {
      const j = JSON.parse(raw) as ForecastJson;
      if (Array.isArray(j.trends)) {
        trends = j.trends
          .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
          .map(parseTrend)
          .filter((t): t is TrendItem => t !== null)
          .slice(0, 5);
      }
      if (typeof j.disclaimer === "string" && j.disclaimer.trim()) {
        disclaimer = j.disclaimer.trim();
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (trends.length === 0) {
      throw new Error("Model returned no usable trends");
    }

    res.json({
      trends,
      disclaimer,
      creditsUsed: FORECAST_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, FORECAST_CREDITS, "Trend Predictor — Forecast");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[trend-predictor] OpenAI rate limit / quota");
      res.status(503).json({ error: "The predictor is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[trend-predictor] forecast generation failed");
    res.status(502).json({ error: "The predictor hiccupped — your credits were refunded." });
  }
});

/* POST /api/trend-predictor/ideas { niche, trend, trendWhy? }
   → 200 { ideas[10], creditsUsed, creditsRemaining }
   Paid: 1 credit per 10-idea pack. Same charge-then-refund-on-failure flow. */
router.post("/trend-predictor/ideas", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = ideasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid ideas request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < IDEAS_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to get content ideas.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, IDEAS_CREDITS, { action: "Trend Predictor — Content Ideas" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to get content ideas.",
      });
      return;
    }
    throw err;
  }

  const { niche, trend, trendWhy } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a content strategist for independent creators. A creator gives you a ` +
            `predicted trend in their niche. You return exactly 10 concrete, filmable ` +
            `content ideas riding that trend — each one a specific video concept with a ` +
            `hook in the first 3 seconds, not vague advice. Vary the formats (talking head, ` +
            `POV, tutorial, reaction, behind-the-scenes). Keep each idea to one punchy ` +
            `sentence plus a 3-second hook in parentheses. ` +
            `Return ONLY JSON: {"ideas": ["<idea> (Hook: <first 3 seconds>)", ...]}. ` +
            `Exactly 10 ideas.`,
        },
        {
          role: "user",
          content:
            `Give me 10 content ideas.\n` +
            `Niche: ${niche.trim()}\n` +
            `Trend: ${trend.trim()}` +
            (trendWhy.trim() ? `\nWhy it's trending: ${trendWhy.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let ideas: string[] = [];
    try {
      const j = JSON.parse(raw) as { ideas?: unknown };
      if (Array.isArray(j.ideas)) {
        ideas = j.ideas
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
          .slice(0, 10);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (ideas.length === 0) {
      throw new Error("Model returned no usable ideas");
    }

    res.json({
      ideas,
      creditsUsed: IDEAS_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, IDEAS_CREDITS, "Trend Predictor — Content Ideas");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[trend-predictor] OpenAI rate limit / quota");
      res.status(503).json({ error: "The predictor is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[trend-predictor] ideas generation failed");
    res.status(502).json({ error: "The predictor hiccupped — your credits were refunded." });
  }
});

export default router;
