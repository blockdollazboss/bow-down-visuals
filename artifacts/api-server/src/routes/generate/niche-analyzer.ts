import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Niche Analyzer ───
   Deep niche intelligence for a creator's whole lane: who the audience is,
   which angles are underserved, which monetization paths fit best, how
   crowded the niche is, 5 starter content pillars, and a 30-day angle
   roadmap. 150 Visual Bucs (NICHE_ANALYZER_CREDITS env override). */

const NICHE_ANALYZER_COST = Number(process.env["NICHE_ANALYZER_CREDITS"]) || 150;

const PLATFORMS = ["tiktok", "instagram", "youtube", "x", "all"] as const;
type Platform = (typeof PLATFORMS)[number];

const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

const PLATFORM_DIRECTION: Record<Platform, string> = {
  tiktok: "TikTok (fast scroll, trending sounds, comment-bait)",
  instagram: "Instagram Reels (polished aesthetic, share/save driven, SEO captions)",
  youtube: "YouTube Shorts & long-form (title-led discovery, watch-time, subscribe CTA)",
  x: "X / Twitter (quote-post amplification, concise copy, thread potential)",
  all: "all major short-form platforms (TikTok, Instagram Reels, YouTube Shorts)",
};

const EXPERIENCE_DIRECTION: Record<ExperienceLevel, string> = {
  beginner: "beginner (0-10k followers, no established audience yet)",
  intermediate: "intermediate (10k-100k followers, some traction, ready to scale)",
  advanced: "advanced (100k+ followers, established audience, ready to monetize hard)",
};

const nicheAnalyzerSchema = z.object({
  /** The niche to analyze, e.g. "fitness", "indie music production", "skincare". */
  niche: z.string().trim().min(2, "Niche must be at least 2 characters.").max(120),
  /** Target platform, or "all" for a cross-platform view. */
  targetPlatform: z.enum(PLATFORMS).optional().default("all"),
  /** Creator's experience level — sharpens recommendations. */
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional().default("beginner"),
});

interface AudienceProfile {
  demographics: string;
  interests: string[];
}

interface ContentGap {
  angle: string;
  whyUnderserved: string;
  opportunity: string;
}

interface MonetizationPath {
  path: string;
  fitScore: number;
  why: string;
  firstStep: string;
}

interface ContentPillar {
  name: string;
  description: string;
  exampleIdeas: string[];
}

interface RoadmapWeek {
  week: number;
  focus: string;
  angles: string[];
}

interface NicheAnalysis {
  niche: string;
  targetPlatform: Platform;
  experienceLevel: ExperienceLevel;
  audienceProfile: AudienceProfile;
  contentGaps: ContentGap[];
  monetizationPaths: MonetizationPath[];
  competitionLevel: { score: number; label: string };
  contentPillars: ContentPillar[];
  roadmap30Day: RoadmapWeek[];
  summary: string;
}

function competitionLabel(score: number): string {
  if (score <= 25) return "Blue Ocean";
  if (score <= 45) return "Moderate";
  if (score <= 70) return "Crowded";
  return "Saturated";
}

router.get("/niche-analyzer-info", requireAuth, (_req, res) => {
  res.json({
    platforms: PLATFORMS.map((p) => ({ id: p, label: PLATFORM_DIRECTION[p] })),
    experienceLevels: EXPERIENCE_LEVELS.map((e) => ({ id: e, label: EXPERIENCE_DIRECTION[e] })),
    price: NICHE_ANALYZER_COST,
  });
});

