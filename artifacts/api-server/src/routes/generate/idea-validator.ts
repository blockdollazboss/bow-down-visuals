import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI content idea validator ───
   Scores a raw content idea before the creator invests time filming it:
   virality potential, competition level, and audience fit, then delivers a
   go / pivot / no-go verdict with concrete pivot angles for weak ideas.
   75 Visual Bucs. */

const IDEA_VALIDATOR_COST = Number(process.env["IDEA_VALIDATOR_CREDITS"]) || 75;

const PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_DIRECTION: Record<Platform, string> = {
  tiktok: "TikTok (fast scroll, trending sounds, comment-bait, 7-21s sweet spot)",
  instagram: "Instagram Reels (polished aesthetic, share/save driven, SEO captions)",
  youtube: "YouTube Shorts & long-form (title-led discovery, watch-time, subscribe CTA)",
  x: "X / Twitter (quote-post amplification, concise copy, thread potential)",
};

const ideaValidatorSchema = z.object({
  /** The raw content idea to validate, e.g. "ranking my beats from worst to best". */
  idea: z.string().trim().min(5, "Idea must be at least 5 characters.").max(500),
  /** Creator's niche, e.g. "music production", "fitness", "comedy". */
  niche: z.string().trim().min(2, "Niche must be at least 2 characters.").max(100),
  /** Target platform. */
  platform: z.enum(PLATFORMS),
  /** Optional: who the creator is trying to reach. Sharpens audience-fit scoring. */
  targetAudience: z.string().trim().max(200).optional().default(""),
});

interface ScoreBreakdown {
  label: string;
  score: number;
  reasoning: string;
}

interface IdeaPivot {
  angle: string;
  whyItWorks: string;
}

interface IdeaVerdict {
  verdict: "go" | "pivot" | "no-go";
  overallScore: number;
  scores: {
    virality: ScoreBreakdown;
    competition: ScoreBreakdown;
    audienceFit: ScoreBreakdown;
  };
  strengths: string[];
  risks: string[];
  pivots: IdeaPivot[];
  /** One-line verdict summary the creator can act on immediately. */
  summary: string;
}

router.get("/idea-validator-info", requireAuth, (_req, res) => {
  res.json({
    platforms: PLATFORMS.map((p) => ({ id: p, label: PLATFORM_DIRECTION[p] })),
    price: IDEA_VALIDATOR_COST,
    verdicts: ["go", "pivot", "no-go"],
  });
});

router.post("/validate-idea", requireAuth, async (req, res) => {
  const parsed = ideaValidatorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({
      error: "OPENAI_API_KEY is not configured — this AI feature is unavailable.",
    });
    return;
  }
  if (currentCredits < IDEA_VALIDATOR_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, IDEA_VALIDATOR_COST, {
      action: "Idea Validator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const audienceLine = parsed.data.targetAudience
      ? `Target audience: ${parsed.data.targetAudience}\n`
      : "";

    const prompt =
      `You are a ruthless content strategist who has studied what goes viral and what flops. ` +
      `Validate this content idea honestly — do not sugarcoat.\n\n` +
      `Content idea: ${parsed.data.idea}\n` +
      `Niche: ${parsed.data.niche}\n` +
      `Platform: ${PLATFORM_DIRECTION[parsed.data.platform]}\n` +
      `${audienceLine}\n` +
      `Score three dimensions, each 1-100:\n` +
      `- virality: how likely this idea is to earn shares, saves, and comments on this platform (hooks, novelty, emotional triggers, trend alignment)\n` +
      `- competition: how SATURATED this angle is (score HIGH = low competition / blue ocean; score LOW = overdone, crowded)\n` +
      `- audienceFit: how well this idea serves the stated niche and target audience\n\n` +
      `Then give a verdict:\n` +
      `- "go" if overall strong (avg of the three scores >= 70)\n` +
      `- "pivot" if the core is workable but the angle needs changing (avg 40-69)\n` +
      `- "no-go" if fundamentally weak (avg < 40)\n\n` +
      `For "pivot" and "no-go" verdicts, provide 3 concrete pivot angles — same idea, sharper packaging. ` +
      `For "go", still provide 2 angles that would make it even stronger.\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"verdict": "go", "overallScore": 82, ` +
      `"virality": {"label": "Virality Potential", "score": 85, "reasoning": "..."}, ` +
      `"competition": {"label": "Competition", "score": 70, "reasoning": "..."}, ` +
      `"audienceFit": {"label": "Audience Fit", "score": 90, "reasoning": "..."}, ` +
      `"strengths": ["..."], "risks": ["..."], ` +
      `"pivots": [{"angle": "...", "whyItWorks": "..."}], ` +
      `"summary": "One sentence a creator can act on."}`;

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
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Idea validation failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty idea validation result.");

    const raw = JSON.parse(content) as {
      verdict?: string;
      overallScore?: number;
      virality?: { label?: string; score?: number; reasoning?: string };
      competition?: { label?: string; score?: number; reasoning?: string };
      audienceFit?: { label?: string; score?: number; reasoning?: string };
      strengths?: string[];
      risks?: string[];
      pivots?: Array<{ angle?: string; whyItWorks?: string }>;
      summary?: string;
    };

    const clamp = (n: unknown) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return 50;
      return Math.max(1, Math.min(100, Math.round(v)));
    };
    const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
    const scoreOf = (s: { label?: string; score?: number; reasoning?: string } | undefined, fallback: string): ScoreBreakdown => ({
      label: clean(s?.label, 60) || fallback,
      score: clamp(s?.score),
      reasoning: clean(s?.reasoning, 500) || "No reasoning provided.",
    });

    const scores = {
      virality: scoreOf(raw.virality, "Virality Potential"),
      competition: scoreOf(raw.competition, "Competition"),
      audienceFit: scoreOf(raw.audienceFit, "Audience Fit"),
    };
    const avg = Math.round((scores.virality.score + scores.competition.score + scores.audienceFit.score) / 3);
    const verdict: IdeaVerdict["verdict"] =
      raw.verdict === "go" || raw.verdict === "pivot" || raw.verdict === "no-go"
        ? raw.verdict
        : avg >= 70 ? "go" : avg >= 40 ? "pivot" : "no-go";

    const strengths = (Array.isArray(raw.strengths) ? raw.strengths : [])
      .map((s) => clean(s, 200))
      .filter((s) => s.length > 0)
      .slice(0, 5);
    const risks = (Array.isArray(raw.risks) ? raw.risks : [])
      .map((s) => clean(s, 200))
      .filter((s) => s.length > 0)
      .slice(0, 5);
    const pivots: IdeaPivot[] = (Array.isArray(raw.pivots) ? raw.pivots : [])
      .filter((p) => p && clean(p.angle, 1).length > 0)
      .slice(0, 4)
      .map((p) => ({
        angle: clean(p.angle, 300),
        whyItWorks: clean(p.whyItWorks, 300) || "Fresh angle on the same idea.",
      }));

    if (!clean(raw.summary, 1)) throw new Error("No verdict was generated.");

    const result: IdeaVerdict = {
      verdict,
      overallScore: clamp(raw.overallScore ?? avg),
      scores,
      strengths,
      risks,
      pivots,
      summary: clean(raw.summary, 300),
    };

    res.json({
      verdict: result,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Idea validation failed.";
    req.log.error({ err: message }, "[idea-validator] failed");
    await refundCredits(req.userId!, IDEA_VALIDATOR_COST, {
      action: "Idea Validator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
