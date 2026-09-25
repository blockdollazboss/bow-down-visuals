import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Channel Audit ────────────────────────────────────────────────────────
   AI channel/content audit: the creator tells us about their channel (handle,
   niche, bio, recent post URLs/captions, posting cadence) and GPT-6 Sol
   grades 6 dimensions A–F with specific, actionable fixes per dimension plus
   a prioritized top-3 action list. Honest framing everywhere: this scores
   what the creator told us against best practices — it is not a guarantee
   and not a prediction of growth. */

const router = Router();

/* 3 credits per audit — env-overridable without a deploy. One longer GPT-6
   Sol structured completion; deep margin while staying an impulse buy. */
const CHANNEL_AUDIT_CREDITS = Number(process.env["CHANNEL_AUDIT_CREDIT_COST"]) || 3;
/* Exported for tests. */
export { CHANNEL_AUDIT_CREDITS };

/* The 6 graded dimensions — keep in sync with the frontend /audit page. */
const DIMENSIONS = [
  "posting-consistency",
  "hook-strength",
  "branding",
  "caption-quality",
  "cta-usage",
  "profile-bio",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

const DIMENSION_LABELS: Record<Dimension, string> = {
  "posting-consistency": "Posting Consistency",
  "hook-strength": "Hook Strength",
  "branding": "Branding & Visual Identity",
  "caption-quality": "Caption Quality",
  "cta-usage": "Calls to Action",
  "profile-bio": "Profile & Bio",
};

const GRADES = ["A", "B", "C", "D", "F"] as const;
type Grade = (typeof GRADES)[number];

/* Exported for tests. */
export const auditSchema = z.object({
  niche: z.string().min(2, "Tell us your niche.").max(120),
  handle: z.string().max(80).optional().default(""),
  platform: z.enum(["tiktok", "instagram", "youtube", "multi"]).default("multi"),
  bio: z.string().max(500).optional().default(""),
  postsPerWeek: z.string().max(40).optional().default(""),
  recentPosts: z
    .array(z.string().max(1200))
    .max(10, "Up to 10 recent posts.")
    .optional()
    .default([]),
});

export interface AuditDimensionResult {
  key: Dimension;
  grade: Grade;
  score: number;
  finding: string;
  fix: string;
}

export interface ParsedAudit {
  overallGrade: Grade;
  overallScore: number;
  verdict: string;
  disclaimer: string;
  dimensions: AuditDimensionResult[];
  topPriorities: string[];
  usable: boolean;
}

function outOfCreditsJson() {
  return {
    error: "out_of_credits",
    message: "You're out of credits — top up to run a channel audit.",
  };
}

async function refundOnFailure(userId: string): Promise<void> {
  try {
    await refundCredits(userId, CHANNEL_AUDIT_CREDITS, {
      action: "Channel Audit — Refund (generation failed)",
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[channel-audit] refund failed after generation error");
  }
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function validGrade(g: unknown): Grade | null {
  return typeof g === "string" && (GRADES as readonly string[]).includes(g.toUpperCase())
    ? (g.toUpperCase() as Grade)
    : null;
}

function gradeColor(grade: Grade): string {
  switch (grade) {
    case "A":
      return "text-emerald-400";
    case "B":
      return "text-lime-300";
    case "C":
      return "text-amber-400";
    case "D":
      return "text-orange-400";
    case "F":
      return "text-red-400";
  }
}

/* Parse + sanitize the model's JSON. Exported for tests. */
export function parseAuditJson(raw: string): ParsedAudit {
  let overallGrade: Grade = "C";
  let overallScore = 0;
  let verdict = "";
  let disclaimer =
    "Based on what you shared and current best practices — not a guarantee of growth. No AI can predict what blows up.";
  let dimensions: AuditDimensionResult[] = [];
  let topPriorities: string[] = [];

  try {
    const parsedJson = JSON.parse(raw) as {
      overallGrade?: unknown;
      overallScore?: unknown;
      verdict?: unknown;
      disclaimer?: unknown;
      dimensions?: unknown;
      topPriorities?: unknown;
    };
    const g = validGrade(parsedJson.overallGrade);
    if (g) overallGrade = g;
    overallScore = clampScore(parsedJson.overallScore);
    if (typeof parsedJson.verdict === "string" && parsedJson.verdict.trim()) {
      verdict = parsedJson.verdict.trim().slice(0, 400);
    }
    if (typeof parsedJson.disclaimer === "string" && parsedJson.disclaimer.trim()) {
      disclaimer = parsedJson.disclaimer.trim().slice(0, 300);
    }
    if (Array.isArray(parsedJson.dimensions)) {
      const seen = new Set<string>();
      for (const d of parsedJson.dimensions) {
        const dd = d as {
          key?: unknown;
          grade?: unknown;
          score?: unknown;
          finding?: unknown;
          fix?: unknown;
        };
        const key =
          typeof dd.key === "string" &&
          (DIMENSIONS as readonly string[]).includes(dd.key) &&
          !seen.has(dd.key)
            ? (dd.key as Dimension)
            : null;
        const dg = validGrade(dd.grade);
        if (!key || !dg) continue;
        seen.add(key);
        dimensions.push({
          key,
          grade: dg,
          score: clampScore(dd.score),
          finding:
            typeof dd.finding === "string" && dd.finding.trim()
              ? dd.finding.trim().slice(0, 300)
              : "No specific finding returned.",
          fix:
            typeof dd.fix === "string" && dd.fix.trim()
              ? dd.fix.trim().slice(0, 300)
              : "Review this area against top creators in your niche.",
        });
      }
      /* Keep canonical order; drop anything the model hallucinated. */
      dimensions.sort((a, b) => DIMENSIONS.indexOf(a.key) - DIMENSIONS.indexOf(b.key));
    }
    if (Array.isArray(parsedJson.topPriorities)) {
      topPriorities = parsedJson.topPriorities
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim().slice(0, 250))
        .slice(0, 3);
    }
  } catch {
    /* unusable → usable: false below */
  }

  return {
    overallGrade,
    overallScore,
    verdict,
    disclaimer,
    dimensions,
    topPriorities,
    usable: dimensions.length > 0 && verdict.length > 0 && topPriorities.length > 0,
  };
}

/* POST /api/channel-audit { niche, handle?, platform, bio?, postsPerWeek?, recentPosts? }
   → 200 { overallGrade, overallScore, verdict, disclaimer, dimensions[], topPriorities[], quickActions, creditsUsed, creditsRemaining }
   Paid: 3 credits. Auth required; credits deducted BEFORE the model call,
   auto-refunded on provider failure or unusable output. */
router.post("/channel-audit", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = auditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid channel audit request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CHANNEL_AUDIT_CREDITS) {
    res.status(402).json(outOfCreditsJson());
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CHANNEL_AUDIT_CREDITS, {
      action: "Channel Audit",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json(outOfCreditsJson());
      return;
    }
    throw err;
  }

  const { niche, handle, platform, bio, postsPerWeek, recentPosts } = parsed.data;

  const contextLines: string[] = [
    `Niche: ${niche.trim()}`,
    `Primary platform: ${platform === "multi" ? "multiple platforms" : platform}`,
  ];
  if (handle.trim()) contextLines.push(`Handle: @${handle.trim().replace(/^@/, "")}`);
  if (bio.trim()) contextLines.push(`Bio: "${bio.trim()}"`);
  if (postsPerWeek.trim()) contextLines.push(`Posting cadence: ${postsPerWeek.trim()}`);
  if (recentPosts.length > 0) {
    contextLines.push(
      `Recent posts (URLs / captions, newest first):\n${recentPosts
        .map((p, i) => `${i + 1}. ${p.trim()}`)
        .join("\n")}`,
    );
  } else {
    contextLines.push("Recent posts: (none provided — grade from cadence and best-practice baselines)");
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a brutally honest content strategist auditing an independent creator's channel. ` +
            `You score ONLY what the creator told you — never invent stats, follower counts, or content ` +
            `you cannot see. Where data is missing, say what to check, not what you assume. ` +
            `Grade 6 dimensions A (excellent) to F (failing), each with a 0-100 score and ONE concrete, ` +
            `specific fix the creator can apply this week:\n` +
            `1. posting-consistency — cadence, regularity, volume signals\n` +
            `2. hook-strength — first-3-second scroll-stoppers in titles/captions/hooks\n` +
            `3. branding — visual identity, recognizability, niche clarity\n` +
            `4. caption-quality — captions that add value vs. dead weight\n` +
            `5. cta-usage — calls to action driving comments, saves, shares, follows\n` +
            `6. profile-bio — bio clarity, discoverability, conversion to follow\n` +
            `Then: an overall letter grade, one blunt 2-sentence verdict, and exactly 3 top priorities ` +
            `ranked by impact (each: what to do + why it matters, max 25 words each). ` +
            `Be direct and specific — no generic advice like "post more" or "be consistent". ` +
            `Include the honest disclaimer verbatim: "Based on what you shared and current best practices — ` +
            `not a guarantee of growth. No AI can predict what blows up."\n` +
            `Return ONLY JSON: {"overallGrade": "A|B|C|D|F", "overallScore": <0-100>, ` +
            `"verdict": "<2 blunt sentences>", "disclaimer": "<the disclaimer above>", ` +
            `"dimensions": [{"key": "<one of the 6 keys>", "grade": "A|B|C|D|F", "score": <0-100>, ` +
            `"finding": "<one specific observation>", "fix": "<one specific fix>"}], ` +
            `"topPriorities": ["<priority 1>", "<priority 2>", "<priority 3>"]} ` +
            `with exactly the 6 dimensions above, in that order.`,
        },
        {
          role: "user",
          content: `Audit this creator's channel.\n${contextLines.join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      /* GPT-6 rejects `max_tokens` — always use `max_completion_tokens`. */
      max_completion_tokens: 1600,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const audit = parseAuditJson(raw);

    if (!audit.usable) {
      await refundOnFailure(req.userId!);
      logger.warn("[channel-audit] model returned unusable output — refunded");
      res.status(502).json({ error: "The audit came back empty — credits refunded, try again." });
      return;
    }

    const { overallGrade, overallScore, verdict, disclaimer, dimensions, topPriorities } = audit;

    res.json({
      overallGrade,
      overallScore,
      verdict,
      disclaimer,
      dimensions: dimensions.map((d) => ({
        ...d,
        label: DIMENSION_LABELS[d.key],
        gradeColor: gradeColor(d.grade),
      })),
      topPriorities,
      quickActions: [
        { label: "Fix my bio", href: "/hooks?tab=captions", hint: "Rewrite it in the Hook Studio" },
        { label: "Rewrite my hooks", href: "/hooks", hint: "5 scroll-stopping openers, 1 credit" },
        { label: "Pre-flight my next post", href: "/hooks?tab=preflight", hint: "Score it before you publish" },
      ],
      creditsUsed: CHANNEL_AUDIT_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[channel-audit] OpenAI rate limit / quota");
      res.status(503).json({ error: "The auditor is catching its breath — credits refunded, try again in a moment." });
      return;
    }
    logger.error({ err }, "[channel-audit] generation failed");
    res.status(502).json({ error: "The audit hiccupped — credits refunded, try again." });
  }
});

export { gradeColor };
export default router;
