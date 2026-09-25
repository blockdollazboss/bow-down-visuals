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

const router = Router();

/* 2 credits per rate calculation — env-overridable without a deploy.
   A rate-card calculation is a medium-length GPT-6 Sol completion (a
   fraction of a cent in provider fees), so 2 credits holds a deep margin
   while staying an impulse buy — and honors the standing rule that every
   AI feature costs a fee. The generated rate card PDF itself is pure
   client-side rendering, so it ships free with the calculation. */
export const BRAND_CALC_CREDIT_COST =
  Number(process.env["BRAND_CALCULATOR_CREDIT_COST"]) || 2;

/* Platforms supported by the calculator — keep in sync with the frontend
   /brand-calculator page. */
export const PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "twitch",
  "x",
] as const;
type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitch: "Twitch",
  x: "X (Twitter)",
};

export const CONTENT_TYPES = [
  "sponsored_post",
  "video_integration",
  "dedicated_video",
  "story_set",
  "livestream",
  "ambassadorship",
] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  sponsored_post: "Sponsored post",
  video_integration: "Video integration (60–90s)",
  dedicated_video: "Dedicated video",
  story_set: "Story set (3 frames)",
  livestream: "Livestream segment",
  ambassadorship: "Monthly ambassadorship",
};

export const calculateSchema = z.object({
  platform: z.enum(PLATFORMS),
  followers: z.number().int().min(100).max(1000000000),
  avgViews: z.number().int().min(0).max(1000000000),
  engagementRate: z.number().min(0).max(100),
  contentType: z.enum(CONTENT_TYPES),
  niche: z.string().min(1).max(120),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol,
   env-overridable via OPENAI_TEXT_MODEL). Called per-request like every
   other route — do not hardcode model IDs. */

export function buildCalcSystemPrompt(): string {
  return (
    `You are a brand-deal pricing analyst for independent creators. ` +
    `A creator gives you their platform, follower count, average views, ` +
    `engagement rate, content type, and niche. You return a fair rate card ` +
    `as JSON. Use current industry benchmarks (nano/micro/mid-tier/macro ` +
    `CPM and flat-fee norms as of 2026). Engagement above ~4% earns a ` +
    `premium multiplier; below ~1.5% earns a discount. Music and gaming ` +
    `niches price slightly above generic lifestyle averages; finance and ` +
    `tech price higher still. ` +
    `Return a rate RANGE (low/high) per deliverable — never a single fixed ` +
    `number. Add a per-post price for the requested content type, a 3-post ` +
    `package price (5-10% volume discount), usage-rights guidance (30/60/90 ` +
    `day + whitelisting surcharge %), and 3 short negotiation tips. ` +
    `Honest framing is REQUIRED: every figure is an industry estimate, not ` +
    `a guarantee — include the disclaimer "Rates are estimates based on ` +
    `industry data as of 2026. Actual deals vary by brand, season, and ` +
    `negotiation." ` +
    `Return ONLY JSON: {"rateRange": {"low": <number>, "high": <number>, ` +
    `"currency": "USD"}, "perPost": <number>, "package3": <number>, ` +
    `"breakdown": [{"deliverable": "...", "low": <number>, "high": <number>}], ` +
    `"usageRights": [{"term": "...", "surcharge": "..."}], ` +
    `"negotiationTips": ["...", "...", "..."], ` +
    `"disclaimer": "..."}. All money values are whole USD dollars.`
  );
}

export function buildCalcUserPrompt(input: {
  platform: Platform;
  followers: number;
  avgViews: number;
  engagementRate: number;
  contentType: ContentType;
  niche: string;
}): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    `Price my brand deal.\n` +
    `Platform: ${PLATFORM_LABEL[input.platform]}\n` +
    `Followers: ${fmt(input.followers)}\n` +
    `Average views per post: ${fmt(input.avgViews)}\n` +
    `Engagement rate: ${input.engagementRate.toFixed(1)}%\n` +
    `Content type: ${CONTENT_TYPE_LABEL[input.contentType]}\n` +
    `Niche: ${input.niche.trim()}`
  );
}

export interface RateBreakdownItem {
  deliverable: string;
  low: number;
  high: number;
}

export interface UsageRight {
  term: string;
  surcharge: string;
}

