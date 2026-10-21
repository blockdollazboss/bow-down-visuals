import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Competitor Tracker ─────────────────────────────────────────────────
   AI competitor analysis: the creator names a competitor (name and/or
   channel URL), gives the niche, and optionally adds anything they know
   about the competitor. GPT-6 Sol returns a structured teardown:
   content pillars, posting-cadence assessment, top formats, strengths,
   weaknesses, exploitable gaps (opportunities), and exactly 3 actionable
   takeaways — plus quick-action handoffs to the Hook Studio so the creator
   can act on a gap immediately.

   Honest framing everywhere: this analyzes what the creator shared plus
   established patterns for the niche — it is NOT scraped/live data, does
   not invent follower counts or stats, and is not a guarantee of growth. */

const router = Router();

/* 200 Visual Bucs per analysis — env-overridable without a deploy. One
   structured GPT-6 Sol completion; deep margin while staying an impulse
   buy, in line with the other paid analysis routes. */
const COMPETITOR_CREDITS = Number(process.env["COMPETITOR_CREDITS"]) || 200;
/* Exported for tests. */
export { COMPETITOR_CREDITS };

/* Exported for tests. */
export const competitorSchema = z
  .object({
    competitorName: z.string().trim().max(120).default(""),
    channelUrl: z.string().trim().max(2048).default(""),
    niche: z.string().trim().min(2, "Tell us the niche.").max(120),
    notes: z.string().trim().max(2000).default(""),
  })
  .refine((d) => d.competitorName.length >= 2 || d.channelUrl.length >= 4, {
    message: "Provide a competitor name or a channel URL.",
    path: ["competitorName"],
  });

export interface ContentPillar {
  pillar: string;
  whatTheyPost: string;
}

export interface TopFormat {
  format: string;
  whyItWorks: string;
}

export interface Opportunity {
  gap: string;
  howToExploit: string;
}

export interface PostingCadence {
  assessment: string;
  estimatedPostsPerWeek: number | null;
}

export interface ParsedCompetitorAnalysis {
  competitorName: string;
  niche: string;
  contentPillars: ContentPillar[];
  postingCadence: PostingCadence;
  topFormats: TopFormat[];
  strengths: string[];
  weaknesses: string[];
  opportunities: Opportunity[];
  takeaways: string[];
  disclaimer: string;
  usable: boolean;
}

function outOfCreditsJson() {
  return {
    error: "out_of_credits",
    message: "You're out of Visual Bucs — top up to run a competitor analysis.",
  };
}

async function refundOnFailure(userId: string): Promise<void> {
  try {
    await refundCredits(userId, COMPETITOR_CREDITS, {
      action: "Competitor Tracker — Refund (generation failed)",
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[competitor-tracker] refund failed after generation error");
  }
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "";
}

function cleanStringArray(v: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, max))
    .slice(0, limit);
}

function clampPostsPerWeek(v: unknown): number | null {
  if (typeof v !== "number" || Number.isNaN(v) || v < 0) return null;
  return Math.min(100, Math.round(v));
}