router.post("/analyze-niche", requireAuth, async (req, res) => {
  const parsed = nicheAnalyzerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < NICHE_ANALYZER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, NICHE_ANALYZER_COST, {
      action: "Niche Analyzer",
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

    const prompt =
      `You are a ruthless niche strategist who has studied what works across creator platforms. ` +
      `Analyze this niche deeply and honestly — no sugarcoating, no generic advice.\n\n` +
      `Niche: ${parsed.data.niche}\n` +
      `Target platform: ${PLATFORM_DIRECTION[parsed.data.targetPlatform]}\n` +
      `Creator experience level: ${EXPERIENCE_DIRECTION[parsed.data.experienceLevel]}\n\n` +
      `Produce a complete niche breakdown:\n` +
      `- audienceProfile: who watches this niche (demographics in 1-2 sentences) + 4-6 concrete interests they have\n` +
      `- contentGaps: 4-5 UNDERSERVED angles in this niche — formats or topics the audience wants but few creators do well\n` +
      `- monetizationPaths: 4-5 ranked revenue paths ordered by fitScore DESC (digital products, affiliates, brand deals, sponsorships, merch, UGC, coaching, subscriptions — pick what actually fits THIS niche)\n` +
      `- competitionLevel: score 1-100 (1 = wide-open blue ocean, 100 = saturated) — calibrate honestly\n` +
      `- contentPillars: exactly 5 starter content pillars a creator in this niche should build around, each with 2 example video ideas\n` +
      `- roadmap30Day: a 4-week angle roadmap — each week has a focus theme and 3 specific content angles\n` +
      `- summary: 2 sentences a creator can act on today\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"audienceProfile": {"demographics": "...", "interests": ["...", "..."]}, ` +
      `"contentGaps": [{"angle": "...", "whyUnderserved": "...", "opportunity": "..."}], ` +
      `"monetizationPaths": [{"path": "...", "fitScore": 92, "why": "...", "firstStep": "..."}], ` +
      `"competitionScore": 62, ` +
      `"contentPillars": [{"name": "...", "description": "...", "exampleIdeas": ["...", "..."]}], ` +
      `"roadmap30Day": [{"week": 1, "focus": "...", "angles": ["...", "...", "..."]}], ` +
      `"summary": "..."}`;

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
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) throw new Error("Niche analysis failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty niche analysis result.");

    const raw = JSON.parse(content) as {
      audienceProfile?: { demographics?: string; interests?: string[] };
      contentGaps?: Array<{ angle?: string; whyUnderserved?: string; opportunity?: string }>;
      monetizationPaths?: Array<{ path?: string; fitScore?: number; why?: string; firstStep?: string }>;
      competitionScore?: number;
      contentPillars?: Array<{ name?: string; description?: string; exampleIdeas?: string[] }>;
      roadmap30Day?: Array<{ week?: number; focus?: string; angles?: string[] }>;
      summary?: string;
    };

    const clamp = (n: unknown, min: number, max: number, fallback: number) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(min, Math.min(max, Math.round(v)));
    };
    const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
    const cleanList = (arr: unknown, max: number, limit: number): string[] =>
      (Array.isArray(arr) ? arr : [])
        .map((s) => clean(s, max))
        .filter((s) => s.length > 0)
        .slice(0, limit);

    const interests = cleanList(raw.audienceProfile?.interests, 100, 6);
    if (!clean(raw.audienceProfile?.demographics, 1) || interests.length === 0) {
      throw new Error("Incomplete audience profile returned.");
    }

    const contentGaps: ContentGap[] = (Array.isArray(raw.contentGaps) ? raw.contentGaps : [])
      .filter((g) => g && clean(g.angle, 1).length > 0)
      .slice(0, 5)
      .map((g) => ({
        angle: clean(g.angle, 200),
        whyUnderserved: clean(g.whyUnderserved, 300) || "Little quality competition covers this angle.",
        opportunity: clean(g.opportunity, 300) || "Move first and own it.",
      }));
    if (contentGaps.length === 0) throw new Error("No content gaps returned.");

    const monetizationPaths: MonetizationPath[] = (Array.isArray(raw.monetizationPaths) ? raw.monetizationPaths : [])
      .filter((p) => p && clean(p.path, 1).length > 0)
      .slice(0, 6)
      .map((p) => ({
        path: clean(p.path, 120),
        fitScore: clamp(p.fitScore, 1, 100, 60),
        why: clean(p.why, 300) || "Strong fit for this niche.",
        firstStep: clean(p.firstStep, 300) || "Start testing this path.",
      }))
      .sort((a, b) => b.fitScore - a.fitScore);
    if (monetizationPaths.length === 0) throw new Error("No monetization paths returned.");

    const contentPillars: ContentPillar[] = (Array.isArray(raw.contentPillars) ? raw.contentPillars : [])
      .filter((p) => p && clean(p.name, 1).length > 0)
      .slice(0, 5)
      .map((p) => ({
        name: clean(p.name, 120),
        description: clean(p.description, 300) || "Core pillar for this niche.",
        exampleIdeas: cleanList(p.exampleIdeas, 200, 3),
      }));
    if (contentPillars.length === 0) throw new Error("No content pillars returned.");

    const roadmap30Day: RoadmapWeek[] = (Array.isArray(raw.roadmap30Day) ? raw.roadmap30Day : [])
      .filter((w) => w && clean(w.focus, 1).length > 0)
      .slice(0, 4)
      .map((w, i) => ({
        week: clamp(w.week, 1, 4, i + 1),
        focus: clean(w.focus, 200),
        angles: cleanList(w.angles, 200, 4),
      }))
      .sort((a, b) => a.week - b.week);
    if (roadmap30Day.length === 0) throw new Error("No 30-day roadmap returned.");

    const competitionScore = clamp(raw.competitionScore, 1, 100, 50);

    if (!clean(raw.summary, 1)) throw new Error("No summary was generated.");

    const result: NicheAnalysis = {
      niche: parsed.data.niche,
      targetPlatform: parsed.data.targetPlatform,
      experienceLevel: parsed.data.experienceLevel,
      audienceProfile: {
        demographics: clean(raw.audienceProfile?.demographics, 400),
        interests,
      },
      contentGaps,
      monetizationPaths,
      competitionLevel: { score: competitionScore, label: competitionLabel(competitionScore) },
      contentPillars,
      roadmap30Day,
      summary: clean(raw.summary, 400),
    };

    res.json({
      analysis: result,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Niche analysis failed.";
    req.log.error({ err: message }, "[niche-analyzer] failed");
    await refundCredits(req.userId!, NICHE_ANALYZER_COST, {
      action: "Niche Analyzer — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
