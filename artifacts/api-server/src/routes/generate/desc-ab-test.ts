import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Video description A/B tester ───
   Takes a video topic plus two description variants and has the AI score
   each on SEO, CTR potential, and keyword density, then declares a winner
   with per-criterion reasoning and actionable improvements for the loser.
   75 Visual Bucs. */

const DESC_AB_TEST_COST = Number(process.env["DESC_AB_TEST_CREDITS"]) || 75;

const testDescriptionsSchema = z.object({
  /** What the video is about — gives the scorer context. */
  topic: z.string().trim().min(3).max(500),
  /** Variant A of the description. */
  variantA: z.string().trim().min(20).max(5000),
  /** Variant B of the description. */
  variantB: z.string().trim().min(20).max(5000),
  /** Optional target keywords the variants are expected to include. */
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).optional().default([]),
});

interface VariantScore {
  seo: number;
  ctrPotential: number;
  keywordDensity: number;
  overall: number;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

interface AbTestResult {
  topic: string;
  variantA: VariantScore;
  variantB: VariantScore;
  winner: "A" | "B" | "tie";
  winnerReasoning: string;
  verdict: string;
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(1, Math.min(100, Math.round(v)));
}

function strArray(v: unknown, maxItems = 4, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 0)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));
}

function parseVariantScore(raw: unknown): VariantScore {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const seo = clampScore(r["seo"]);
  const ctrPotential = clampScore(r["ctrPotential"]);
  const keywordDensity = clampScore(r["keywordDensity"]);
  return {
    seo,
    ctrPotential,
    keywordDensity,
    overall: Math.round((seo + ctrPotential + keywordDensity) / 3),
    strengths: strArray(r["strengths"]),
    weaknesses: strArray(r["weaknesses"]),
    improvements: strArray(r["improvements"]),
  };
}

router.post("/test-descriptions", requireAuth, async (req, res) => {
  const parsed = testDescriptionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < DESC_AB_TEST_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, DESC_AB_TEST_COST, {
      action: "Description A/B Test",
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
    const keywordLine = parsed.data.keywords.length > 0
      ? `Target keywords: ${parsed.data.keywords.join(", ")}\n`
      : "";

    const prompt =
      `You are a YouTube SEO and copywriting judge. Compare two video description variants and score each fairly.\n\n` +
      `Video topic: ${parsed.data.topic}\n` +
      `${keywordLine}\n` +
      `--- VARIANT A ---\n${parsed.data.variantA}\n\n` +
      `--- VARIANT B ---\n${parsed.data.variantB}\n\n` +
      `Score each variant 1-100 on:\n` +
      `- seo: search discoverability — main keyword in first 150 chars, semantic coverage, hashtags, readability, natural keyword placement\n` +
      `- ctrPotential: click-through power of the opening lines — hook strength, curiosity gap, clarity, emotional pull\n` +
      `- keywordDensity: how well target keywords (and close semantic variants) are woven in without stuffing\n\n` +
      `For each variant list 2-4 strengths, 2-4 weaknesses, and 2-4 concrete improvements. ` +
      `Declare a winner: "A", "B", or "tie" (use tie only if the overall gap is within 3 points). ` +
      `Write 2-3 sentences of winnerReasoning explaining WHY it wins, citing specific differences. ` +
      `Write a one-sentence verdict a creator can act on immediately.\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"variantA": {"seo": 82, "ctrPotential": 75, "keywordDensity": 88, "strengths": ["..."], "weaknesses": ["..."], "improvements": ["..."]}, ` +
      `"variantB": {"seo": 70, "ctrPotential": 85, "keywordDensity": 64, "strengths": ["..."], "weaknesses": ["..."], "improvements": ["..."]}, ` +
      `"winner": "A", "winnerReasoning": "...", "verdict": "..."}`;

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
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Description A/B test failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty A/B test result.");

    const parsedContent = JSON.parse(content) as Record<string, unknown>;

    const variantA = parseVariantScore(parsedContent["variantA"]);
    const variantB = parseVariantScore(parsedContent["variantB"]);

    let winner: "A" | "B" | "tie" = "tie";
    const gap = variantA.overall - variantB.overall;
    if (gap > 3) winner = "A";
    else if (gap < -3) winner = "B";
    const modelWinner = parsedContent["winner"];
    if (winner === "tie" && (modelWinner === "A" || modelWinner === "B")) {
      // Defer to the judge's call only when scores are genuinely tied.
      winner = modelWinner;
    }

    const result: AbTestResult = {
      topic: parsed.data.topic,
      variantA,
      variantB,
      winner,
      winnerReasoning: String(parsedContent["winnerReasoning"] ?? "").trim().slice(0, 800) ||
        `Winner declared by overall score: A ${variantA.overall} vs B ${variantB.overall}.`,
      verdict: String(parsedContent["verdict"] ?? "").trim().slice(0, 400),
    };

    res.json({
      result,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Description A/B test failed.";
    req.log.error({ err: message }, "[desc-ab-test] failed");
    await refundCredits(req.userId!, DESC_AB_TEST_COST, {
      action: "Description A/B Test — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
