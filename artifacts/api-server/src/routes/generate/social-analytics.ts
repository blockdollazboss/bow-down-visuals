import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Social media analytics ───
   AI analysis of a social post (URL or description) with engagement
   predictions and improvement suggestions, plus trending topics by niche.
   100 Visual Bucs per post analysis. */

const ANALYZE_COST = Number(process.env["SOCIAL_ANALYTICS_CREDITS"]) || 100;

const analyzeSchema = z.object({
  /** Post URL (TikTok/IG/YouTube/X) — used as context if fetchable. */
  postUrl: z.string().trim().max(2048).optional().default(""),
  /** Platform the post is on. */
  platform: z.enum(["tiktok", "instagram", "youtube", "x"]).optional().default("tiktok"),
  /** Description/caption of the post. */
  caption: z.string().trim().min(1).max(2000),
  /** Current metrics, if known — improves prediction accuracy. */
  metrics: z
    .object({
      views: z.number().int().min(0).optional(),
      likes: z.number().int().min(0).optional(),
      comments: z.number().int().min(0).optional(),
      shares: z.number().int().min(0).optional(),
    })
    .optional()
    .default({}),
});

const trendsSchema = z.object({
  niche: z.string().trim().min(2).max(100),
  platform: z.enum(["tiktok", "instagram", "youtube", "x", "all"]).optional().default("all"),
});

interface PostAnalysis {
  engagementScore: number;
  predictedViews: string;
  predictedLikeRate: string;
  strengths: string[];
  improvements: { suggestion: string; impact: "high" | "medium" | "low" }[];
  hookRating: number;
  ctaRating: number;
}

interface TrendingTopic {
  topic: string;
  blurb: string;
  momentum: "rising" | "peaking" | "emerging";
  suggestedAngle: string;
}

async function callJsonModel(prompt: string, temperature = 0.7): Promise<string> {
  const model = getTextModel();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("AI analysis failed.");
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI analysis result.");
  return content;
}

router.post("/analyze-post", requireAuth, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < ANALYZE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, ANALYZE_COST, {
      action: "Social Post Analysis",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { caption, platform, postUrl, metrics } = parsed.data;
    const metricsLine = Object.keys(metrics).length
      ? `Current metrics: ${Object.entries(metrics)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}.`
      : "No current metrics provided.";

    const prompt =
      `You are a social media growth strategist. Analyze this ${platform} post:\n\n` +
      `Caption: ${caption}\n` +
      `${postUrl ? `Post URL: ${postUrl}\n` : ""}` +
      `${metricsLine}\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{\n` +
      `  "engagementScore": <1-100 overall score>,\n` +
      `  "predictedViews": "<range like '5K-15K' or '10K-50K'>",\n` +
      `  "predictedLikeRate": "<like rate like '3-5%'>",\n` +
      `  "strengths": ["<what works>", ...3 items],\n` +
      `  "improvements": [{"suggestion": "<actionable fix>", "impact": "high|medium|low"}, ...4-5 items, sorted high impact first],\n` +
      `  "hookRating": <1-10 score of the first line's hook>,\n` +
      `  "ctaRating": <1-10 score of the call to action>\n` +
      `}`;

    const content = await callJsonModel(prompt, 0.7);
    const analysis = JSON.parse(content) as PostAnalysis;

    res.json({
      analysis: {
        engagementScore: Math.min(100, Math.max(1, Math.round(Number(analysis.engagementScore) || 50))),
        predictedViews: String(analysis.predictedViews ?? "").slice(0, 50),
        predictedLikeRate: String(analysis.predictedLikeRate ?? "").slice(0, 20),
        strengths: (analysis.strengths ?? []).filter((s) => typeof s === "string").slice(0, 5),
        improvements: (analysis.improvements ?? [])
          .filter((i) => i && typeof i.suggestion === "string")
          .map((i) => ({
            suggestion: i.suggestion.slice(0, 300),
            impact: ["high", "medium", "low"].includes(i.impact) ? i.impact : "medium",
          }))
          .slice(0, 6),
        hookRating: Math.min(10, Math.max(1, Math.round(Number(analysis.hookRating) || 5))),
        ctaRating: Math.min(10, Math.max(1, Math.round(Number(analysis.ctaRating) || 5))),
      },
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Post analysis failed.";
    req.log.error({ err: message }, "[analyze-post] failed");
    await refundCredits(req.userId!, ANALYZE_COST, {
      action: "Social Post Analysis — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

router.get("/trending-topics", requireAuth, async (req, res) => {
  const parsed = trendsSchema.safeParse({
    niche: req.query["niche"],
    platform: req.query["platform"] ?? "all",
  });
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — provide a ?niche= query param.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  try {
    const { niche, platform } = parsed.data;
    const prompt =
      `You are a social media trend analyst. List the 8 hottest trending topics right now ` +
      `for the "${niche}" niche on ${platform === "all" ? "TikTok, Instagram, and YouTube" : platform}.\n\n` +
      `Mix of rising, peaking, and emerging trends. For each, give a content angle a creator could use this week.\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"topics": [{"topic": "<trend name>", "blurb": "<1 sentence on why it's trending>", "momentum": "rising|peaking|emerging", "suggestedAngle": "<concrete video/post idea>"}]}`;

    const content = await callJsonModel(prompt, 0.8);
    const parsedContent = JSON.parse(content) as { topics?: TrendingTopic[] };
    const topics = (parsedContent.topics ?? [])
      .filter((t) => t && typeof t.topic === "string" && t.topic.trim().length > 0)
      .map((t) => ({
        topic: t.topic.trim().slice(0, 120),
        blurb: String(t.blurb ?? "").slice(0, 250),
        momentum: (["rising", "peaking", "emerging"].includes(t.momentum) ? t.momentum : "rising") as TrendingTopic["momentum"],
        suggestedAngle: String(t.suggestedAngle ?? "").slice(0, 300),
      }))
      .slice(0, 8);

    res.json({ niche, platform, topics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trending topics lookup failed.";
    req.log.error({ err: message }, "[trending-topics] failed");
    res.status(500).json({ error: message });
  }
});

export default router;