/* Parse + sanitize the model's JSON. Exported for tests. */
export function parseCompetitorJson(raw: string, fallbackName: string, niche: string): ParsedCompetitorAnalysis {
  const empty: ParsedCompetitorAnalysis = {
    competitorName: cleanText(fallbackName, 120),
    niche: cleanText(niche, 120),
    contentPillars: [],
    postingCadence: { assessment: "", estimatedPostsPerWeek: null },
    topFormats: [],
    strengths: [],
    weaknesses: [],
    opportunities: [],
    takeaways: [],
    disclaimer:
      "AI analysis based on what you shared and established patterns for this niche — not scraped data, and not a guarantee of growth.",
    usable: false,
  };

  try {
    const parsedJson = JSON.parse(raw) as {
      contentPillars?: unknown;
      postingCadence?: unknown;
      topFormats?: unknown;
      strengths?: unknown;
      weaknesses?: unknown;
      opportunities?: unknown;
      takeaways?: unknown;
    };

    if (Array.isArray(parsedJson.contentPillars)) {
      for (const p of parsedJson.contentPillars) {
        const pp = p as { pillar?: unknown; whatTheyPost?: unknown };
        const pillar = cleanText(pp.pillar, 120);
        const whatTheyPost = cleanText(pp.whatTheyPost, 300);
        if (pillar) {
          empty.contentPillars.push({
            pillar,
            whatTheyPost: whatTheyPost || "Standard posts for this pillar.",
          });
        }
        if (empty.contentPillars.length >= 5) break;
      }
    }

    const cadence = parsedJson.postingCadence as
      | { assessment?: unknown; estimatedPostsPerWeek?: unknown }
      | undefined;
    empty.postingCadence = {
      assessment: cleanText(cadence?.assessment, 400),
      estimatedPostsPerWeek: clampPostsPerWeek(cadence?.estimatedPostsPerWeek),
    };

    if (Array.isArray(parsedJson.topFormats)) {
      for (const f of parsedJson.topFormats) {
        const ff = f as { format?: unknown; whyItWorks?: unknown };
        const format = cleanText(ff.format, 140);
        const whyItWorks = cleanText(ff.whyItWorks, 300);
        if (format) {
          empty.topFormats.push({ format, whyItWorks: whyItWorks || "Proven format in this niche." });
        }
        if (empty.topFormats.length >= 4) break;
      }
    }

    empty.strengths = cleanStringArray(parsedJson.strengths, 300, 5);
    empty.weaknesses = cleanStringArray(parsedJson.weaknesses, 300, 5);

    if (Array.isArray(parsedJson.opportunities)) {
      for (const o of parsedJson.opportunities) {
        const oo = o as { gap?: unknown; howToExploit?: unknown };
        const gap = cleanText(oo.gap, 200);
        const howToExploit = cleanText(oo.howToExploit, 300);
        if (gap) {
          empty.opportunities.push({
            gap,
            howToExploit: howToExploit || "Turn this gap into content the competitor isn't making.",
          });
        }
        if (empty.opportunities.length >= 4) break;
      }
    }

    empty.takeaways = cleanStringArray(parsedJson.takeaways, 350, 3);

    empty.usable =
      empty.contentPillars.length >= 3 &&
      empty.postingCadence.assessment.length > 0 &&
      empty.topFormats.length >= 3 &&
      empty.strengths.length >= 1 &&
      empty.weaknesses.length >= 1 &&
      empty.opportunities.length >= 3 &&
      empty.takeaways.length === 3;
  } catch {
    /* unusable → usable: false */
  }

  return empty;
}

/* POST /api/competitor-analysis { competitorName?, channelUrl?, niche, notes? }
   → 200 { competitorName, niche, contentPillars[], postingCadence,
           topFormats[], strengths[], weaknesses[], opportunities[],
           takeaways[], disclaimer, quickActions, creditsUsed, creditsRemaining }
   Paid: 200 Visual Bucs (COMPETITOR_CREDITS). Auth required; credits are
   deducted BEFORE the model call and auto-refunded on provider failure or
   unusable output. */
