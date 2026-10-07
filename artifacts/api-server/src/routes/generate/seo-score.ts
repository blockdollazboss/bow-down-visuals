import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Video SEO Score ───
   Unified pre-publish SEO audit: scores a video's title + description +
   tags + chapters together and returns dimension scores, actionable
   issues, and an AI-rewritten optimized title + first-150-chars description.
   75 Visual Bucs (env-overridable via SEO_SCORE_CREDITS). */

const SEO_SCORE_COST = Number(process.env["SEO_SCORE_CREDITS"]) || 75;

const seoScoreSchema = z.object({
  /** Video title as it will appear on YouTube. */
  title: z.string().trim().min(3).max(150),
  /** Full video description as it will be published. */
  description: z.string().trim().min(20).max(5000),
  /** Tags as they will be published. */
  tags: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  /** Creator's niche — gives the scorer context for keyword relevance. */
  niche: z.string().trim().min(2).max(100),
  /** Whether the video has timestamp chapters. */
  hasChapters: z.boolean().optional().default(false),
  /** Whether the video has captions/subtitles. */
  hasCaptions: z.boolean().optional().default(false),
});

type Severity = "high" | "medium" | "low";

interface SeoIssue {
  severity: Severity;
  message: string;
  fix: string;
}

interface SeoScoreDimensions {
  titleStrength: number;
  keywordCoverage: number;
  descriptionQuality: number;
  tagRelevance: number;
  packagingComplete: number;
}

interface SeoScoreResult {
  overallScore: number;
  dimensions: SeoScoreDimensions;
  issues: SeoIssue[];
  optimizedTitle: string;
  optimizedDescriptionFirst150: string;
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(1, Math.min(100, Math.round(v)));
}

function str(v: unknown, maxLen = 200): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function parseIssue(raw: unknown): SeoIssue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const severity = r["severity"];
  if (severity !== "high" && severity !== "medium" && severity !== "low") return null;
  const message = str(r["message"]);
  if (!message) return null;
  return { severity, message, fix: str(r["fix"]) || "Address this before publishing." };
}

router.post("/seo-score", requireAuth, async (req, res) => {
  const parsed = seoScoreSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SEO_SCORE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SEO_SCORE_COST, {
      action: "Video SEO Score",
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
    const d = parsed.data;

    const prompt =
      `You are a YouTube SEO expert auditing a video's pre-publish packaging. Score the full package fairly.\n\n` +
      `Niche: ${d.niche}\n` +
      `Title: ${d.title}\n` +
      `Description:\n${d.description}\n\n` +
      `Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "(none provided)"}\n` +
      `Has chapters: ${d.hasChapters ? "yes" : "no"}\n` +
      `Has captions: ${d.hasCaptions ? "yes" : "no"}\n\n` +
      `Score each dimension 1-100:\n` +
      `- titleStrength: click-through power + keyword front-loading in the title (aim ≤ 60 chars for full display), curiosity gap, no ALL-CAPS or clickbait that overpromises\n` +
      `- keywordCoverage: main niche keyword present in the title AND within the first 150 characters of the description, semantic variants woven in naturally, no stuffing\n` +
      `- descriptionQuality: strong hook in the first 2 lines (the visible snippet), scannable structure, CTA + links, natural keyword placement beyond the first 150 chars\n` +
      `- tagRelevance: tags match the title/description keywords, mix of broad and long-tail, no irrelevant or generic filler tags; score low if no tags provided\n` +
      `- packagingComplete: chapters present (viewer retention + search timestamps), captions present (accessibility + search indexing), hashtags in description, CTA coverage\n\n` +
      `List every issue found: severity "high" (hurts ranking/clicks materially), "medium" (meaningful but not critical), or "low" (polish). ` +
      `Each issue needs a one-sentence message and a one-sentence concrete fix. ` +
      `Then rewrite: optimizedTitle (punchy, keyword-front-loaded, ≤ 60 chars) and optimizedDescriptionFirst150 ` +
      `(a compelling first-150-characters rewrite that front-loads the main keyword and hooks the click).\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"dimensions": {"titleStrength": 72, "keywordCoverage": 64, "descriptionQuality": 80, "tagRelevance": 55, "packagingComplete": 40}, ` +
      `"issues": [{"severity": "high", "message": "...", "fix": "..."}], ` +
      `"optimizedTitle": "...", "optimizedDescriptionFirst150": "..."}`;

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
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("SEO score failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty SEO score result.");

    const parsedContent = JSON.parse(content) as Record<string, unknown>;
    const rawDims = (typeof parsedContent["dimensions"] === "object" && parsedContent["dimensions"] !== null
      ? parsedContent["dimensions"]
      : {}) as Record<string, unknown>;

    const dimensions: SeoScoreDimensions = {
      titleStrength: clampScore(rawDims["titleStrength"]),
      keywordCoverage: clampScore(rawDims["keywordCoverage"]),
      descriptionQuality: clampScore(rawDims["descriptionQuality"]),
      tagRelevance: clampScore(rawDims["tagRelevance"]),
      packagingComplete: clampScore(rawDims["packagingComplete"]),
    };

    const overallScore = Math.round(
      (dimensions.titleStrength +
        dimensions.keywordCoverage +
        dimensions.descriptionQuality +
        dimensions.tagRelevance +
        dimensions.packagingComplete) /
        5
    );

    const issues: SeoIssue[] = Array.isArray(parsedContent["issues"])
      ? (parsedContent["issues"] as unknown[])
          .map(parseIssue)
          .filter((i): i is SeoIssue => i !== null)
          .slice(0, 10)
      : [];

    const result: SeoScoreResult = {
      overallScore,
      dimensions,
      issues,
      optimizedTitle: str(parsedContent["optimizedTitle"], 120) || d.title,
      optimizedDescriptionFirst150: str(parsedContent["optimizedDescriptionFirst150"], 300) ||
        d.description.slice(0, 150),
    };

    res.json({
      result,
      creditsUsed: SEO_SCORE_COST,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SEO score failed.";
    req.log.error({ err: message }, "[seo-score] failed");
    await refundCredits(req.userId!, SEO_SCORE_COST, {
      action: "Video SEO Score — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