export interface CalcResult {
  rateRange: { low: number; high: number; currency: string };
  perPost: number;
  package3: number;
  breakdown: RateBreakdownItem[];
  usageRights: UsageRight[];
  negotiationTips: string[];
  disclaimer: string;
}

function asMoney(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Parse + sanitize the model JSON. Throws on empty/unusable output so the
    caller can refund and 502. Never throws on individual bad fields — they
    degrade to empty strings/zeros instead. */
export function parseCalcJson(raw: string): CalcResult {
  const j = JSON.parse(raw) as Record<string, unknown>;

  const rr = (j["rateRange"] ?? {}) as Record<string, unknown>;
  const low = asMoney(rr["low"]);
  const high = asMoney(rr["high"]);

  const breakdown: RateBreakdownItem[] = Array.isArray(j["breakdown"])
    ? (j["breakdown"] as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b) => ({
          deliverable: String(b["deliverable"] ?? "").trim(),
          low: asMoney(b["low"]),
          high: asMoney(b["high"]),
        }))
        .filter((b) => b.deliverable.length > 0)
        .slice(0, 8)
    : [];

  const usageRights: UsageRight[] = Array.isArray(j["usageRights"])
    ? (j["usageRights"] as unknown[])
        .filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
        .map((u) => ({
          term: String(u["term"] ?? "").trim(),
          surcharge: String(u["surcharge"] ?? "").trim(),
        }))
        .filter((u) => u.term.length > 0)
        .slice(0, 6)
    : [];

  const negotiationTips: string[] = Array.isArray(j["negotiationTips"])
    ? (j["negotiationTips"] as unknown[])
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim())
        .slice(0, 5)
    : [];

  const disclaimer =
    typeof j["disclaimer"] === "string" && j["disclaimer"].trim().length > 0
      ? j["disclaimer"].trim()
      : "Rates are estimates based on industry data as of 2026. Actual deals vary by brand, season, and negotiation.";

  if (low <= 0 || high <= 0 || negotiationTips.length === 0) {
    throw new Error("Model returned no usable rate calculation");
  }

  return {
    rateRange: { low, high, currency: "USD" },
    perPost: asMoney(j["perPost"]),
    package3: asMoney(j["package3"]),
    breakdown,
    usageRights,
    negotiationTips,
    disclaimer,
  };
}

/* POST /api/brand-calculator/calculate
   { platform, followers, avgViews, engagementRate, contentType, niche }
   → 200 { result, creditsUsed, creditsRemaining }
   Paid: 2 credits per calculation. Auth required; credits are deducted
   BEFORE the model call using the same pre-check + chargeCredits +
   refund-on-failure pattern as the monetization coach and LLC guide. */
router.post(
  "/brand-calculator/calculate",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = calculateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid rate calculation request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < BRAND_CALC_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to price your brand deal.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, BRAND_CALC_CREDIT_COST, {
        action: "Brand Deal Calculator",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to price your brand deal.",
        });
        return;
      }
      throw err;
    }

    /* ── rate calculation ────────────────────────────────────────────────
       Honest framing: all figures are industry estimates as of 2026, never
       guarantees. The model is instructed to return ranges and a
       disclaimer; the frontend repeats the disclaimer on the rate card. */
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: buildCalcSystemPrompt() },
          { role: "user", content: buildCalcUserPrompt(parsed.data) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1500,
        temperature: 0.3,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const result = parseCalcJson(raw);

      res.json({
        result,
        creditsUsed: BRAND_CALC_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      await refundCredits(req.userId!, BRAND_CALC_CREDIT_COST, {
        action: "Brand Deal Calculator (provider failure refund)",
      }).catch(() => {});
      if (
        err instanceof OpenAI.APIError &&
        (err.status === 429 || err.code === "insufficient_quota")
      ) {
        logger.warn({ err }, "[brand-calculator] OpenAI rate limit / quota");
        res.status(503).json({
          error:
            "The calculator is catching its breath — try again in a moment. (Credit refunded.)",
        });
        return;
      }
      logger.error({ err }, "[brand-calculator] calculation failed");
      res.status(502).json({
        error: "The calculator hiccupped — try again. (Credit refunded.)",
      });
    }
  }
);

export default router;