router.post("/competitor-analysis", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = competitorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid competitor analysis request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < COMPETITOR_CREDITS) {
    res.status(402).json(outOfCreditsJson());
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, COMPETITOR_CREDITS, {
      action: "Competitor Tracker — Analysis",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json(outOfCreditsJson());
      return;
    }
    throw err;
  }

  const { competitorName, channelUrl, niche, notes } = parsed.data;
  const name = competitorName.trim() || channelUrl.trim();

  const contextLines: string[] = [
    `Competitor: ${name}`,
    `Niche: ${niche.trim()}`,
  ];
  if (channelUrl.trim()) contextLines.push(`Channel URL / handle: ${channelUrl.trim()}`);
  if (notes.trim()) {
    contextLines.push(`What the creator knows about this competitor: ${notes.trim()}`);
  } else {
    contextLines.push(
      "What the creator knows about this competitor: (nothing beyond name and niche — analyze from established patterns for this niche)"
    );
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a competitive-intelligence strategist for independent content creators. ` +
            `You analyze a competitor from the creator's description plus established, widely-known ` +
            `content patterns for the given niche. NEVER invent follower counts, view counts, revenue, ` +
            `or any stat about this competitor — only use what the creator told you. When data is ` +
            `missing, ground the analysis in best-practice patterns for the niche and label it as such.\n` +
            `Return a structured teardown with:\n` +
            `- contentPillars: 3-5 recurring content themes the competitor leans on (each: "pillar" + ` +
            `"whatTheyPost" describing what those posts look like)\n` +
            `- postingCadence: an honest "assessment" of their cadence from what was shared (state what ` +
            `is known vs. estimated), plus "estimatedPostsPerWeek" (a number, or null if unknowable)\n` +
            `- topFormats: 3-4 formats that likely drive their reach (each: "format" + "whyItWorks")\n` +
            `- strengths: 3 genuine strengths worth respecting\n` +
            `- weaknesses: 3 real weaknesses or blind spots\n` +
            `- opportunities: 3 exploitable GAPS (each: "gap" + "howToExploit" — one concrete move the ` +
            `creator can make this week to win viewers the competitor is leaving on the table)\n` +
            `- takeaways: exactly 3 actionable takeaways for the creator, each naming a specific move ` +
            `plus why it matters (max 40 words each)\n` +
            `Be blunt and specific — no generic advice like "post more" or "be consistent". ` +
            `Return ONLY JSON: { ` +
            `"contentPillars": [{"pillar": "...", "whatTheyPost": "..."}, ...], ` +
            `"postingCadence": {"assessment": "...", "estimatedPostsPerWeek": <number|null>}, ` +
            `"topFormats": [{"format": "...", "whyItWorks": "..."}, ...], ` +
            `"strengths": ["...", ...], "weaknesses": ["...", ...], ` +
            `"opportunities": [{"gap": "...", "howToExploit": "..."}, ...], ` +
            `"takeaways": ["<takeaway 1>", "<takeaway 2>", "<takeaway 3>"] }.`,
        },
        {
          role: "user",
          content: `Analyze this competitor.\n${contextLines.join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      /* GPT-6 rejects `max_tokens` — always use `max_completion_tokens`. */
      max_completion_tokens: 1800,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const analysis = parseCompetitorJson(raw, name, niche.trim());

    if (!analysis.usable) {
      await refundOnFailure(req.userId!);
      logger.warn("[competitor-tracker] model returned unusable output — refunded");
      res.status(502).json({ error: "The analysis came back empty — Visual Bucs refunded, try again." });
      return;
    }

    res.json({
      competitorName: analysis.competitorName,
      niche: analysis.niche,
      contentPillars: analysis.contentPillars,
      postingCadence: analysis.postingCadence,
      topFormats: analysis.topFormats,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      opportunities: analysis.opportunities,
      takeaways: analysis.takeaways,
      disclaimer: analysis.disclaimer,
      quickActions: [
        { label: "Generate ideas from this gap", href: "/hooks", hint: "Turn a competitor gap into scroll-stopping hooks" },
        { label: "Write a caption to win", href: "/hooks?tab=captions", hint: "Out-position the competitor's captions" },
        { label: "Pre-flight your next post", href: "/hooks?tab=preflight", hint: "Score it before you publish" },
      ],
      creditsUsed: COMPETITOR_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[competitor-tracker] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — Visual Bucs refunded, try again in a moment." });
      return;
    }
    logger.error({ err }, "[competitor-tracker] generation failed");
    res.status(502).json({ error: "The analysis hiccupped — Visual Bucs refunded, try again." });
  }
});

export default router;
