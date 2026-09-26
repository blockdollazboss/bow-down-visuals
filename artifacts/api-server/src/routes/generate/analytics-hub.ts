import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* Platforms tracked by the cross-platform Analytics Hub.
   Note: /analytics covers site-internal stats (connected accounts) — this
   route serves the social dashboard (TikTok, Instagram, YouTube, X). */
const PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
type PlatformKey = (typeof PLATFORMS)[number];

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};

/* 2 credits per insight generation — env-overridable without a deploy. A
   growth-plan call is a medium-length GPT-6 Sol completion (a fraction of a
   cent in provider fees), so 2 credits holds a deep margin while honoring
   the standing rule that every AI feature costs a fee. */
const ANALYTICS_HUB_CREDITS = Number(process.env["ANALYTICS_HUB_CREDIT_COST"]) || 2;

const platformSnapshotSchema = z.object({
  platform: z.enum(PLATFORMS),
  followers: z.number().int().min(0).max(1_000_000_000),
  views7d: z.number().int().min(0).max(1_000_000_000),
  views30d: z.number().int().min(0).max(1_000_000_000),
  engagementRate: z.number().min(0).max(100),
  topPostViews: z.number().int().min(0).max(1_000_000_000),
});

const insightsSchema = z.object({
  platforms: z
    .array(platformSnapshotSchema)
    .min(1, "Provide at least one platform snapshot.")
    .max(4)
    .refine(
      (list) => new Set(list.map((p) => p.platform)).size === list.length,
      "Each platform may appear only once."
    ),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/analytics-hub/insights { platforms: [...] } → 200
   { summary, recommendations, bestPlatform, focusArea, creditsUsed, creditsRemaining }
   Paid: 2 credits per generation. Auth required; credits are deducted BEFORE
   the model call and REFUNDED on model failure, using the same pre-check +
   deductCredits + refundCredits + recordCreditUsage pattern as the paid
   generate routes. */
router.post("/analytics-hub/insights", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = insightsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid analytics hub request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < ANALYTICS_HUB_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep getting AI growth plans.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ANALYTICS_HUB_CREDITS, {
      action: "Analytics Hub — AI Growth Plan",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep getting AI growth plans.",
      });
      return;
    }
    throw err;
  }

  try {
    const lines = parsed.data.platforms
      .map(
        (p) =>
          `- ${PLATFORM_LABELS[p.platform]}: ${p.followers.toLocaleString("en-US")} followers, ` +
          `${p.views7d.toLocaleString("en-US")} views (7d), ` +
          `${p.views30d.toLocaleString("en-US")} views (30d), ` +
          `${p.engagementRate}% engagement rate, top post ${p.topPostViews.toLocaleString("en-US")} views`
      )
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a growth strategist for independent music creators. ` +
            `You receive a creator's real cross-platform numbers (followers, views, engagement ` +
            `rate, top post views) and must return a tight, actionable growth plan grounded in ` +
            `those exact numbers — no generic advice, no made-up stats, no virality guarantees. ` +
            `Compare the platforms: identify where engagement is strongest relative to audience ` +
            `size, where reach is underperforming vs. follower count, and where the fastest win ` +
            `lives. Every recommendation must cite at least one of the creator's actual numbers. ` +
            `Be blunt and specific: name the platform, the move, and the metric to watch. ` +
            `Return ONLY JSON: { ` +
            `"summary": "<2-3 sentences on where this creator stands across platforms>", ` +
            `"recommendations": ["<exactly 3 specific growth recommendations, each referencing the creator's actual numbers>", ...], ` +
            `"bestPlatform": "<the platform key with the strongest momentum: one of ${PLATFORMS.join(", ")}>", ` +
            `"focusArea": "<one phrase naming the single highest-leverage focus, e.g. 'short-form consistency on TikTok'>" ` +
            `}.`,
        },
        {
          role: "user",
          content: `Here are my current platform numbers:\n${lines}\n\nBuild my growth plan.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 900,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let summary = "";
    let recommendations: string[] = [];
    let bestPlatform = "";
    let focusArea = "";
    try {
      const parsedJson = JSON.parse(raw) as {
        summary?: unknown;
        recommendations?: unknown;
        bestPlatform?: unknown;
        focusArea?: unknown;
      };
      if (typeof parsedJson.summary === "string" && parsedJson.summary.trim()) {
        summary = parsedJson.summary.trim();
      }
      if (Array.isArray(parsedJson.recommendations)) {
        recommendations = parsedJson.recommendations
          .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
          .map((r) => r.trim())
          .slice(0, 3);
      }
      if (typeof parsedJson.bestPlatform === "string" && parsedJson.bestPlatform.trim()) {
        bestPlatform = parsedJson.bestPlatform.trim();
      }
      if (typeof parsedJson.focusArea === "string" && parsedJson.focusArea.trim()) {
        focusArea = parsedJson.focusArea.trim();
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (!summary || recommendations.length < 3) {
      throw new Error("Model returned no usable growth plan");
    }
    recommendations = recommendations.slice(0, 3);

    res.json({
      summary,
      recommendations,
      bestPlatform,
      focusArea,
      creditsUsed: ANALYTICS_HUB_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    /* The charge was taken before the model call — give it back so a
       provider failure never costs the creator. */
    try {
      await refundCredits(req.userId!, ANALYTICS_HUB_CREDITS, {
        action: "Analytics Hub — AI Growth Plan — Refund (generation failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[analytics-hub] refund failed after generation failure"
      );
    }

    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[analytics-hub] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[analytics-hub] insights generation failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
