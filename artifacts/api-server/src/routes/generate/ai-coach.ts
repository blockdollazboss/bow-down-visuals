import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* Platforms supported by the AI Performance Coach — matches the analytics
   hub surfaces that can post to this endpoint. */
const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/* 100 Visual Bucs per coaching session — env-overridable without a deploy.
   A coach call is a medium-length GPT completion (a fraction of a cent in
   provider fees), so 100 VB holds a deep margin while staying an impulse buy
   — and honors the standing rule that every AI feature costs a fee. */
const AI_COACH_CREDITS = Number(process.env["AI_COACH_CREDITS"]) || 100;

const aiCoachSchema = z.object({
  platform: z.enum(PLATFORMS).optional().default("tiktok"),
  posts: z
    .array(
      z.object({
        title: z.string().max(200),
        views: z.number().int().min(0),
        likes: z.number().int().min(0).optional().default(0),
        comments: z.number().int().min(0).optional().default(0),
        shares: z.number().int().min(0).optional().default(0),
        watchTimeSec: z.number().min(0).optional(),
        postedAt: z.string().max(40).optional(),
      }),
    )
    .min(1, "Send at least one post.")
    .max(20, "Send at most 20 posts."),
  niche: z.string().max(120).optional().default(""),
});

/* Text model: centralized in getTextModel() (env-overridable via
   OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/ai-coach { platform, posts[], niche }
   → 200 { insights, patterns[], mistakes[], nextSteps[], creditsUsed, creditsRemaining }
   Paid: AI_COACH_CREDITS (default 100 Visual Bucs). Auth required; credits
   are deducted BEFORE the model call using the same pre-check + chargeCredits
   pattern as monetization-coach. */
router.post("/ai-coach", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = aiCoachSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid AI coach request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < AI_COACH_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to get your AI performance insights.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, AI_COACH_CREDITS, { action: "AI Performance Coach" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to get your AI performance insights.",
      });
      return;
    }
    throw err;
  }

  /* ── performance insights generation ───────────────────────────────────
     Winners vs losers: rank by views (primary) with likes+comments+shares
     as engagement tiebreakers, so the model compares like-for-like
     performance instead of guessing from raw numbers. */
  const { platform, posts, niche } = parsed.data;
  const engagement = (p: { likes: number; comments: number; shares: number }) =>
    p.likes + p.comments + p.shares;
  const ranked = [...posts].sort(
    (a, b) => b.views - a.views || engagement(b) - engagement(a),
  );
  const postLines = ranked
    .map((p, i) => {
      const bits = [
        `#${i + 1} "${p.title}"`,
        `${p.views.toLocaleString("en-US")} views`,
        `${p.likes.toLocaleString("en-US")} likes`,
        `${p.comments.toLocaleString("en-US")} comments`,
        `${p.shares.toLocaleString("en-US")} shares`,
      ];
      if (p.watchTimeSec != null) bits.push(`${Math.round(p.watchTimeSec)}s avg watch time`);
      if (p.postedAt) bits.push(`posted ${p.postedAt}`);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are an AI performance coach for content creators — blunt, specific, ` +
            `and practical. A creator gives you their recent posts ranked best to worst ` +
            `by views (with engagement and optional watch time). You return JSON with: ` +
            `(a) a short insights paragraph — what worked, why you think it worked; ` +
            `(b) 2-3 patterns you spot across the WINNERS (top of the list) — hooks, ` +
            `topics, formats, timing, anything concrete; ` +
            `(c) 2 mistakes you spot across the LOSERS (bottom of the list); ` +
            `(d) 3 specific actionable next steps — real things they can do this week, ` +
            `not "post consistently" fluff. ` +
            `Keep everything concise and creator-friendly. No hype, no filler, no ` +
            `guaranteed-results promises. ` +
            `Return ONLY JSON: {"insights": "...", "patterns": ["...", "..."], ` +
            `"mistakes": ["...", "..."], "nextSteps": ["...", "...", "..."]}`,
        },
        {
          role: "user",
          content:
            `Coach me on my performance.\n` +
            `Platform: ${PLATFORM_LABEL[platform]}\n` +
            (niche.trim() ? `Niche: ${niche.trim()}\n` : "") +
            `Posts (ranked best to worst):\n${postLines}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface CoachJson {
      insights?: unknown;
      patterns?: unknown;
      mistakes?: unknown;
      nextSteps?: unknown;
    }
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const strList = (v: unknown, max: number) =>
      Array.isArray(v)
        ? v
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, max)
        : [];

    let insights = "";
    let patterns: string[] = [];
    let mistakes: string[] = [];
    let nextSteps: string[] = [];
    try {
      const j = JSON.parse(raw) as CoachJson;
      insights = str(j.insights);
      patterns = strList(j.patterns, 3);
      mistakes = strList(j.mistakes, 3);
      nextSteps = strList(j.nextSteps, 3);
    } catch {
      /* fall through to the empty check below */
    }
    if (!insights || patterns.length === 0 || mistakes.length === 0 || nextSteps.length === 0) {
      throw new Error("Model returned no usable performance insights");
    }

    res.json({
      insights,
      patterns,
      mistakes,
      nextSteps,
      creditsUsed: AI_COACH_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[ai-coach] OpenAI rate limit / quota");
      res.status(503).json({ error: "The coach is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[ai-coach] generation failed");
    res.status(502).json({ error: "The coach hiccupped — try again." });
  }
});

export default router;
